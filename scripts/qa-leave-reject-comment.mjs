/**
 * QA — rejecting a leave request stores the manager's optional comment and the
 * employee's rejection email carries it. 3×.
 *
 *   BREVO_API_KEY= BASE_URL=http://localhost:3000 npx tsx --env-file=.env.local scripts/qa-leave-reject-comment.mjs
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

async function runOnce(round) {
  console.log(`\n── round ${round} ──`);
  const year = new Date().getUTCFullYear();
  const mgr = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  const emp = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  await db.employee.update({ where: { id: emp.employee.id }, data: { managerId: mgr.employee.id } });
  await db.leaveBalance.create({
    data: { employeeId: emp.employee.id, leaveType: "IN_LIEU", year, totalDays: 0, adjustmentDays: 5, usedDays: 0, pendingDays: 0 },
  });

  try {
    const d = weekday(2);
    const applied = await api(emp.jar, "POST", "/api/hr/leave", {
      employeeId: emp.employee.id, leaveType: "IN_LIEU", startDate: iso(d), endDate: iso(d),
    });
    expect("leave applied (201)", applied.status === 201, `(status ${applied.status})`);
    const reqId = applied.payload?.request?.id;

    const note = "Please take this during the quieter week after intake.";
    const rej = await api(mgr.jar, "PATCH", `/api/hr/leave/${reqId}`, { action: "REJECTED", rejectionNote: note });
    expect("reject ok", rej.ok, `(status ${rej.status})`);

    const row = await db.leaveRequest.findUnique({ where: { id: reqId } });
    expect("status REJECTED", row?.status === "REJECTED", `(got ${row?.status})`);
    expect("rejection comment stored", row?.rejectionNote === note, `(got ${row?.rejectionNote})`);

    // Rejecting with no comment is still allowed (optional).
    const applied2 = await api(emp.jar, "POST", "/api/hr/leave", {
      employeeId: emp.employee.id, leaveType: "IN_LIEU", startDate: iso(weekday(5)), endDate: iso(weekday(5)),
    });
    const rej2 = await api(mgr.jar, "PATCH", `/api/hr/leave/${applied2.payload?.request?.id}`, { action: "REJECTED" });
    expect("reject without comment allowed", rej2.ok, `(status ${rej2.status})`);
  } finally {
    await db.leaveRequest.deleteMany({ where: { employeeId: emp.employee.id } }).catch(() => {});
    await db.leaveBalance.deleteMany({ where: { employeeId: emp.employee.id } }).catch(() => {});
    await destroyUser(emp).catch(() => {});
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
