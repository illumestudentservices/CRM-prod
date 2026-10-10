/**
 * A manager sees their team's leave balances. Only a Super Admin can change one.
 *
 *   node --import tsx --env-file=.env.local scripts/qa-leave-balance-access.mjs
 *
 * The two halves are checked separately on purpose, because they fail
 * differently. Read access that is too narrow is an annoyance — a manager
 * cannot answer "how much leave have I got left?" about their own team. Write
 * access that is too wide is a hole: an adjustment overrides the accrual
 * policy, has no approval step behind it and no second pair of eyes, so
 * whoever can reach the endpoint can quietly grant themselves a fortnight.
 *
 * The cast:
 *
 *     boss (REGIONAL_MANAGER) -> report  (EMPLOYEE)
 *     hr   (HR_MANAGER)        sees all, must NOT be able to adjust
 *     admin (SUPER_ADMIN)      sees all, may adjust
 *     stranger (EMPLOYEE)      sees only themselves
 */
import {
  db, createAndLogin, destroyUser, api,
  startSection, expect, summary, TAG,
} from "./qa-lib.mjs";

const ctxs = [];
const YEAR = new Date().getUTCFullYear();

/** Employee ids present in a balances response. */
const idsIn = (payload) =>
  new Set((payload?.balances ?? []).map((b) => b.employee?.id).filter(Boolean));

async function main() {
  startSection("A manager, their report, and two onlookers");

  const boss = await createAndLogin({ role: "REGIONAL_MANAGER", withEmployee: true });
  ctxs.push(boss);
  const report = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(report);
  const stranger = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  ctxs.push(stranger);
  const hr = await createAndLogin({ role: "HR_MANAGER", withEmployee: true });
  ctxs.push(hr);
  const admin = await createAndLogin({ role: "SUPER_ADMIN", withEmployee: true });
  ctxs.push(admin);

  const threeYearsAgo = new Date(Date.UTC(new Date().getUTCFullYear() - 3, 0, 15));
  for (const c of [boss, report, stranger, hr, admin]) {
    await db.employee.update({
      where: { id: c.employee.id },
      data: { startDate: threeYearsAgo, gender: "FEMALE" },
    });
  }
  await db.employee.update({
    where: { id: report.employee.id }, data: { managerId: boss.employee.id },
  });
  expect(true, "the report reports to the manager");

  // ── Reading ──────────────────────────────────────────────────────────────
  startSection("Who can see whose balances");

  const asBoss = await api(boss.jar, "GET", `/api/hr/leave/balances?year=${YEAR}`);
  const bossSees = idsIn(asBoss.payload);
  expect(bossSees.has(report.employee.id),
    "*** a manager sees their direct report's balance ***",
    `${bossSees.size} employee(s) returned`);
  expect(bossSees.has(boss.employee.id), "and their own");
  expect(!bossSees.has(stranger.employee.id),
    "*** but nobody else's ***", `${bossSees.size} employee(s) returned`);
  expect(bossSees.size === 2, "exactly two people", `${bossSees.size}`);

  const asReport = await api(report.jar, "GET", `/api/hr/leave/balances?year=${YEAR}`);
  const reportSees = idsIn(asReport.payload);
  expect(reportSees.size === 1 && reportSees.has(report.employee.id),
    "somebody with no reports sees only themselves", `${reportSees.size} employee(s)`);

  const asStranger = await api(stranger.jar, "GET", `/api/hr/leave/balances?year=${YEAR}`);
  expect(!idsIn(asStranger.payload).has(report.employee.id),
    "*** an unrelated colleague sees nothing of theirs ***");

  const asHr = await api(hr.jar, "GET", `/api/hr/leave/balances?year=${YEAR}`);
  expect(idsIn(asHr.payload).size > 2, "HR still sees everybody",
    `${idsIn(asHr.payload).size} employee(s)`);

  // ── Writing ──────────────────────────────────────────────────────────────
  startSection("Who can change one");

  expect(asBoss.payload?.canEdit === false,
    "the manager is told they cannot edit", String(asBoss.payload?.canEdit));
  expect(asHr.payload?.canEdit === false,
    "*** and so is HR — this is narrower than the rest of the screen ***",
    String(asHr.payload?.canEdit));

  const asAdmin = await api(admin.jar, "GET", `/api/hr/leave/balances?year=${YEAR}`);
  expect(asAdmin.payload?.canEdit === true, "a Super Admin is told they can");

  const body = {
    employeeId: report.employee.id,
    leaveType: "VACATION_PAID",
    year: YEAR,
    adjustmentDays: 7,
    reason: `${TAG} access probe`,
  };

  const bossWrite = await api(boss.jar, "PATCH", "/api/hr/leave/balances", body);
  expect(bossWrite.status === 403, "*** the manager cannot adjust their report's balance ***",
    `status ${bossWrite.status}`);

  const hrWrite = await api(hr.jar, "PATCH", "/api/hr/leave/balances", body);
  expect(hrWrite.status === 403, "*** nor can HR ***", `status ${hrWrite.status}`);
  expect(/Super Admin/i.test(JSON.stringify(hrWrite.payload)),
    "and the refusal says who can", JSON.stringify(hrWrite.payload).slice(0, 110));

  const strangerWrite = await api(stranger.jar, "PATCH", "/api/hr/leave/balances", body);
  expect(strangerWrite.status === 403, "nor an unrelated colleague", `status ${strangerWrite.status}`);

  const untouched = await db.leaveBalance.findFirst({
    where: { employeeId: report.employee.id, leaveType: "VACATION_PAID", year: YEAR },
    select: { adjustmentDays: true },
  });
  expect(!untouched || untouched.adjustmentDays === 0,
    "after all three attempts the balance is unchanged",
    `adjustment is ${untouched?.adjustmentDays ?? "(no row)"}`);

  const adminWrite = await api(admin.jar, "PATCH", "/api/hr/leave/balances", body);
  expect(adminWrite.status === 200, "*** a Super Admin can ***",
    `status ${adminWrite.status} ${JSON.stringify(adminWrite.payload).slice(0, 120)}`);

  const after = await db.leaveBalance.findFirst({
    where: { employeeId: report.employee.id, leaveType: "VACATION_PAID", year: YEAR },
    select: { adjustmentDays: true },
  });
  expect(after?.adjustmentDays === 7, "and the adjustment lands",
    `adjustment is ${after?.adjustmentDays}`);

  // ── Leave history ────────────────────────────────────────────────────────
  startSection("A manager sees what their team has already taken");

  const past = await db.leaveRequest.create({
    data: {
      employeeId: report.employee.id,
      leaveType: "VACATION_PAID",
      startDate: new Date(Date.UTC(2026, 4, 11)),
      endDate: new Date(Date.UTC(2026, 4, 13)),
      days: 3,
      reason: `${TAG} already taken`,
      status: "APPROVED",
    },
    select: { id: true },
  });

  const bossHistory = await api(boss.jar, "GET", "/api/hr/leave?scope=team");
  const mine = (bossHistory.payload?.requests ?? []).filter(
    (r) => r.employee?.id === report.employee.id);
  expect(mine.some((r) => r.id === past.id),
    "*** the manager sees a decided request from their report ***",
    `${mine.length} request(s) returned`);
  const histRow = mine.find((r) => r.id === past.id);
  expect(histRow?.status === "APPROVED", "with its outcome", String(histRow?.status));
  expect(histRow?.canDecide === false, "and no decision control on a settled one",
    String(histRow?.canDecide));

  // The payload must not quietly carry the rest of the employee record.
  const leaked = Object.keys(histRow?.employee ?? {}).filter(
    (k) => !["id", "employeeId", "managerId", "user"].includes(k));
  expect(leaked.length === 0,
    "*** and no personal detail beyond a name rides along ***", leaked.join(", "));

  const strangerHistory = await api(stranger.jar, "GET", "/api/hr/leave?scope=team");
  expect(!(strangerHistory.payload?.requests ?? []).some((r) => r.id === past.id),
    "*** somebody with no reports sees none of it ***");

  const targeted = await api(stranger.jar, "GET",
    `/api/hr/leave?scope=team&employeeId=${report.employee.id}`);
  expect(targeted.status === 403 || !(targeted.payload?.requests ?? []).length,
    "nor by asking for that employee directly", `status ${targeted.status}`);

  startSection("The manager sees the result of it");
  const afterBoss = await api(boss.jar, "GET", `/api/hr/leave/balances?year=${YEAR}`);
  const row = (afterBoss.payload?.balances ?? []).find(
    (b) => b.employee?.id === report.employee.id && b.leaveType === "VACATION_PAID");
  expect(!!row && row.adjustmentDays === 7,
    "the adjusted figure is visible to the manager", `adjustment ${row?.adjustmentDays}`);
}

let code = 1;
try { await main(); code = summary(); }
catch (e) { console.error("\nFATAL:", e.message, "\n", (e.stack ?? "").split("\n").slice(0, 4).join("\n")); }
finally {
  startSection("Teardown");
  for (const c of ctxs) {
    if (c.employee) {
      await db.employee.updateMany({ where: { managerId: c.employee.id }, data: { managerId: null } }).catch(() => {});
    }
  }
  for (const c of ctxs) {
    if (c.employee) {
      await db.leaveBalance.deleteMany({ where: { employeeId: c.employee.id } }).catch(() => {});
      await db.leaveRequest.deleteMany({ where: { employeeId: c.employee.id } }).catch(() => {});
    }
    await destroyUser(c);
  }
  const left = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } });
  expect(left === 0, "disposable users removed", `${left} left`);
  await db.$disconnect();
}
process.exit(code === 0 ? 0 : 1);
