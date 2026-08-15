import { db } from "@/lib/db";
import {
  generateTimesheetPeriods,
  periodFor,
  previousPeriod,
  recalculateTimesheet,
  type GenerationSummary,
} from "@/lib/timesheets";

/**
 * Scheduled timesheet housekeeping.
 *
 * Mirrors lib/interest-automation.ts: a plain library function driven by a
 * local script from crontab, deliberately NOT an HTTP endpoint. The business
 * chose that design for the lead automation specifically to avoid exposing a
 * trigger to the internet, and there is no reason to weaken it here.
 *
 * Spec §Automation asks the system to:
 *   - create timesheet periods automatically           → generateTimesheetPeriods
 *   - populate employee information automatically      → done at creation
 *   - retrieve approved leave from Leave Management    → refreshOpenTimesheets
 *   - calculate expected/logged/leave hours + variance → refreshOpenTimesheets
 *   - send configurable submission reminders           → sendSubmissionReminders
 *   - notify managers of overdue submissions           → notifyOverdue
 *   - notify employees when amendments are requested   → done inline on the
 *     PATCH route, because it must be immediate rather than wait for a cron
 */

/** How many days before a period ends to nudge the employee. Configurable. */
export const REMINDER_DAYS_BEFORE_END = Number(process.env.TIMESHEET_REMINDER_DAYS ?? 2);

/** How many days after a period ends before an unsubmitted sheet is overdue. */
export const OVERDUE_GRACE_DAYS = Number(process.env.TIMESHEET_OVERDUE_DAYS ?? 3);

export interface TimesheetAutomationSummary {
  ranAt: string;
  dryRun: boolean;
  generation: GenerationSummary;
  refreshed: number;
  remindersSent: number;
  overdueNotified: number;
  overdueWithNoApprover: string[];
}

function daysBetween(a: Date, b: Date): number {
  const d1 = Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate());
  const d2 = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  return Math.round((d1 - d2) / 86_400_000);
}

export async function runTimesheetAutomation(
  opts: { dryRun?: boolean; on?: Date } = {}
): Promise<TimesheetAutomationSummary> {
  const dryRun = !!opts.dryRun;
  const now = opts.on ?? new Date();

  const summary: TimesheetAutomationSummary = {
    ranAt: now.toISOString(),
    dryRun,
    generation: await generateTimesheetPeriods({ dryRun, on: now }),
    refreshed: 0,
    remindersSent: 0,
    overdueNotified: 0,
    overdueWithNoApprover: [],
  };

  // ── Keep open sheets' figures current ───────────────────────────────────
  // Leave approved after a period opened would otherwise never reach the sheet,
  // and the employee would be chased for hours they were on holiday for.
  const open = await db.timesheet.findMany({
    where: { status: { in: ["DRAFT", "AMENDMENTS_REQUIRED", "SUBMITTED"] } },
    select: { id: true },
    take: 2000,
  });
  for (const s of open) {
    if (!dryRun) await recalculateTimesheet(s.id);
    summary.refreshed++;
  }

  // ── Submission reminders ────────────────────────────────────────────────
  const dueSoon = await db.timesheet.findMany({
    where: { status: { in: ["DRAFT", "AMENDMENTS_REQUIRED"] } },
    select: {
      id: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      employee: { select: { id: true, employeeId: true, userId: true } },
    },
    take: 2000,
  });

  for (const s of dueSoon) {
    const daysLeft = daysBetween(s.periodEnd, now);
    if (daysLeft < 0 || daysLeft > REMINDER_DAYS_BEFORE_END) continue;

    // One reminder per sheet per day. The event log is the dedupe key, so a
    // cron that runs hourly cannot nag the same person twelve times.
    const already = await db.timesheetEvent.findFirst({
      where: {
        timesheetId: s.id,
        action: "REMINDER_SENT",
        createdAt: { gte: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())) },
      },
      select: { id: true },
    });
    if (already) continue;

    if (!dryRun) {
      await db.notification.create({
        data: {
          userId: s.employee.userId,
          title: "Timesheet due",
          message:
            daysLeft === 0
              ? `Your timesheet for the period ending today is still a draft.`
              : `Your timesheet for the period ending ${s.periodEnd.toISOString().slice(0, 10)} is due in ${daysLeft} day${daysLeft === 1 ? "" : "s"}.`,
          type: "TIMESHEET",
          link: "/hr?tab=timesheets",
        },
      });
      await db.timesheetEvent.create({
        data: { timesheetId: s.id, action: "REMINDER_SENT", notes: `${daysLeft} day(s) before period end` },
      });
    }
    summary.remindersSent++;
  }

  // ── Overdue: tell the approver, not just the employee ───────────────────
  const overdue = await db.timesheet.findMany({
    where: { status: { in: ["DRAFT", "AMENDMENTS_REQUIRED"] } },
    select: {
      id: true,
      periodEnd: true,
      approverId: true,
      employee: {
        select: {
          id: true, employeeId: true, userId: true,
          timesheetApproverId: true, managerId: true,
          user: { select: { firstName: true, lastName: true, name: true, email: true } },
        },
      },
    },
    take: 2000,
  });

  for (const s of overdue) {
    const daysPast = daysBetween(now, s.periodEnd);
    if (daysPast < OVERDUE_GRACE_DAYS) continue;

    const already = await db.timesheetEvent.findFirst({
      where: { timesheetId: s.id, action: "OVERDUE_ESCALATED" },
      select: { id: true },
    });
    if (already) continue;

    const approverEmployeeId = s.approverId ?? s.employee.timesheetApproverId ?? s.employee.managerId;
    if (!approverEmployeeId) {
      // Named rather than silently skipped: a sheet with nobody to chase it is
      // a configuration gap that will otherwise never surface.
      summary.overdueWithNoApprover.push(s.employee.employeeId);
      continue;
    }

    const approver = await db.employee.findUnique({
      where: { id: approverEmployeeId },
      select: { userId: true },
    });
    if (!approver?.userId) {
      summary.overdueWithNoApprover.push(s.employee.employeeId);
      continue;
    }

    const who = s.employee.user.name?.trim() || s.employee.user.email;
    if (!dryRun) {
      await db.notification.create({
        data: {
          userId: approver.userId,
          title: "Timesheet overdue",
          message: `${who} has not submitted their timesheet for the period ending ${s.periodEnd.toISOString().slice(0, 10)} (${daysPast} days ago).`,
          type: "TIMESHEET",
          link: "/hr?tab=timesheets",
        },
      });
      await db.timesheetEvent.create({
        data: { timesheetId: s.id, action: "OVERDUE_ESCALATED", notes: `${daysPast} days past period end` },
      });
    }
    summary.overdueNotified++;
  }

  return summary;
}

/** Exposed for the QA harness and for an operator checking last period's state. */
export function periodWindows(frequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY", on: Date = new Date()) {
  return { current: periodFor(frequency, on), previous: previousPeriod(frequency, on) };
}
