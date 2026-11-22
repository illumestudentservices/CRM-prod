/**
 * QA for the enrolment-target-at-risk alert (lib/target-at-risk-alerts.ts).
 *
 * Proves: only current-year targets short of the threshold fire; only the
 * institution's account manager (primary owner) is told — not the RM; a target
 * with no owner is skipped; on-track and past-year targets are ignored; a second
 * run de-dups; outside the end-of-year window nothing fires; dry-run writes
 * nothing.
 *
 *   npx tsx --env-file=.env.local scripts/qa-target-at-risk-alerts.ts
 */
import { db, createAndLogin, destroyUser, TAG } from "./qa-lib.mjs";
import { runTargetAtRiskAlerts } from "@/lib/target-at-risk-alerts";

let pass = 0, fail = 0;
const ok = (c: boolean, m: string, extra = "") => { if (c) { pass++; console.log("  ✓ " + m); } else { fail++; console.log("  ✗ " + m + (extra ? " → " + extra : "")); } };

async function main() {
  const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  const owner = await createAndLogin({ role: "ACCOUNT_MANAGER", withEmployee: true }); // the AM = primary owner
  const rm = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });

  const year = new Date().getFullYear();
  const inWindow = new Date(year, 11, 15);   // mid-December — inside the 60-day window
  const tooEarly = new Date(year, 5, 1);     // June — far from year-end
  const instIds: string[] = [];
  const targetIds: string[] = [];

  const mkInst = async (label: string, accountManagerId: string | null) => {
    const i = await db.institution.create({
      data: { name: `${TAG} ${label}`, country: "QA", type: "UNIVERSITY", createdById: admin.user.id, accountManagerId, regionalManagerId: rm.user.id },
      select: { id: true, name: true },
    });
    instIds.push(i.id);
    return i;
  };
  const mkTarget = async (institutionId: string, y: number, target: number, actual: number) => {
    const t = await db.enrollmentTarget.create({ data: { institutionId, year: y, target, actual }, select: { id: true } });
    targetIds.push(t.id);
    return t.id;
  };
  const ownerNotifs = () =>
    db.notification.findMany({ where: { userId: owner.user.id, type: "ENROLLMENT_TARGET_AT_RISK" }, select: { id: true, link: true, message: true } });

  try {
    const owned = await mkInst("Owned U", owner.user.id);
    const ownerless = await mkInst("Ownerless U", null);

    await mkTarget(owned.id, year, 100, 50);     // at risk (50% < 80%), has owner → should fire
    await mkTarget(owned.id, year, 100, 95);     // on track (95%) → ignored
    await mkTarget(owned.id, year - 1, 100, 10); // past year → ignored
    await mkTarget(ownerless.id, year, 100, 10); // at risk but no owner → skipped

    // ── Dry-run first: nothing should be written ───────────────────────────────
    const rDry = await runTargetAtRiskAlerts({ dryRun: true, now: inWindow });
    ok(rDry.inWindow && rDry.atRisk === 2, "dry-run sees 2 at-risk targets (owned + ownerless)", JSON.stringify(rDry));
    ok(rDry.notified === 1 && rDry.skipped === 1, "dry-run: 1 to notify (owned), 1 skipped (no owner)", JSON.stringify(rDry));
    ok((await ownerNotifs()).length === 0, "dry-run created no notification rows");

    // ── Live run ───────────────────────────────────────────────────────────────
    const r1 = await runTargetAtRiskAlerts({ dryRun: false, now: inWindow });
    ok(r1.notified === 1 && r1.skipped === 1, "live run notifies owner once, skips ownerless", JSON.stringify(r1));
    const n = await ownerNotifs();
    ok(n.length === 1, "account manager has exactly 1 at-risk notice", `got ${n.length}`);
    ok(!!n[0] && n[0].link!.includes(`/institutions/${owned.id}?target=${year}`), "notice links the institution + year", n[0]?.link ?? "");
    ok(!!n[0] && n[0].message.includes("50 of 100"), "message shows 50 of 100", n[0]?.message ?? "");

    // primary-owner-only: the RM gets nothing
    const rmCount = await db.notification.count({ where: { userId: rm.user.id, type: "ENROLLMENT_TARGET_AT_RISK" } });
    ok(rmCount === 0, "RM is NOT notified — primary owner (AM) only", `got ${rmCount}`);

    // ── Re-run de-dups ─────────────────────────────────────────────────────────
    const r2 = await runTargetAtRiskAlerts({ dryRun: false, now: inWindow });
    ok(r2.notified === 0 && r2.skipped === 2, "second run notifies nobody (de-duped + ownerless)", JSON.stringify(r2));
    ok((await ownerNotifs()).length === 1, "still exactly 1 notice after re-run");

    // ── Outside the window → nothing ──────────────────────────────────────────
    await db.notification.deleteMany({ where: { userId: owner.user.id, type: "ENROLLMENT_TARGET_AT_RISK" } });
    const rEarly = await runTargetAtRiskAlerts({ dryRun: false, now: tooEarly });
    ok(!rEarly.inWindow && rEarly.notified === 0 && rEarly.atRisk === 0, "far from year-end: no alerts", JSON.stringify(rEarly));
    ok((await ownerNotifs()).length === 0, "no notices created outside the window");
  } finally {
    await db.notification.deleteMany({ where: { userId: owner.user.id, type: "ENROLLMENT_TARGET_AT_RISK" } }).catch(() => {});
    for (const id of targetIds) await db.enrollmentTarget.delete({ where: { id } }).catch(() => {});
    for (const id of instIds) await db.institution.delete({ where: { id } }).catch(() => {});
    for (const u of [admin, owner, rm]) await destroyUser(u).catch(() => {});
    console.log(`\nTOTAL ${pass} pass / ${fail} fail`);
    await db.$disconnect();
    process.exit(fail ? 1 : 0);
  }
}
main().catch(async (e) => { console.error("[fatal]", e?.stack || e); await db.$disconnect(); process.exit(1); });
