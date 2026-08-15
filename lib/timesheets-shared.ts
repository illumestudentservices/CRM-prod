/**
 * Timesheets — pure logic, safe to import from a client component.
 *
 * Split out of lib/timesheets.ts because that module imports the Prisma
 * client, and pulling it into a "use client" component drags `pg` into the
 * browser bundle. The whole app then fails to compile with
 * "Module not found: Can't resolve 'dns'" — the page sweep went from 38
 * routes to 0. Nothing in this file may import from @/lib/db.
 */

import type { TimesheetFrequency, TimesheetStatus } from "@prisma/client";

// ─── Vocabulary ──────────────────────────────────────────────────────────────

export const WORK_CATEGORIES = [
  "CLIENT_WORK",
  "INTERNAL_PROJECT",
  "ADMINISTRATION",
  "FINANCE_OPERATIONS",
  "MEETINGS",
  "TRAINING",
  "RECRUITMENT_SUPPORT",
  "OTHER",
] as const;

export const WORK_CATEGORY_LABELS: Record<string, string> = {
  CLIENT_WORK: "Client work",
  INTERNAL_PROJECT: "Internal project",
  ADMINISTRATION: "Administration",
  FINANCE_OPERATIONS: "Finance operations",
  MEETINGS: "Meetings",
  TRAINING: "Training",
  RECRUITMENT_SUPPORT: "Recruitment support",
  OTHER: "Other",
};

export const FREQUENCY_LABELS: Record<string, string> = {
  WEEKLY: "Weekly",
  BIWEEKLY: "Bi-weekly",
  MONTHLY: "Monthly",
};

export const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  MANAGER_REVIEW: "Manager review",
  AMENDMENTS_REQUIRED: "Amendments required",
  APPROVED: "Approved",
};

export function workCategoryLabel(c: string): string {
  return WORK_CATEGORY_LABELS[c] ?? c.replace(/_/g, " ").toLowerCase();
}

/** A default week, used only when an employee has no configured hours. */
export const DEFAULT_WEEKLY_HOURS = 40;

/** Working days per week, for turning a weekly contract into a daily rate. */
const WORKING_DAYS_PER_WEEK = 5;

// ─── Dates ───────────────────────────────────────────────────────────────────

/** Exported so the db-backed half can compare dates the same way. */
export function utcDate(d: Date | string): Date {
  const x = new Date(d);
  return new Date(Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate()));
}

function addDays(d: Date, n: number): Date {
  const x = utcDate(d);
  x.setUTCDate(x.getUTCDate() + n);
  return x;
}

/** Monday of the ISO week containing `d`. */
function startOfWeek(d: Date): Date {
  const x = utcDate(d);
  // getUTCDay: 0 = Sunday. Shift so Monday is the first day.
  const shift = (x.getUTCDay() + 6) % 7;
  return addDays(x, -shift);
}

/**
 * Anchor for bi-weekly blocks: Monday 5 January 1970.
 *
 * Fixed rather than derived from the employee's start date so that everyone on
 * a fortnightly cycle shares the same block boundaries. Deriving it per person
 * would make "the fortnight ending 12 September" mean different things for
 * different employees, and any change to a start date would silently re-cut
 * every period they had ever been issued.
 */
const BIWEEK_ANCHOR = Date.UTC(1970, 0, 5);

/**
 * The period containing `on`, for a given frequency.
 *
 * Both ends are inclusive dates, not timestamps: a period is a set of calendar
 * days, and storing an exclusive end would make the last day of a month behave
 * differently from the last day of a week.
 */
export function periodFor(
  frequency: TimesheetFrequency,
  on: Date | string = new Date()
): { periodStart: Date; periodEnd: Date } {
  const d = utcDate(on);

  if (frequency === "MONTHLY") {
    const periodStart = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
    const periodEnd = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    return { periodStart, periodEnd };
  }

  if (frequency === "BIWEEKLY") {
    const weekStart = startOfWeek(d);
    const blocks = Math.floor((weekStart.getTime() - BIWEEK_ANCHOR) / (14 * 86_400_000));
    const periodStart = new Date(BIWEEK_ANCHOR + blocks * 14 * 86_400_000);
    return { periodStart, periodEnd: addDays(periodStart, 13) };
  }

  const periodStart = startOfWeek(d);
  return { periodStart, periodEnd: addDays(periodStart, 6) };
}

/** The period immediately before the one containing `on`. */
export function previousPeriod(frequency: TimesheetFrequency, on: Date | string = new Date()) {
  const { periodStart } = periodFor(frequency, on);
  return periodFor(frequency, addDays(periodStart, -1));
}

/**
 * Working days (Mon–Fri) in an inclusive range.
 *
 * Public holidays are NOT deducted. The Holiday model exists but is not
 * region-scoped per employee, so subtracting it would understate expected hours
 * for staff in a region where that holiday does not apply. Better to overstate
 * expected hours and let the variance show it than to quietly bake in a wrong
 * calendar — the variance is the number a reviewer is meant to look at.
 */
export function workingDaysBetween(start: Date | string, end: Date | string): number {
  let d = utcDate(start);
  const last = utcDate(end);
  let n = 0;
  while (d.getTime() <= last.getTime()) {
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6) n++;
    d = addDays(d, 1);
  }
  return n;
}

// ─── Hour calculations ───────────────────────────────────────────────────────

/** Contracted hours for one working day. */
export function dailyHours(standardWeeklyHours: number | null | undefined): number {
  const weekly = standardWeeklyHours ?? DEFAULT_WEEKLY_HOURS;
  return weekly / WORKING_DAYS_PER_WEEK;
}

/** Contracted hours across a period, from the employee's standard week. */
export function expectedHoursFor(
  standardWeeklyHours: number | null | undefined,
  periodStart: Date,
  periodEnd: Date
): number {
  return round2(dailyHours(standardWeeklyHours) * workingDaysBetween(periodStart, periodEnd));
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}


// ─── Workflow ────────────────────────────────────────────────────────────────

export type TimesheetActor = "OWNER" | "APPROVER" | "HR";

/**
 * Spec §Workflow:
 *   Draft → Submitted → Manager Review → Approved
 *   Manager Review → Amendments Required → resubmission → Approved
 *
 * Expressed as data rather than nested ifs so the rules can be tested without a
 * server, and so "who may do what" is answerable by reading one table. APPROVED
 * appears as a source in no entry: it is terminal, which is what makes an
 * approved timesheet read-only.
 */
export const TRANSITIONS: {
  from: TimesheetStatus;
  to: TimesheetStatus;
  actors: TimesheetActor[];
  requiresNotes?: boolean;
  label: string;
}[] = [
  { from: "DRAFT", to: "SUBMITTED", actors: ["OWNER", "HR"], label: "Submit" },
  { from: "SUBMITTED", to: "MANAGER_REVIEW", actors: ["APPROVER", "HR"], label: "Start review" },
  // Straight through, for an approver who reviews and signs off in one sitting.
  { from: "SUBMITTED", to: "APPROVED", actors: ["APPROVER", "HR"], label: "Approve" },
  { from: "MANAGER_REVIEW", to: "APPROVED", actors: ["APPROVER", "HR"], label: "Approve" },
  {
    from: "MANAGER_REVIEW",
    to: "AMENDMENTS_REQUIRED",
    actors: ["APPROVER", "HR"],
    requiresNotes: true,
    label: "Request amendments",
  },
  {
    from: "SUBMITTED",
    to: "AMENDMENTS_REQUIRED",
    actors: ["APPROVER", "HR"],
    requiresNotes: true,
    label: "Request amendments",
  },
  { from: "AMENDMENTS_REQUIRED", to: "SUBMITTED", actors: ["OWNER", "HR"], label: "Resubmit" },
  // Pulling a submission back before anyone has looked at it.
  { from: "SUBMITTED", to: "DRAFT", actors: ["OWNER"], label: "Withdraw" },
];

export function canTransition(
  from: TimesheetStatus,
  to: TimesheetStatus,
  actor: TimesheetActor
): { ok: boolean; requiresNotes: boolean; reason?: string } {
  if (from === "APPROVED") {
    return { ok: false, requiresNotes: false, reason: "An approved timesheet is read-only." };
  }
  const t = TRANSITIONS.find((x) => x.from === from && x.to === to);
  if (!t) {
    return {
      ok: false,
      requiresNotes: false,
      reason: `Cannot move a timesheet from ${STATUS_LABELS[from]} to ${STATUS_LABELS[to]}.`,
    };
  }
  if (!t.actors.includes(actor)) {
    return { ok: false, requiresNotes: !!t.requiresNotes, reason: "Your role cannot make that change." };
  }
  return { ok: true, requiresNotes: !!t.requiresNotes };
}

/** Transitions this actor may perform from here — drives the UI's buttons. */
export function availableTransitions(from: TimesheetStatus, actor: TimesheetActor) {
  if (from === "APPROVED") return [];
  return TRANSITIONS.filter((t) => t.from === from && t.actors.includes(actor));
}

/** Entries may only be edited while the sheet is still the employee's to change. */
export function entriesEditable(status: TimesheetStatus): boolean {
  return status === "DRAFT" || status === "AMENDMENTS_REQUIRED";
}

// ─── Access ──────────────────────────────────────────────────────────────────

/**
 * Roles that may see everyone's timesheets and act on any of them.
 *
 * Hardcoded rather than read through effectiveHasPermission for the same reason
 * as the offboarding queue: who can approve payroll-adjacent time records is a
 * control question, and a permissions tweak in Settings should not silently
 * widen it.
 */
export const TIMESHEET_ADMIN_ROLES = ["HR_MANAGER", "SUPER_ADMIN"] as const;

export function isTimesheetAdmin(role: string): boolean {
  return (TIMESHEET_ADMIN_ROLES as readonly string[]).includes(role);
}

/**
 * How this user relates to a given timesheet.
 *
 * Returns null when they have no business seeing it at all, so callers can 404
 * rather than 403 and avoid confirming that another employee's sheet exists.
 */
export function actorFor(
  role: string,
  viewerEmployeeId: string | null,
  sheet: { employeeId: string; approverId: string | null; employee?: { timesheetApproverId: string | null; managerId: string | null } }
): TimesheetActor | null {
  if (isTimesheetAdmin(role)) return "HR";
  if (!viewerEmployeeId) return null;
  if (sheet.employeeId === viewerEmployeeId) return "OWNER";
  // The approver recorded on the sheet, or — where none has been stamped yet —
  // whoever is configured to approve for that employee.
  if (sheet.approverId && sheet.approverId === viewerEmployeeId) return "APPROVER";
  const configured = sheet.employee?.timesheetApproverId ?? sheet.employee?.managerId ?? null;
  if (configured && configured === viewerEmployeeId) return "APPROVER";
  return null;
}
