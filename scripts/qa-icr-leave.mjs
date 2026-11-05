/**
 * QA — ICR-only leave coverage checks.
 *
 *   Apply (ICR):   must confirm the institution manager was informed.
 *   Approve (ICR): manager must confirm institution rep informed + work covered.
 *   Non-ICR:       neither is required.
 * 3× for stability.
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-icr-leave.mjs
 */
import { db, createAndLogin, destroyUser, api } from "./qa-lib.mjs";

let pass = 0, fail = 0;
function expect(name, cond, extra = "") {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
const iso = (d) => d.toISOString().slice(0, 10);
function weekday(n) {
  const d = new Date(); d.setUTCHours(12, 0, 0, 0); d.setUTCDate(d.getUTCDate() + n);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}

async function setup(role, mgrEmpId, year) {
  const ctx = await createAndLogin({ role, withEmployee: true });
  await db.employee.update({ where: { id: ctx.employee.id }, data: { managerId: mgrEmpId } });
  // Give them in-lieu balance so a booking can actually be made (no waiting).
  await db.leaveBalance.create({
    data: { employeeId: ctx.employee.id, leaveType: "IN_LIEU", year, totalDays: 0, adjustmentDays: 5, usedDays: 0, pendingDays: 0 },
  });
  return ctx;
}
async function cleanup(ctx) {
  if (!ctx?.employee) return;
  await db.leaveRequest.deleteMany({ where: { employeeId: ctx.employee.id } }).catch(() => {});
  await db.leaveBalance.deleteMany({ where: { employeeId: ctx.employee.id } }).catch(() => {});
  await destroyUser(ctx).catch(() => {});
}

async function runOnce(round) {
  console.log(`\n── round ${round} ──`);
  const year = new Date().getUTCFullYear();
  const mgr = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  const icr = await setup("ICR", mgr.employee.id, year);
  const emp = await setup("EMPLOYEE", mgr.employee.id, year);
  const bookDates = () => { const d = weekday(2); return { startDate: iso(d), endDate: iso(d) }; };

  try {
    // 1. ICR apply WITHOUT the confirmation → refused
    const a1 = await api(icr.jar, "POST", "/api/hr/leave", { employeeId: icr.employee.id, leaveType: "IN_LIEU", ...bookDates() });
    expect("ICR apply without confirmation refused (422)", a1.status === 422, `(status ${a1.status})`);
    expect("refusal mentions the institution", /institution/i.test(a1.payload?.error ?? ""), `(${a1.payload?.error})`);

    // 2. ICR apply WITH confirmation → allowed, flag stored
    const a2 = await api(icr.jar, "POST", "/api/hr/leave", { employeeId: icr.employee.id, leaveType: "IN_LIEU", ...bookDates(), informedInstitution: true });
    expect("ICR apply with confirmation allowed (201)", a2.status === 201, `(status ${a2.status})`);
    const reqId = a2.payload?.request?.id;
    const row = await db.leaveRequest.findUnique({ where: { id: reqId } });
    expect("informedInstitution stored true", row?.informedInstitution === true, `(got ${row?.informedInstitution})`);

    // 3. Manager approve ICR leave WITHOUT the two checks → refused
    const d1 = await api(mgr.jar, "PATCH", `/api/hr/leave/${reqId}`, { action: "APPROVED" });
    expect("approve ICR leave without checks refused (422)", d1.status === 422, `(status ${d1.status})`);

    // 4. Manager approve WITH both checks + note → allowed, stored
    const d2 = await api(mgr.jar, "PATCH", `/api/hr/leave/${reqId}`, {
      action: "APPROVED", coverageVerified: true, workCovered: true, coverageNote: "Jane covers University of X",
    });
    expect("approve ICR leave with checks allowed", d2.ok, `(status ${d2.status})`);
    const row2 = await db.leaveRequest.findUnique({ where: { id: reqId } });
    expect("coverage flags + note stored",
      row2?.coverageVerified === true && row2?.workCovered === true && row2?.coverageNote === "Jane covers University of X",
      `(v=${row2?.coverageVerified} c=${row2?.workCovered} note=${row2?.coverageNote})`);

    // 5. Non-ICR apply WITHOUT confirmation → allowed
    const b1 = await api(emp.jar, "POST", "/api/hr/leave", { employeeId: emp.employee.id, leaveType: "IN_LIEU", ...bookDates() });
    expect("non-ICR apply without confirmation allowed (201)", b1.status === 201, `(status ${b1.status})`);
    const empReqId = b1.payload?.request?.id;

    // 6. Manager approve non-ICR leave WITHOUT checks → allowed
    const b2 = await api(mgr.jar, "PATCH", `/api/hr/leave/${empReqId}`, { action: "APPROVED" });
    expect("approve non-ICR leave without checks allowed", b2.ok, `(status ${b2.status})`);
  } finally {
    await cleanup(icr); await cleanup(emp);
    await db.leaveRequest.deleteMany({ where: { employeeId: mgr.employee.id } }).catch(() => {});
    await destroyUser(mgr).catch(() => {});
  }
}

async function run() {
  try { for (let r = 1; r <= 3; r++) await runOnce(r); }
  finally { await db.$disconnect().catch(() => {}); }
  console.log(`\n  ${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}
run().catch(async (e) => { console.error("qa crashed", e); await db.$disconnect().catch(() => {}); process.exit(1); });
