/**
 * Thorough verification of per-region leave policies. TEST DB only.
 *   node --import tsx --env-file=.env.local scripts/qa-leave-policies.mjs
 * Idempotent: cleans up every override it creates.
 */
const grab = (m, n) => m[n] ?? m.default?.[n];
const db = grab(await import("@/lib/db"), "db");
const resMod = await import("@/lib/leave-policy-resolver");
const policiesForRegion = resMod.policiesForRegion ?? resMod.default.policiesForRegion;
const buildRegionPolicyResolver = resMod.buildRegionPolicyResolver ?? resMod.default.buildRegionPolicyResolver;
const lp = await import("@/lib/leave-policy");
const LEAVE_POLICIES = lp.LEAVE_POLICIES ?? lp.default.LEAVE_POLICIES;
const deriveLeaveBalances = lp.deriveLeaveBalances ?? lp.default.deriveLeaveBalances;
const computeEntitlement = lp.computeEntitlement ?? lp.default.computeEntitlement;

let fail = 0, pass = 0;
const ok = (n, c, extra) => { console.log(`  ${c ? "✓" : "✗"} ${n}${extra !== undefined ? ` [${extra}]` : ""}`); c ? pass++ : fail++; };

const url = process.env.DATABASE_URL ?? "";
if (!/test|5433|localhost|127\.0\.0\.1/i.test(url)) throw new Error("Not the TEST db");

const admin = await db.user.findFirst({ select: { id: true } });
const regions = await db.region.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
const TYPES = ["VACATION_PAID", "SICK", "MATERNITY", "PATERNITY"];
const joining = new Date(Date.UTC(2023, 0, 1));
const yearEnd = new Date(Date.UTC(2025, 11, 31)); // full 12 monthly credits / full year

async function clearAll() { await db.leavePolicy.deleteMany({}); }
await clearAll();

// ── 1. Every region, no override → exact defaults for all 4 types ──
console.log("── 1. Defaults for every region ──");
for (const r of regions) {
  const pol = await policiesForRegion(r.id);
  const good = TYPES.every((t) =>
    pol[t].accrual.days === LEAVE_POLICIES[t].accrual.days &&
    pol[t].maxBalance === LEAVE_POLICIES[t].maxBalance &&
    pol[t].waitingPeriod.value === LEAVE_POLICIES[t].waitingPeriod.value &&
    pol[t].waitingPeriod.unit === LEAVE_POLICIES[t].waitingPeriod.unit
  );
  ok(`${r.name}: defaults intact for all 4 types`, good);
}
ok("null region → defaults", (await policiesForRegion(null)).VACATION_PAID.accrual.days === 1.75);

// ── 2. Override each leave type in each region; isolation; revert ──
console.log("── 2. Override every type in every region (isolation + revert) ──");
for (const r of regions) {
  for (const t of TYPES) {
    const base = LEAVE_POLICIES[t];
    const newDays = base.accrual.days + 1; // distinct
    await db.leavePolicy.create({ data: { regionId: r.id, leaveType: t, accrualDays: newDays, waitingPeriodValue: base.waitingPeriod.value, waitingPeriodUnit: base.waitingPeriod.unit, maxBalance: base.maxBalance, updatedById: admin.id } });
    const pol = await policiesForRegion(r.id);
    if (pol[t].accrual.days !== newDays) { ok(`${r.name}/${t}: override applied`, false, pol[t].accrual.days); }
    // other types in same region unchanged
    const othersOk = TYPES.filter((x) => x !== t).every((x) => pol[x].accrual.days === LEAVE_POLICIES[x].accrual.days);
    if (!othersOk) ok(`${r.name}/${t}: other types unaffected`, false);
    // other regions unchanged for this type
    const other = regions.find((x) => x.id !== r.id);
    const polOther = await policiesForRegion(other.id);
    if (polOther[t].accrual.days !== LEAVE_POLICIES[t].accrual.days) ok(`${r.name}/${t}: other region unaffected`, false);
    await db.leavePolicy.deleteMany({ where: { regionId: r.id, leaveType: t } });
    const reverted = (await policiesForRegion(r.id))[t].accrual.days === LEAVE_POLICIES[t].accrual.days;
    if (!reverted) ok(`${r.name}/${t}: revert to default`, false);
  }
  ok(`${r.name}: all 4 types override → isolate → revert`, true);
}

// ── 3. Edge cases ──
console.log("── 3. Edge cases ──");
const R = regions[0], R2 = regions[1];

// 3a YEARLY type (SICK) days 5→9, stays uncapped
await db.leavePolicy.create({ data: { regionId: R.id, leaveType: "SICK", accrualDays: 9, waitingPeriodValue: 5, waitingPeriodUnit: "days", maxBalance: null, updatedById: admin.id } });
let pol = await policiesForRegion(R.id);
let sick = computeEntitlement("SICK", joining, {}, yearEnd, pol.SICK).entitlementDays;
ok("SICK yearly override 5→9 (uncapped) → 9", sick === 9, sick);

// 3b SICK with a cap of 6 → capped at 6
await db.leavePolicy.update({ where: { regionId_leaveType: { regionId: R.id, leaveType: "SICK" } }, data: { maxBalance: 6 } });
pol = await policiesForRegion(R.id);
sick = computeEntitlement("SICK", joining, {}, yearEnd, pol.SICK).entitlementDays;
ok("SICK override with cap 6 → capped at 6", sick === 6, sick);
await db.leavePolicy.deleteMany({ where: { regionId: R.id, leaveType: "SICK" } });

// 3c VACATION cap 21→10 → caps at 10 at year end
await db.leavePolicy.create({ data: { regionId: R.id, leaveType: "VACATION_PAID", accrualDays: 1.75, waitingPeriodValue: 3, waitingPeriodUnit: "months", maxBalance: 10, updatedById: admin.id } });
pol = await policiesForRegion(R.id);
let vac = computeEntitlement("VACATION_PAID", joining, {}, yearEnd, pol.VACATION_PAID).entitlementDays;
ok("VACATION cap lowered to 10 → entitlement 10", vac === 10, vac);
await db.leavePolicy.deleteMany({ where: { regionId: R.id, leaveType: "VACATION_PAID" } });

// 3d VACATION under-cap: 1 day/month cap 21 → 12 at year end (not capped)
await db.leavePolicy.create({ data: { regionId: R.id, leaveType: "VACATION_PAID", accrualDays: 1, waitingPeriodValue: 3, waitingPeriodUnit: "months", maxBalance: 21, updatedById: admin.id } });
pol = await policiesForRegion(R.id);
vac = computeEntitlement("VACATION_PAID", joining, {}, yearEnd, pol.VACATION_PAID).entitlementDays;
ok("VACATION 1/mo under cap → 12 (not capped)", vac === 12, vac);
await db.leavePolicy.deleteMany({ where: { regionId: R.id, leaveType: "VACATION_PAID" } });

// 3e waiting-period unit change: vacation 3 months → 0 days, a 10-day-old hire is eligible
await db.leavePolicy.create({ data: { regionId: R.id, leaveType: "VACATION_PAID", accrualDays: 1.75, waitingPeriodValue: 0, waitingPeriodUnit: "days", maxBalance: 21, updatedById: admin.id } });
pol = await policiesForRegion(R.id);
const recent = new Date(Date.UTC(2025, 11, 1)); // joined 1 Dec 2025
const e = computeEntitlement("VACATION_PAID", recent, {}, new Date(Date.UTC(2025, 11, 11)), pol.VACATION_PAID);
ok("waiting 0 days → not in waiting period right after joining", e.inWaitingPeriod === false);
await db.leavePolicy.deleteMany({ where: { regionId: R.id, leaveType: "VACATION_PAID" } });

// 3f gender eligibility unaffected by overrides (code-driven)
await db.leavePolicy.create({ data: { regionId: R.id, leaveType: "MATERNITY", accrualDays: 30, waitingPeriodValue: 1, waitingPeriodUnit: "months", maxBalance: null, updatedById: admin.id } });
pol = await policiesForRegion(R.id);
const male = deriveLeaveBalances(joining, [], "MALE", yearEnd, pol).map((b) => b.leaveType);
const female = deriveLeaveBalances(joining, [], "FEMALE", yearEnd, pol).map((b) => b.leaveType);
ok("MALE sees PATERNITY not MATERNITY (even with maternity override)", male.includes("PATERNITY") && !male.includes("MATERNITY"));
ok("FEMALE sees MATERNITY with overridden 30 days", female.includes("MATERNITY") && deriveLeaveBalances(joining, [], "FEMALE", yearEnd, pol).find((b) => b.leaveType === "MATERNITY").totalDays === 30);
await db.leavePolicy.deleteMany({ where: { regionId: R.id, leaveType: "MATERNITY" } });

// 3g bulk resolver: two regions overridden differently, a third on default
await db.leavePolicy.create({ data: { regionId: R.id, leaveType: "VACATION_PAID", accrualDays: 2, waitingPeriodValue: 3, waitingPeriodUnit: "months", maxBalance: 24, updatedById: admin.id } });
await db.leavePolicy.create({ data: { regionId: R2.id, leaveType: "VACATION_PAID", accrualDays: 3, waitingPeriodValue: 3, waitingPeriodUnit: "months", maxBalance: 30, updatedById: admin.id } });
const resolver = await buildRegionPolicyResolver();
ok("bulk resolver: region A = 2/24", resolver(R.id).VACATION_PAID.accrual.days === 2 && resolver(R.id).VACATION_PAID.maxBalance === 24);
ok("bulk resolver: region B = 3/30", resolver(R2.id).VACATION_PAID.accrual.days === 3 && resolver(R2.id).VACATION_PAID.maxBalance === 30);
ok("bulk resolver: region C = default", resolver(regions[2].id).VACATION_PAID.accrual.days === 1.75);
ok("bulk resolver: null region = default", resolver(null).VACATION_PAID.accrual.days === 1.75);
await clearAll();

// 3h summary reflects overridden numbers
await db.leavePolicy.create({ data: { regionId: R.id, leaveType: "VACATION_PAID", accrualDays: 2.5, waitingPeriodValue: 2, waitingPeriodUnit: "months", maxBalance: 30, updatedById: admin.id } });
pol = await policiesForRegion(R.id);
ok("summary regenerated from new numbers", /2\.5/.test(pol.VACATION_PAID.summary) && /30/.test(pol.VACATION_PAID.summary) && /2 months/.test(pol.VACATION_PAID.summary));
await clearAll();

console.log(`\n${fail ? `FAILED ${fail}` : "ALL CHECKS PASSED"} (${pass} checks)`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
