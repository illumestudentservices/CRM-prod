import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { displayNameOr } from "@/lib/person-name";
import { isTimesheetAdmin, round2, workCategoryLabel } from "@/lib/timesheets";

/**
 * Timesheet reporting.
 *
 * Spec: support reporting by Employee, Department, Period, Work Category,
 * Client, Cost Centre and Approval Status. All seven are returned from one
 * call, because the answer to "where did the time go" is usually a comparison
 * across two of them at once and round-tripping per dimension makes the screen
 * flicker through inconsistent states.
 *
 * Every figure here is aggregated from stored entries. Nothing is keyed in.
 */

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { role, id: userId } = session.user;

  const admin = isTimesheetAdmin(role);
  const me = await db.employee.findFirst({ where: { userId }, select: { id: true } });

  // Non-HR sees only what they own or approve. Reporting across the business is
  // an HR view; an approver aggregating everyone's hours would be a quiet
  // widening of access through a reporting endpoint.
  if (!admin && !me) {
    return NextResponse.json({ error: "You have no employee record." }, { status: 403 });
  }

  const sp = req.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const status = sp.get("status");
  const employeeId = sp.get("employeeId");

  const sheetWhere: Record<string, unknown> = {};
  if (from) sheetWhere.periodStart = { gte: new Date(`${from.slice(0, 10)}T00:00:00.000Z`) };
  if (to) sheetWhere.periodEnd = { lte: new Date(`${to.slice(0, 10)}T00:00:00.000Z`) };
  if (status) sheetWhere.status = status;
  if (employeeId && admin) sheetWhere.employeeId = employeeId;
  if (!admin) {
    sheetWhere.OR = [
      { employeeId: me!.id },
      { approverId: me!.id },
      { employee: { timesheetApproverId: me!.id } },
      { employee: { managerId: me!.id, timesheetApproverId: null } },
    ];
  }

  const sheets = await db.timesheet.findMany({
    where: sheetWhere,
    select: {
      id: true,
      status: true,
      periodStart: true,
      periodEnd: true,
      frequency: true,
      expectedHours: true,
      loggedHours: true,
      approvedLeaveHours: true,
      totalAccountedHours: true,
      variance: true,
      employee: {
        select: {
          id: true,
          employeeId: true,
          costCentre: true,
          department: { select: { id: true, name: true } },
          user: { select: { firstName: true, lastName: true, name: true, email: true } },
        },
      },
    },
    take: 2000,
  });

  const sheetIds = sheets.map((s) => s.id);
  const entries = sheetIds.length
    ? await db.timesheetEntry.findMany({
        where: { timesheetId: { in: sheetIds } },
        select: {
          hours: true,
          workCategory: true,
          date: true,
          timesheetId: true,
          institution: { select: { id: true, name: true } },
          department: { select: { id: true, name: true } },
        },
      })
    : [];

  /** Sums hours into a keyed bucket, carrying a display label. */
  function bucket<T>(
    rows: T[],
    keyOf: (r: T) => { key: string; label: string } | null,
    hoursOf: (r: T) => number
  ) {
    const m = new Map<string, { key: string; label: string; hours: number; count: number }>();
    for (const r of rows) {
      const k = keyOf(r);
      if (!k) continue;
      const cur = m.get(k.key) ?? { key: k.key, label: k.label, hours: 0, count: 0 };
      cur.hours = round2(cur.hours + hoursOf(r));
      cur.count += 1;
      m.set(k.key, cur);
    }
    return [...m.values()].sort((a, b) => b.hours - a.hours);
  }

  const byEmployee = bucket(
    sheets,
    (s) => ({
      key: s.employee.id,
      label: `${displayNameOr(s.employee.user, s.employee.user.email)} (${s.employee.employeeId})`,
    }),
    (s) => s.loggedHours
  );

  const byDepartment = bucket(
    sheets,
    (s) => (s.employee.department ? { key: s.employee.department.id, label: s.employee.department.name } : { key: "none", label: "No department" }),
    (s) => s.loggedHours
  );

  const byCostCentre = bucket(
    sheets,
    (s) => ({ key: s.employee.costCentre ?? "none", label: s.employee.costCentre ?? "No cost centre" }),
    (s) => s.loggedHours
  );

  const byPeriod = bucket(
    sheets,
    (s) => {
      const k = s.periodStart.toISOString().slice(0, 10);
      return { key: k, label: `${k} to ${s.periodEnd.toISOString().slice(0, 10)}` };
    },
    (s) => s.loggedHours
  ).sort((a, b) => a.key.localeCompare(b.key));

  const byStatus = bucket(
    sheets,
    (s) => ({ key: s.status, label: s.status }),
    (s) => s.loggedHours
  );

  const byCategory = bucket(
    entries,
    (e) => ({ key: e.workCategory, label: workCategoryLabel(e.workCategory) }),
    (e) => e.hours
  );

  const byClient = bucket(
    entries,
    (e) => (e.institution ? { key: e.institution.id, label: e.institution.name } : { key: "none", label: "Not client-attributed" }),
    (e) => e.hours
  );

  // Cost centre at ENTRY level too: a line can be booked to a different centre
  // from the employee's own, which is the point of having the field on both.
  const byEntryCostCentre = bucket(
    entries,
    (e) => (e.department ? { key: e.department.id, label: e.department.name } : { key: "none", label: "Not allocated" }),
    (e) => e.hours
  );

  const totals = sheets.reduce(
    (acc, s) => ({
      expectedHours: round2(acc.expectedHours + s.expectedHours),
      loggedHours: round2(acc.loggedHours + s.loggedHours),
      approvedLeaveHours: round2(acc.approvedLeaveHours + s.approvedLeaveHours),
      totalAccountedHours: round2(acc.totalAccountedHours + s.totalAccountedHours),
      variance: round2(acc.variance + s.variance),
    }),
    { expectedHours: 0, loggedHours: 0, approvedLeaveHours: 0, totalAccountedHours: 0, variance: 0 }
  );

  return NextResponse.json({
    scope: admin ? "all" : "own-and-approved",
    timesheetCount: sheets.length,
    entryCount: entries.length,
    totals,
    byEmployee,
    byDepartment,
    byCostCentre,
    byPeriod,
    byStatus,
    byCategory,
    byClient,
    byEntryCostCentre,
    // Named so a reader knows the truncation happened rather than assuming the
    // business only has this much time recorded.
    truncated: sheets.length >= 2000,
  });
}
