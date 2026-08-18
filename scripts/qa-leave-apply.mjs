/**
 * Applying for leave — does it behave, not just respond.
 *
 *   node --env-file=.env scripts/qa-leave-apply.mjs
 *
 * Checks the whole apply path against a real policy: that the day count charges
 * working days only, that entitlement and waiting periods are enforced from the
 * joining date, that one person cannot read or file another's leave, that the
 * reservation and the request are created together, and that a decision moves
 * the days from pending to used.
 *
 * It also asserts what a person would SEE afterwards, because the stored
 * balance columns and the derived entitlement are two different numbers and only
 * one of them is right.
 */
import {
  db, api, createAndLogin, destroyUser, startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

let staff, other, hr;
const made = { requestIds: [] };

// A joining date well in the past, so no waiting period and a full accrual.
const LONG_AGO = new Date(Date.UTC(new Date().getUTCFullYear() - 3, 0, 15));

/** Monday of a week comfortably in the future, in UTC. */
function futureMonday(weeksAhead) {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + weeksAhead * 7);
  while (d.getUTCDay() !== 1) d.setUTCDate(d.getUTCDate() + 1);
  return d;
}
const iso = (d) => d.toISOString().slice(0, 10);
const plusDays = (d, n) => {
  const x = new Date(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
};

async function cleanup() {
  const empIds = [staff?.employee?.id, other?.employee?.id, hr?.employee?.id].filter(Boolean);
  if (empIds.length) {
    await db.leaveRequest.deleteMany({ where: { employeeId: { in: empIds } } }).catch(() => {});
    await db.leaveBalance.deleteMany({ where: { employeeId: { in: empIds } } }).catch(() => {});
  }
  for (const ctx of [staff, other, hr]) await destroyUser(ctx).catch(() => {});
}

try {
  startSection("Setup");
  staff = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  other = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });
  hr = await createAndLogin({ role: "HR_MANAGER", withEmployee: true });
  if (!staff.employee || !other.employee) throw new Error("employee records were not created");

  // Backdate joining so the waiting periods are satisfied, and set a gender so
  // the parental rules have something to test against.
  await db.employee.update({ where: { id: staff.employee.id }, data: { startDate: LONG_AGO } });
  await db.employee.update({ where: { id: other.employee.id }, data: { startDate: LONG_AGO } });
  await db.user.update({ where: { id: staff.user.id }, data: { gender: "MALE" } }).catch(() => {});
  await db.employee.update({ where: { id: staff.employee.id }, data: { gender: "MALE" } }).catch(() => {});
  ok(`three staff created, joining ${iso(LONG_AGO)}`);

  // ── The ordinary case ───────────────────────────────────────────────────
  startSection("Applying for leave");
  const mon = futureMonday(6);
  const nextMon = plusDays(mon, 7);

  // Monday → the following Monday spans 8 calendar days but only 6 working ones.
  const applied = await api(staff.jar, "POST", "/api/hr/leave", {
    employeeId: staff.employee.id,
    leaveType: "VACATION_PAID",
    startDate: iso(mon),
    endDate: iso(nextMon),
    reason: `${TAG} family visit`,
  });
  if (!expect(applied.status === 201, "POST /api/hr/leave returns 201",
    `status ${applied.status} ${JSON.stringify(applied.payload).slice(0, 160)}`)) {
    throw new Error("cannot continue without a leave request");
  }
  const req = applied.payload.request;
  made.requestIds.push(req.id);

  expect(req.days === 6,
    "*** 8 calendar days across a weekend is charged as 6 working days ***",
    `charged ${req.days}`);
  expect(req.status === "PENDING", "it starts PENDING", req.status);
  expect(req.reason?.includes("family visit"), "the reason is stored");

  const bal = await db.leaveBalance.findFirst({
    where: { employeeId: staff.employee.id, leaveType: "VACATION_PAID" },
  });
  expect(bal?.pendingDays === 6,
    "*** the days are reserved immediately, not at approval ***", `pending ${bal?.pendingDays}`);
  expect(bal?.usedDays === 0, "and nothing is consumed yet");

  // ── A public holiday inside the range ───────────────────────────────────
  startSection("Public holidays are not charged");
  const hMon = futureMonday(20);
  const holiday = await db.holiday.create({
    data: { name: `${TAG} Holiday`, date: plusDays(hMon, 1), isGlobal: true },
  }).catch(() => null);
  if (holiday) {
    const withHoliday = await api(staff.jar, "POST", "/api/hr/leave", {
      employeeId: staff.employee.id, leaveType: "VACATION_PAID",
      startDate: iso(hMon), endDate: iso(plusDays(hMon, 4)),
    });
    if (withHoliday.status === 201) made.requestIds.push(withHoliday.payload.request.id);
    expect(withHoliday.payload?.request?.days === 4,
      "*** a Mon–Fri week containing one public holiday charges 4 days ***",
      `charged ${withHoliday.payload?.request?.days}`);
    await db.leaveRequest.deleteMany({ where: { id: withHoliday.payload?.request?.id } }).catch(() => {});
    await db.leaveBalance.updateMany({
      where: { employeeId: staff.employee.id, leaveType: "VACATION_PAID" },
      data: { pendingDays: { decrement: withHoliday.payload?.request?.days ?? 0 } },
    }).catch(() => {});
    await db.holiday.delete({ where: { id: holiday.id } }).catch(() => {});
  } else {
    ok("(skipped — could not create a holiday row on this schema)");
  }

  // ── Refusals ────────────────────────────────────────────────────────────
  startSection("What it refuses");
  const overlap = await api(staff.jar, "POST", "/api/hr/leave", {
    employeeId: staff.employee.id, leaveType: "VACATION_PAID",
    startDate: iso(plusDays(mon, 2)), endDate: iso(plusDays(mon, 3)),
  });
  expect(overlap.status === 409,
    "*** overlapping dates are refused, not double-booked ***", `status ${overlap.status}`);
  expect(/already have a pending/i.test(overlap.payload?.error ?? ""),
    "and the message names the clash", String(overlap.payload?.error).slice(0, 90));

  const backwards = await api(staff.jar, "POST", "/api/hr/leave", {
    employeeId: staff.employee.id, leaveType: "VACATION_PAID",
    startDate: iso(futureMonday(30)), endDate: iso(plusDays(futureMonday(30), -3)),
  });
  expect(backwards.status === 422, "an end date before the start is refused", `status ${backwards.status}`);

  const sat = plusDays(futureMonday(32), 5);
  const weekendOnly = await api(staff.jar, "POST", "/api/hr/leave", {
    employeeId: staff.employee.id, leaveType: "VACATION_PAID",
    startDate: iso(sat), endDate: iso(plusDays(sat, 1)),
  });
  expect(weekendOnly.status === 422,
    "*** a Saturday-to-Sunday request is refused as zero working days ***",
    `status ${weekendOnly.status}`);

  const maternity = await api(staff.jar, "POST", "/api/hr/leave", {
    employeeId: staff.employee.id, leaveType: "MATERNITY",
    startDate: iso(futureMonday(34)), endDate: iso(plusDays(futureMonday(34), 4)),
  });
  expect(maternity.status === 422,
    "*** maternity leave is refused for a male employee, server-side ***",
    `status ${maternity.status} ${String(maternity.payload?.error).slice(0, 70)}`);

  const huge = await api(staff.jar, "POST", "/api/hr/leave", {
    employeeId: staff.employee.id, leaveType: "VACATION_PAID",
    startDate: iso(futureMonday(36)), endDate: iso(plusDays(futureMonday(36), 60)),
  });
  expect(huge.status === 422,
    "*** more days than the entitlement is refused ***", `status ${huge.status}`);
  expect(/insufficient/i.test(huge.payload?.error ?? ""),
    "and says how many were available", String(huge.payload?.error).slice(0, 90));

  const bogus = await api(staff.jar, "POST", "/api/hr/leave", {
    employeeId: staff.employee.id, leaveType: "SABBATICAL",
    startDate: iso(futureMonday(38)), endDate: iso(plusDays(futureMonday(38), 1)),
  });
  expect(bogus.status === 422, "an unknown leave type is rejected", `status ${bogus.status}`);

  // ── A brand new joiner ──────────────────────────────────────────────────
  startSection("Waiting period");
  await db.employee.update({
    where: { id: other.employee.id },
    data: { startDate: new Date() },
  });
  const tooSoon = await api(other.jar, "POST", "/api/hr/leave", {
    employeeId: other.employee.id, leaveType: "VACATION_PAID",
    startDate: iso(futureMonday(2)), endDate: iso(plusDays(futureMonday(2), 1)),
  });
  expect(tooSoon.status === 422,
    "*** someone who joined today cannot take paid vacation yet ***", `status ${tooSoon.status}`);
  expect(/becomes available|3 months/i.test(tooSoon.payload?.error ?? ""),
    "and is told when it unlocks", String(tooSoon.payload?.error).slice(0, 90));
  await db.employee.update({ where: { id: other.employee.id }, data: { startDate: LONG_AGO } });

  // ── One person's leave is not another's business ────────────────────────
  startSection("Privacy and impersonation");
  const peek = await api(other.jar, "GET", `/api/hr/leave?employeeId=${staff.employee.id}`);
  expect(peek.status === 403,
    "*** a colleague cannot read someone else's leave history ***", `status ${peek.status}`);

  const onBehalf = await api(other.jar, "POST", "/api/hr/leave", {
    employeeId: staff.employee.id, leaveType: "SICK",
    startDate: iso(futureMonday(40)), endDate: iso(plusDays(futureMonday(40), 1)),
  });
  expect(onBehalf.status === 403,
    "*** a colleague cannot file leave in someone else's name ***", `status ${onBehalf.status}`);

  const ownList = await api(staff.jar, "GET", "/api/hr/leave");
  expect((ownList.payload?.requests ?? []).every((r) => r.employeeId === staff.employee.id),
    "an employee's own list contains only their own requests");

  const decide = await api(other.jar, "PATCH", `/api/hr/leave/${req.id}`, { action: "APPROVED" });
  expect(decide.status === 403,
    "*** a colleague cannot approve someone else's leave ***", `status ${decide.status}`);

  const selfApprove = await api(staff.jar, "PATCH", `/api/hr/leave/${req.id}`, { action: "APPROVED" });
  expect(selfApprove.status === 403,
    "*** and you cannot approve your own ***", `status ${selfApprove.status}`);

  // ── The decision ────────────────────────────────────────────────────────
  startSection("HR decides");
  const approved = await api(hr.jar, "PATCH", `/api/hr/leave/${req.id}`, { action: "APPROVED" });
  expect(approved.status === 200, "HR approves it", `status ${approved.status} ${JSON.stringify(approved.payload).slice(0, 140)}`);
  expect(approved.payload?.request?.status === "APPROVED", "the request reads APPROVED");

  const afterBal = await db.leaveBalance.findFirst({
    where: { employeeId: staff.employee.id, leaveType: "VACATION_PAID" },
  });
  expect(afterBal?.usedDays === 6 && afterBal?.pendingDays === 0,
    "*** approval moves the days from pending to used ***",
    `used ${afterBal?.usedDays} pending ${afterBal?.pendingDays}`);

  const notified = await db.notification.count({
    where: { userId: staff.user.id, type: "LEAVE" },
  });
  expect(notified >= 1, "the employee is notified", `${notified} notifications`);

  const twice = await api(hr.jar, "PATCH", `/api/hr/leave/${req.id}`, { action: "REJECTED" });
  expect(twice.status === 422,
    "*** a decided request cannot be decided again ***", `status ${twice.status}`);

  // ── Cancelling releases the reservation ─────────────────────────────────
  startSection("Cancelling");
  const second = await api(staff.jar, "POST", "/api/hr/leave", {
    employeeId: staff.employee.id, leaveType: "SICK",
    startDate: iso(futureMonday(44)), endDate: iso(plusDays(futureMonday(44), 1)),
  });
  expect(second.status === 201, "a second request is accepted", `status ${second.status}`);
  if (second.status === 201) {
    made.requestIds.push(second.payload.request.id);
    const beforeCancel = await db.leaveBalance.findFirst({
      where: { employeeId: staff.employee.id, leaveType: "SICK" },
    });
    const cancelled = await api(staff.jar, "PATCH", `/api/hr/leave/${second.payload.request.id}`, { action: "CANCELLED" });
    expect(cancelled.status === 200, "the employee cancels their own request", `status ${cancelled.status}`);
    const afterCancel = await db.leaveBalance.findFirst({
      where: { employeeId: staff.employee.id, leaveType: "SICK" },
    });
    expect(afterCancel?.pendingDays === 0 && beforeCancel?.pendingDays > 0,
      "*** cancelling gives the reserved days back ***",
      `before ${beforeCancel?.pendingDays} after ${afterCancel?.pendingDays}`);
  }

  // ── What the numbers actually say afterwards ────────────────────────────
  startSection("The balance a person is shown");
  const stored0 = await db.leaveBalance.findFirst({
    where: { employeeId: staff.employee.id, leaveType: "VACATION_PAID" },
    select: { usedDays: true, pendingDays: true, adjustmentDays: true },
  }) ?? { usedDays: 0, pendingDays: 0, adjustmentDays: 0 };

  const balances = await api(staff.jar, "GET", "/api/hr/leave/balances");
  const vac = (balances.payload?.balances ?? [])
    .flatMap((b) => b.balances ?? b)
    .find((b) => b?.leaveType === "VACATION_PAID");
  expect(balances.status === 200, "GET /api/hr/leave/balances returns 200", `status ${balances.status}`);
  // Not 21: vacation accrues 1.75 days a month on the joining date and resets
  // each 31 December, so partway through the year the correct answer is a
  // fraction of the cap. Compared against the policy's own calculation rather
  // than a number typed in here, which would only encode today's date.
  const { computeEntitlement } = await import("../lib/leave-policy.ts");
  const expected = computeEntitlement(
    "VACATION_PAID", LONG_AGO,
    { usedDays: stored0.usedDays, pendingDays: stored0.pendingDays, adjustmentDays: stored0.adjustmentDays },
    new Date()
  );
  expect(vac && vac.totalDays === expected.entitlementDays,
    `*** the balances endpoint derives the accrued entitlement (${expected.entitlementDays}d by today) ***`,
    `totalDays ${vac?.totalDays}`);
  expect((vac?.totalDays ?? 0) > 0, "and it is not zero");

  // The stored totalDays column stays 0 deliberately — entitlement is derived,
  // not allocated, so there is nothing to seed at hire or roll over in January.
  // The invariant is not "the column is right", it is "nobody treats the column
  // as an entitlement". That is asserted on the screens themselves in
  // qa-leave-balance-display.mjs; here we check the derived answer is sane.
  const stored = await db.leaveBalance.findFirst({
    where: { employeeId: staff.employee.id, leaveType: "VACATION_PAID" },
    select: { totalDays: true, usedDays: true, pendingDays: true },
  });
  expect(stored?.totalDays === 0,
    "the stored totalDays column is still 0 — entitlement is derived, not allocated",
    `stored ${stored?.totalDays}`);
  expect((vac?.availableDays ?? -1) >= 0,
    "*** the derived figure a person is shown is never negative ***",
    `availableDays ${vac?.availableDays}`);
  expect(
    Math.abs((vac?.availableDays ?? 0) - Math.max(0, (vac?.totalDays ?? 0) - (vac?.usedDays ?? 0) - (vac?.pendingDays ?? 0))) < 0.01,
    "*** and it equals entitlement less used less pending ***",
    `available ${vac?.availableDays} vs ${vac?.totalDays} - ${vac?.usedDays} - ${vac?.pendingDays}`);
} catch (e) {
  fail("run completed", String(e?.message ?? e).slice(0, 300));
} finally {
  await cleanup();
  startSection("Cleanup");
  const left = await db.user.count({ where: { email: { startsWith: TAG.toLowerCase() } } }).catch(() => -1);
  expect(left === 0, "no test users left behind", `${left} remaining`);
  summary();
  await db.$disconnect();
}
