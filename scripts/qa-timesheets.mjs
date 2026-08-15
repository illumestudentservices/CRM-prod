/**
 * Timesheets — HTTP verification.
 *
 * The things worth testing hardest are the ones the spec is explicit about and
 * that fail silently if wrong:
 *
 *  - Nobody who is exempt gets a timesheet. The spec says plainly that ICRs
 *    must not be required to submit unless it is switched on for them.
 *  - The four hour figures are SYSTEM-CALCULATED. A request body must not be
 *    able to set them, and approved leave must actually reach the sheet.
 *  - An approved timesheet is read-only. That is the whole point of approval.
 *  - Entries belong to the employee. An approver may read a sheet and must not
 *    be able to rewrite the hours someone else claimed.
 *
 *   node --import tsx --env-file=.env scripts/qa-timesheets.mjs
 */

import {
  db, api, createAndLogin, destroyUser,
  startSection, expect, ok, fail, summary, TAG,
} from "./qa-lib.mjs";

// Dynamic, not static. A static `import ... from "../lib/timesheets.ts"` inside
// a .mjs run under tsx fails with "does not provide an export named ..." even
// though the exports are plainly there.
const { periodFor, expectedHoursFor } = await import("../lib/timesheets.ts");

const created = [];
const made = { employees: [], sheets: [], institutions: [], departments: [], leave: [] };

const iso = (d) => new Date(d).toISOString();

async function main() {
  startSection("Setup");

  const hr = await createAndLogin({ role: "HR_MANAGER", withEmployee: true });   created.push(hr);
  const staff = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });  created.push(staff);
  const boss = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });   created.push(boss);
  const icr = await createAndLogin({ role: "ICR", withEmployee: true });         created.push(icr);
  const other = await createAndLogin({ role: "EMPLOYEE", withEmployee: true });  created.push(other);

  if (!staff.employee || !boss.employee || !icr.employee) {
    fail("harness did not create employee records", "withEmployee returned nothing");
    return;
  }

  // Finance-style config: 40h week, weekly cadence, approved by `boss`.
  await db.employee.update({
    where: { id: staff.employee.id },
    data: {
      timesheetRequired: true,
      timesheetFrequency: "WEEKLY",
      standardWorkingHours: 40,
      timesheetApproverId: boss.employee.id,
      costCentre: `${TAG}-FIN`,
    },
  });
  // The ICR is deliberately left exempt.
  ok("staff configured for weekly timesheets; ICR left exempt");

  const dept = await db.department.create({ data: { name: `${TAG}-Dept` } });
  made.departments.push(dept.id);
  const inst = await db.institution.create({
    data: { name: `${TAG}-Client`, country: "Canada", type: "UNIVERSITY", createdById: hr.user.id },
  });
  made.institutions.push(inst.id);

  // ── Exemption ───────────────────────────────────────────────────────────
  startSection("Exempt staff are not issued timesheets");
  {
    const r = await api(icr.jar, "POST", "/api/hr/timesheets", {});
    expect(r.status === 409, "an exempt ICR cannot open a timesheet → 409", `got ${r.status}`);
    expect(String(r.payload?.error ?? "").includes("Timesheet Required"),
      "the refusal names the setting that controls it", JSON.stringify(r.payload?.error));

    const forced = await api(hr.jar, "POST", "/api/hr/timesheets", { employeeId: icr.employee.id });
    expect(forced.status === 409, "even HR cannot open one for an exempt employee → 409", `got ${forced.status}`);

    const count = await db.timesheet.count({ where: { employeeId: icr.employee.id } });
    expect(count === 0, "no timesheet row exists for the exempt ICR", `found ${count}`);
  }

  // ── Opening a period ────────────────────────────────────────────────────
  startSection("Opening a period");
  let sheetId;
  {
    const r = await api(staff.jar, "POST", "/api/hr/timesheets", {});
    expect(r.status === 201, "configured employee opens their period → 201", `got ${r.status} ${JSON.stringify(r.payload?.error ?? "")}`);
    sheetId = r.payload?.timesheet?.id;
    made.sheets.push(sheetId);

    const { periodStart, periodEnd } = periodFor("WEEKLY", new Date());
    const want = expectedHoursFor(40, periodStart, periodEnd);
    expect(r.payload?.timesheet?.expectedHours === want,
      `expected hours calculated from the standard week (${want}h for 5 working days)`,
      `got ${r.payload?.timesheet?.expectedHours}`);

    const again = await api(staff.jar, "POST", "/api/hr/timesheets", {});
    expect(again.status === 409, "opening the same period twice → 409 (idempotent)", `got ${again.status}`);
  }

  // ── Entries and calculated totals ───────────────────────────────────────
  startSection("Entries drive the totals");
  {
    const { periodStart, periodEnd } = periodFor("WEEKLY", new Date());
    const inPeriod = periodStart.toISOString().slice(0, 10);

    const a = await api(staff.jar, "POST", `/api/hr/timesheets/${sheetId}/entries`, {
      date: inPeriod, workCategory: "CLIENT_WORK",
      description: "Reconciliation for the Canada account", hours: 6,
      institutionId: inst.id, departmentId: dept.id,
    });
    expect(a.status === 201, "add a line → 201", `got ${a.status} ${JSON.stringify(a.payload?.error ?? "")}`);
    expect(a.payload?.totals?.loggedHours === 6, "logged hours recalculated to 6", `got ${a.payload?.totals?.loggedHours}`);

    await api(staff.jar, "POST", `/api/hr/timesheets/${sheetId}/entries`, {
      date: inPeriod, workCategory: "MEETINGS", description: "Month-end review", hours: 2.5,
    });
    const sheet = await db.timesheet.findUnique({ where: { id: sheetId } });
    expect(sheet.loggedHours === 8.5, "two lines sum to 8.5h", String(sheet.loggedHours));
    expect(sheet.totalAccountedHours === 8.5, "total accounted follows logged + leave", String(sheet.totalAccountedHours));
    expect(sheet.variance === Math.round((8.5 - sheet.expectedHours) * 100) / 100,
      "variance = accounted - expected", String(sheet.variance));

    // Outside the period must be refused, or approved totals stop matching
    // the lines behind them.
    const outside = new Date(periodEnd);
    outside.setUTCDate(outside.getUTCDate() + 3);
    const bad = await api(staff.jar, "POST", `/api/hr/timesheets/${sheetId}/entries`, {
      date: outside.toISOString().slice(0, 10), workCategory: "OTHER", description: "Out of range", hours: 1,
    });
    expect(bad.status === 422, "a date outside the period is refused → 422", `got ${bad.status}`);

    const junkClient = await api(staff.jar, "POST", `/api/hr/timesheets/${sheetId}/entries`, {
      date: inPeriod, workCategory: "CLIENT_WORK", description: "Bogus client", hours: 1,
      institutionId: "00000000-0000-0000-0000-000000000000",
    });
    expect(junkClient.status === 422, "an unknown client id is refused → 422", `got ${junkClient.status}`);
  }

  // ── Totals cannot be keyed in ───────────────────────────────────────────
  startSection("Hour figures are system-calculated, not user-supplied");
  {
    const before = await db.timesheet.findUnique({ where: { id: sheetId } });
    const r = await api(staff.jar, "PATCH", `/api/hr/timesheets/${sheetId}`, {
      toStatus: "SUBMITTED",
      loggedHours: 999, expectedHours: 1, variance: 0, totalAccountedHours: 999,
    });
    expect(r.status === 200, "submit accepted", `got ${r.status}`);
    const after = await db.timesheet.findUnique({ where: { id: sheetId } });
    expect(after.loggedHours === before.loggedHours,
      "forged loggedHours in the body was ignored", `${before.loggedHours} → ${after.loggedHours}`);
    expect(after.expectedHours === before.expectedHours,
      "forged expectedHours was ignored", `${before.expectedHours} → ${after.expectedHours}`);
  }

  // ── Approved leave reaches the sheet ────────────────────────────────────
  startSection("Approved leave is pulled from Leave Management");
  {
    const { periodStart } = periodFor("WEEKLY", new Date());
    const lv = await db.leaveRequest.create({
      data: {
        employeeId: staff.employee.id, leaveType: "VACATION_PAID",
        startDate: periodStart, endDate: periodStart, days: 1, status: "APPROVED",
      },
    });
    made.leave.push(lv.id);

    // Recalculation happens on transition, so drive one.
    await api(boss.jar, "PATCH", `/api/hr/timesheets/${sheetId}`, { toStatus: "MANAGER_REVIEW" });
    const s = await db.timesheet.findUnique({ where: { id: sheetId } });
    expect(s.approvedLeaveHours === 8,
      "one approved leave day on a 40h week = 8h leave", String(s.approvedLeaveHours));
    expect(s.totalAccountedHours === 16.5,
      "total accounted = 8.5 logged + 8 leave", String(s.totalAccountedHours));

    // Pending leave must NOT count, or an employee could close their variance
    // with leave they never actually get.
    const pending = await db.leaveRequest.create({
      data: {
        employeeId: staff.employee.id, leaveType: "SICK",
        startDate: periodStart, endDate: periodStart, days: 1, status: "PENDING",
      },
    });
    made.leave.push(pending.id);
    await api(boss.jar, "GET", `/api/hr/timesheets/${sheetId}`);
    const s2 = await db.timesheet.findUnique({ where: { id: sheetId } });
    expect(s2.approvedLeaveHours === 8, "pending leave did NOT count", String(s2.approvedLeaveHours));
  }

  // ── Who may do what ─────────────────────────────────────────────────────
  startSection("Roles and ownership");
  {
    const foreign = await api(other.jar, "GET", `/api/hr/timesheets/${sheetId}`);
    expect(foreign.status === 404, "an unrelated employee gets 404, not 403", `got ${foreign.status}`);

    // The approver may read it but must not rewrite the employee's hours.
    const approverEdit = await api(boss.jar, "POST", `/api/hr/timesheets/${sheetId}/entries`, {
      date: periodFor("WEEKLY", new Date()).periodStart.toISOString().slice(0, 10),
      workCategory: "OTHER", description: "Approver meddling", hours: 3,
    });
    expect(approverEdit.status === 403 || approverEdit.status === 409,
      "the approver cannot add lines to someone else's sheet", `got ${approverEdit.status}`);

    // The employee cannot approve their own timesheet.
    const selfApprove = await api(staff.jar, "PATCH", `/api/hr/timesheets/${sheetId}`, { toStatus: "APPROVED" });
    expect(selfApprove.status === 403 || selfApprove.status === 409,
      "an employee cannot approve their own timesheet", `got ${selfApprove.status}`);
  }

  // ── Amendments loop ─────────────────────────────────────────────────────
  startSection("Amendments loop");
  {
    const noReason = await api(boss.jar, "PATCH", `/api/hr/timesheets/${sheetId}`, {
      toStatus: "AMENDMENTS_REQUIRED",
    });
    expect(noReason.status === 422, "returning with no reason → 422", `got ${noReason.status}`);

    const ret = await api(boss.jar, "PATCH", `/api/hr/timesheets/${sheetId}`, {
      toStatus: "AMENDMENTS_REQUIRED", notes: "Tuesday's 6 hours needs a fuller description.",
    });
    expect(ret.status === 200, "returned for amendment → 200", `got ${ret.status}`);

    const notified = await db.notification.count({
      where: { userId: staff.user.id, type: "TIMESHEET", title: "Timesheet needs amendments" },
    });
    expect(notified === 1, "the employee was notified", `found ${notified}`);

    // Editable again while amendments are required.
    const edit = await api(staff.jar, "POST", `/api/hr/timesheets/${sheetId}/entries`, {
      date: periodFor("WEEKLY", new Date()).periodStart.toISOString().slice(0, 10),
      workCategory: "ADMINISTRATION", description: "Added detail after review", hours: 1,
    });
    expect(edit.status === 201, "employee can edit again after a return", `got ${edit.status}`);

    await api(staff.jar, "PATCH", `/api/hr/timesheets/${sheetId}`, { toStatus: "SUBMITTED" });
  }

  // ── Approval makes it read-only ─────────────────────────────────────────
  startSection("Approved timesheets are read-only");
  {
    const appr = await api(boss.jar, "PATCH", `/api/hr/timesheets/${sheetId}`, { toStatus: "APPROVED" });
    expect(appr.status === 200, "approver approves → 200", `got ${appr.status} ${JSON.stringify(appr.payload?.error ?? "")}`);

    const s = await db.timesheet.findUnique({ where: { id: sheetId } });
    expect(s.status === "APPROVED" && s.approvedAt !== null, "status APPROVED with a timestamp", s.status);

    const addAfter = await api(staff.jar, "POST", `/api/hr/timesheets/${sheetId}/entries`, {
      date: periodFor("WEEKLY", new Date()).periodStart.toISOString().slice(0, 10),
      workCategory: "OTHER", description: "Sneaky late entry", hours: 4,
    });
    expect(addAfter.status === 409, "*** cannot add lines to an approved timesheet → 409 ***", `got ${addAfter.status}`);

    const reopen = await api(staff.jar, "PATCH", `/api/hr/timesheets/${sheetId}`, { toStatus: "DRAFT" });
    expect(reopen.status === 409, "cannot move an approved timesheet back to draft → 409", `got ${reopen.status}`);

    const hrReopen = await api(hr.jar, "PATCH", `/api/hr/timesheets/${sheetId}`, { toStatus: "AMENDMENTS_REQUIRED", notes: "HR trying to reopen" });
    expect(hrReopen.status === 409, "not even HR can reopen an approved timesheet → 409", `got ${hrReopen.status}`);
  }

  // ── History ─────────────────────────────────────────────────────────────
  startSection("Version and approval history");
  {
    const events = await db.timesheetEvent.findMany({
      where: { timesheetId: sheetId }, select: { action: true },
    });
    const actions = events.map((e) => e.action);
    for (const want of ["PERIOD_OPENED", "ENTRY_ADDED", "SUBMITTED", "AMENDMENTS_REQUIRED", "APPROVED"]) {
      expect(actions.includes(want), `history records ${want}`, actions.join(","));
    }
  }

  // ── Reporting ───────────────────────────────────────────────────────────
  startSection("Reporting dimensions");
  {
    const r = await api(hr.jar, "GET", "/api/hr/timesheets/reporting");
    expect(r.status === 200, "reporting → 200", `got ${r.status}`);
    for (const dim of ["byEmployee", "byDepartment", "byPeriod", "byCategory", "byClient", "byCostCentre", "byStatus"]) {
      expect(Array.isArray(r.payload?.[dim]), `reports ${dim}`, typeof r.payload?.[dim]);
    }
    const cat = (r.payload?.byCategory ?? []).find((c) => c.key === "CLIENT_WORK");
    expect(!!cat && cat.hours >= 6, "client work hours aggregated by category", JSON.stringify(cat));
    const client = (r.payload?.byClient ?? []).find((c) => c.label?.includes(TAG));
    expect(!!client, "hours attributed to the client they were booked against", JSON.stringify(client));
  }
}

async function teardown() {
  for (const id of made.sheets) await db.timesheet.delete({ where: { id } }).catch(() => {});
  await db.timesheet.deleteMany({ where: { employee: { user: { email: { contains: TAG.toLowerCase() } } } } }).catch(() => {});
  for (const id of made.leave) await db.leaveRequest.delete({ where: { id } }).catch(() => {});
  for (const c of created) {
    if (c?.user?.id) await db.notification.deleteMany({ where: { userId: c.user.id } }).catch(() => {});
  }
  for (const c of created) await destroyUser(c);
  for (const id of made.institutions) await db.institution.delete({ where: { id } }).catch(() => {});
  for (const id of made.departments) await db.department.delete({ where: { id } }).catch(() => {});
}

try {
  await main();
} catch (e) {
  console.error("\n[harness crashed]", e?.code ?? "", e?.message ?? "(empty)", "\n", e);
  fail("harness crashed", `${e.code ?? ""} ${e.message}`);
} finally {
  await teardown();
  const leftSheets = await db.timesheet.count().catch(() => -1);
  const leftEntries = await db.timesheetEntry.count().catch(() => -1);
  process.stdout.write(`\n[cleanup] timesheets remaining: ${leftSheets}, entries: ${leftEntries}\n`);
  await db.$disconnect();
}
summary();
