/**
 * Withdraw an APPROVED leave:
 *   - the employee's MANAGER and HR can (days return to the USED balance);
 *   - the employee themselves CANNOT (403), nor an unrelated user;
 *   - an already-cancelled request is 422;
 *   - PENDING self-withdraw still works and reverses the PENDING hold.
 *
 *   npx tsx --env-file=.env.local scripts/qa-leave-withdraw-approved.mjs
 */
import { db, createAndLogin, destroyUser, api, startSection, expect, summary } from "./qa-lib.mjs";

const YEAR = 2026;
const day = (d) => new Date(Date.UTC(YEAR, 5, d)); // June 2026 weekdays-ish
let emp, mgr, hr, outsider, balanceId, reqIds = [];

async function makeApproved(days = 2) {
  const r = await db.leaveRequest.create({
    data: { employeeId: emp.employee.id, leaveType: "VACATION_PAID", startDate: day(1), endDate: day(2), days, status: "APPROVED", reason: "QA approved" },
  });
  reqIds.push(r.id);
  return r;
}
const used = async () => (await db.leaveBalance.findUnique({ where: { id: balanceId }, select: { usedDays: true } })).usedDays;
const pending = async () => (await db.leaveBalance.findUnique({ where: { id: balanceId }, select: { pendingDays: true } })).pendingDays;

try {
  emp = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  mgr = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  hr = await createAndLogin({ role: "HR_MANAGER", withEmployee: true });
  outsider = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  await db.employee.update({ where: { id: emp.employee.id }, data: { managerId: mgr.employee.id } });
  const bal = await db.leaveBalance.create({ data: { employeeId: emp.employee.id, leaveType: "VACATION_PAID", year: YEAR, totalDays: 30, usedDays: 20, pendingDays: 3 } });
  balanceId = bal.id;

  // ── Who may withdraw an approved leave ──────────────────────────────────
  startSection("Only manager / HR may withdraw an approved leave");
  let a = await makeApproved();
  let r = await api(emp.jar, "PATCH", `/api/hr/leave/${a.id}`, { action: "CANCELLED" });
  expect(r.status === 403, "the employee CANNOT withdraw their own approved leave", `got ${r.status}`);
  r = await api(outsider.jar, "PATCH", `/api/hr/leave/${a.id}`, { action: "CANCELLED" });
  expect(r.status === 403, "an unrelated user cannot either", `got ${r.status}`);
  r = await api(hr.jar, "PATCH", `/api/hr/leave/${a.id}`, { action: "CANCELLED" });
  expect(r.ok, "HR can withdraw it", `got ${r.status}: ${JSON.stringify(r.payload)?.slice(0,140)}`);
  r = await api(hr.jar, "PATCH", `/api/hr/leave/${a.id}`, { action: "CANCELLED" });
  expect(r.status === 422, "withdrawing an already-cancelled one is refused (422)", `got ${r.status}`);

  // ── Manager withdraw × 3, each returns days to USED ─────────────────────
  startSection("Manager withdraws an approved leave (×3) — days return to used");
  for (let i = 1; i <= 3; i++) {
    const req = await makeApproved(2);
    const before = await used();
    r = await api(mgr.jar, "PATCH", `/api/hr/leave/${req.id}`, { action: "CANCELLED" });
    expect(r.ok, `run ${i}: manager withdrew the approved leave`, `got ${r.status}`);
    const row = await db.leaveRequest.findUnique({ where: { id: req.id }, select: { status: true } });
    expect(row.status === "CANCELLED", `run ${i}: status is CANCELLED`);
    expect((await used()) === before - 2, `run ${i}: used days returned (−2)`, `before ${before} after ${await used()}`);
  }

  // ── No regression: pending self-withdraw still reverses pending ─────────
  startSection("Pending self-withdraw still works (reverses pending)");
  const p = await db.leaveRequest.create({ data: { employeeId: emp.employee.id, leaveType: "VACATION_PAID", startDate: day(10), endDate: day(10), days: 1, status: "PENDING", reason: "QA pending" } });
  reqIds.push(p.id);
  const pendBefore = await pending();
  r = await api(emp.jar, "PATCH", `/api/hr/leave/${p.id}`, { action: "CANCELLED" });
  expect(r.ok, "employee withdrew their own pending request", `got ${r.status}`);
  expect((await pending()) === pendBefore - 1, "pending days reversed (−1)", `before ${pendBefore} after ${await pending()}`);
} catch (e) {
  console.error("\n[fatal]", e?.stack || e);
  process.exitCode = 1;
} finally {
  for (const id of reqIds) await db.leaveRequest.delete({ where: { id } }).catch(() => {});
  if (balanceId) await db.leaveBalance.delete({ where: { id: balanceId } }).catch(() => {});
  if (emp) await db.employee.update({ where: { id: emp.employee.id }, data: { managerId: null } }).catch(() => {});
  for (const u of [emp, mgr, hr, outsider]) if (u) await destroyUser(u);
  const f = summary();
  await db.$disconnect();
  process.exit(f ? 1 : (process.exitCode ?? 0));
}
