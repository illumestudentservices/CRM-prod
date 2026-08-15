import { db } from "@/lib/db";
import type { TimesheetStatus } from "@prisma/client";
import {
  dailyHours,
  expectedHoursFor,
  periodFor,
  round2,
  utcDate,
  workingDaysBetween,
} from "@/lib/timesheets-shared";

/**
 * Timesheets — the parts that touch the database.
 *
 * Pure vocabulary, date maths, the workflow state machine and the access rules
 * live in lib/timesheets-shared.ts so a client component can import them without
 * dragging Prisma into the browser bundle. Everything there is re-exported here,
 * so server code can keep importing from this one module.
 */

export * from "@/lib/timesheets-shared";

/**
 * Approved leave hours falling inside a period.
 *
 * Pro-rated by working days, because a leave request routinely straddles a
 * period boundary and `LeaveRequest.days` covers the whole request. Taking the
 * full `days` for any overlapping request would double-count a fortnight of
 * leave across two periods and push both variances wildly positive.
 *
 * Only APPROVED leave counts — pending leave is not yet time off, and counting
 * it would let an employee close their variance by requesting leave they never
 * get. Spec: "Retrieve approved leave from Leave Management."
 */
export async function approvedLeaveHoursFor(
  employeeId: string,
  periodStart: Date,
  periodEnd: Date,
  standardWeeklyHours: number | null | undefined
): Promise<number> {
  const requests = await db.leaveRequest.findMany({
    where: {
      employeeId,
      status: "APPROVED",
      startDate: { lte: periodEnd },
      endDate: { gte: periodStart },
    },
    select: { startDate: true, endDate: true, days: true },
  });

  const perDay = dailyHours(standardWeeklyHours);
  let hours = 0;

  for (const r of requests) {
    const totalWorking = workingDaysBetween(r.startDate, r.endDate);
    if (totalWorking === 0) continue;

    const overlapStart = utcDate(r.startDate) > utcDate(periodStart) ? r.startDate : periodStart;
    const overlapEnd = utcDate(r.endDate) < utcDate(periodEnd) ? r.endDate : periodEnd;
    const overlapWorking = workingDaysBetween(overlapStart, overlapEnd);
    if (overlapWorking === 0) continue;

    // Scale the request's own recorded days by the share of it inside this
    // period. This preserves half-days, which a raw day count would round away.
    const daysInPeriod = (r.days / totalWorking) * overlapWorking;
    hours += daysInPeriod * perDay;
  }

  return round2(hours);
}

/**
 * Recompute every derived figure on a timesheet and persist them.
 *
 * These four numbers are system-calculated and must never be accepted from a
 * request body — the CRM-wide rule against manually keyed totals. Call this
 * after any change to entries, and after leave is approved.
 */
export async function recalculateTimesheet(timesheetId: string): Promise<{
  expectedHours: number;
  loggedHours: number;
  approvedLeaveHours: number;
  totalAccountedHours: number;
  variance: number;
} | null> {
  const sheet = await db.timesheet.findUnique({
    where: { id: timesheetId },
    select: {
      id: true,
      employeeId: true,
      periodStart: true,
      periodEnd: true,
      employee: { select: { standardWorkingHours: true } },
    },
  });
  if (!sheet) return null;

  const weekly = sheet.employee.standardWorkingHours;

  const agg = await db.timesheetEntry.aggregate({
    where: { timesheetId },
    _sum: { hours: true },
  });
  const loggedHours = round2(agg._sum.hours ?? 0);

  const expectedHours = expectedHoursFor(weekly, sheet.periodStart, sheet.periodEnd);
  const approvedLeaveHours = await approvedLeaveHoursFor(
    sheet.employeeId,
    sheet.periodStart,
    sheet.periodEnd,
    weekly
  );

  const totalAccountedHours = round2(loggedHours + approvedLeaveHours);
  const variance = round2(totalAccountedHours - expectedHours);

  await db.timesheet.update({
    where: { id: timesheetId },
    data: { expectedHours, loggedHours, approvedLeaveHours, totalAccountedHours, variance },
  });

  return { expectedHours, loggedHours, approvedLeaveHours, totalAccountedHours, variance };
}

// ─── History ─────────────────────────────────────────────────────────────────

/** Append a row to the timesheet's own visible history. Never updates. */
export async function recordEvent(opts: {
  timesheetId: string;
  action: string;
  fromStatus?: TimesheetStatus | null;
  toStatus?: TimesheetStatus | null;
  actorId?: string | null;
  notes?: string | null;
  snapshot?: Record<string, unknown> | null;
}): Promise<void> {
  await db.timesheetEvent.create({
    data: {
      timesheetId: opts.timesheetId,
      action: opts.action,
      fromStatus: opts.fromStatus ?? null,
      toStatus: opts.toStatus ?? null,
      actorId: opts.actorId ?? null,
      notes: opts.notes ?? null,
      snapshot: (opts.snapshot ?? undefined) as never,
    },
  });
}

// ─── Period generation ───────────────────────────────────────────────────────

export interface GenerationSummary {
  ranAt: string;
  dryRun: boolean;
  eligibleEmployees: number;
  created: number;
  alreadyExisted: number;
  skippedNoFrequency: string[];
  skippedNoApprover: string[];
}

/**
 * Issue the current period's timesheet to everyone who needs one.
 *
 * Idempotent: the unique index on (employeeId, periodStart) means a second run
 * finds the row already there rather than duplicating it, so this is safe to
 * schedule daily and safe to re-run by hand after a failure.
 *
 * Only employees with `timesheetRequired` are considered — the spec is explicit
 * that everyone else, ICRs in particular, must not be issued timesheets.
 */
export async function generateTimesheetPeriods(
  opts: { dryRun?: boolean; on?: Date } = {}
): Promise<GenerationSummary> {
  const dryRun = !!opts.dryRun;
  const on = opts.on ?? new Date();

  const employees = await db.employee.findMany({
    where: { timesheetRequired: true, isActive: true, user: { deletedAt: null } },
    select: {
      id: true,
      employeeId: true,
      timesheetFrequency: true,
      standardWorkingHours: true,
      timesheetApproverId: true,
      managerId: true,
    },
  });

  const summary: GenerationSummary = {
    ranAt: new Date().toISOString(),
    dryRun,
    eligibleEmployees: employees.length,
    created: 0,
    alreadyExisted: 0,
    skippedNoFrequency: [],
    skippedNoApprover: [],
  };

  for (const e of employees) {
    if (!e.timesheetFrequency) {
      // Required but no cadence set — a configuration gap. Named rather than
      // silently defaulted to weekly, which would issue sheets nobody expects.
      summary.skippedNoFrequency.push(e.employeeId);
      continue;
    }
    if (!e.timesheetApproverId && !e.managerId) {
      summary.skippedNoApprover.push(e.employeeId);
    }

    const { periodStart, periodEnd } = periodFor(e.timesheetFrequency, on);

    const existing = await db.timesheet.findUnique({
      where: { employeeId_periodStart: { employeeId: e.id, periodStart } },
      select: { id: true },
    });
    if (existing) {
      summary.alreadyExisted++;
      continue;
    }
    if (dryRun) {
      summary.created++;
      continue;
    }

    const expectedHours = expectedHoursFor(e.standardWorkingHours, periodStart, periodEnd);
    const approvedLeaveHours = await approvedLeaveHoursFor(
      e.id,
      periodStart,
      periodEnd,
      e.standardWorkingHours
    );

    const sheet = await db.timesheet.create({
      data: {
        employeeId: e.id,
        frequency: e.timesheetFrequency,
        periodStart,
        periodEnd,
        expectedHours,
        approvedLeaveHours,
        totalAccountedHours: approvedLeaveHours,
        variance: round2(approvedLeaveHours - expectedHours),
        approverId: e.timesheetApproverId ?? e.managerId ?? null,
      },
    });
    await recordEvent({
      timesheetId: sheet.id,
      action: "PERIOD_OPENED",
      toStatus: "DRAFT",
      snapshot: { expectedHours, approvedLeaveHours },
    });
    summary.created++;
  }

  return summary;
}

/**
 * Who reviews this employee's timesheets.
 *
 * The explicitly configured approver wins; otherwise the line manager. Returns
 * null when neither is set, which is a configuration gap worth surfacing rather
 * than silently routing to HR — a timesheet nobody is named to approve will sit
 * in the queue forever.
 */
export async function resolveApprover(employeeId: string): Promise<string | null> {
  const e = await db.employee.findUnique({
    where: { id: employeeId },
    select: { timesheetApproverId: true, managerId: true },
  });
  return e?.timesheetApproverId ?? e?.managerId ?? null;
}
