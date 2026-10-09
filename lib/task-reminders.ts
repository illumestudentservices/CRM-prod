import { db } from "@/lib/db";
import { ReminderDigest } from "@/lib/reminder-digest";
import type { TaskReminderStage } from "@prisma/client";

/**
 * Spec Tasks §8 — task reminders + escalation.
 *
 * Runs daily from the VPS crontab. Every task with a deadline produces four
 * notices and no more:
 *
 *   on creation      — sent immediately by lib/task-notify.ts, not here
 *   7 days before    — "this is coming"
 *   3 days before    — "this is close"
 *   on the due day   — "this is today"
 *
 * plus two things that are not part of that ladder: a CUSTOM notice for a task
 * carrying its own `reminderDate`, and escalation to a manager once a task is
 * overdue past its `escalationDate`.
 *
 * ★ THREE REASONS THE OLD VERSION OF THIS FILE SENT ALMOST NOTHING.
 *
 * 1. IT IGNORED EVERY TASK THE UI CREATES. The status filter listed
 *    NOT_STARTED, IN_PROGRESS and WAITING_ON_EXTERNAL_PARTY. The Tasks screen
 *    posts to /api/hr/tasks, which creates tasks as TODO — a status that was
 *    in the enum and in nobody's filter. Those tasks were never once examined
 *    by this job.
 *
 * 2. ONE FLAG CANNOT HOLD FOUR NOTICES. `reminderSentAt` was set by the
 *    explicit-reminder pass AND by the due-soon pass, and both skipped rows
 *    where it was already set. So each task produced at most one notification
 *    in its entire life, and whichever pass ran first silently cancelled the
 *    other. The ledger table `task_reminders` replaces it: one row per notice,
 *    unique on (taskId, stage).
 *
 * 3. THE DUE-DAY NOTICE COULD NOT FIRE. The window was `dueDate >= now`, and a
 *    due date is stored at midnight while the cron runs at 08:00. A task due
 *    today was always already in the past by the time the job looked, so the
 *    most important reminder of the four was the one that never arrived.
 *
 * Best-effort throughout: a failure inside one task does not stop the loop, so
 * one bad row cannot block the reminders for everyone else.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Every status that still represents work to do.
 *
 * TODO and NOT_STARTED both mean "not begun" — the two task endpoints each
 * picked one, years apart. Both belong here; see failure 1 above.
 */
export const OPEN_TASK_STATUSES = [
  "TODO",
  "NOT_STARTED",
  "IN_PROGRESS",
  "WAITING_ON_EXTERNAL_PARTY",
] as const;

/**
 * The ladder, widest rung first.
 *
 * Each rung is a RANGE, not an exact day. Exact-day matching looks tidier and
 * loses a notice permanently every time the cron misses a run — a reboot, a
 * failed deploy, an hour of downtime — because the day it was waiting for has
 * passed by the next run. The ranges are disjoint and contiguous, so a task is
 * always on exactly one rung and a late run still delivers the right one.
 *
 * They also decide what a task created close to its deadline receives: raise
 * something due in five days and it starts on the 7-day rung, which is correct.
 * It will not also get a backdated "7 days to go" for a day already gone.
 */
export const REMINDER_LADDER: Array<{
  stage: TaskReminderStage;
  /// Fires when daysOut is in (minExclusive, maxInclusive].
  minExclusive: number;
  maxInclusive: number;
  label: string;
  urgent: boolean;
}> = [
  { stage: "DUE_IN_7_DAYS", minExclusive: 3, maxInclusive: 7, label: "Task due next week", urgent: false },
  { stage: "DUE_IN_3_DAYS", minExclusive: 0, maxInclusive: 3, label: "Task due in a few days", urgent: true },
  { stage: "DUE_TODAY", minExclusive: -1, maxInclusive: 0, label: "Task due today", urgent: true },
];

/** The furthest rung, used to bound the query. */
const LADDER_HORIZON_DAYS = 7;

/**
 * Midnight UTC for a date.
 *
 * Day arithmetic is done in UTC on purpose, and it is correct rather than
 * merely convenient: a due date entered as a plain `<input type="date">` is
 * stored at UTC midnight, the server runs on UTC, and the job runs at 08:00
 * UTC — which is still the same calendar day everywhere Illume operates. A
 * local-time comparison here would drift with the server's zone, which is the
 * exact bug that made the due-day notice unreachable.
 */
export function utcDay(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Whole days from today to the due date. 0 is today, negative is overdue. */
export function daysUntil(due: Date, now: Date): number {
  return Math.round((utcDay(due).getTime() - utcDay(now).getTime()) / DAY_MS);
}

/** Which rung a task sits on today, or null if it sits on none. */
export function stageForDaysOut(daysOut: number) {
  return (
    REMINDER_LADDER.find(
      (r) => daysOut > r.minExclusive && daysOut <= r.maxInclusive
    ) ?? null
  );
}

/** "Monday, 19 October 2026" — written out, because 10/09 is two dates. */
export function formatTaskDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

/** "due in 3 days" / "due today" / "4 days overdue" — for a one-line detail. */
export function describeDueDistance(daysOut: number): string {
  if (daysOut === 0) return "due today";
  if (daysOut === 1) return "due tomorrow";
  if (daysOut > 1) return `due in ${daysOut} days`;
  if (daysOut === -1) return "1 day overdue";
  return `${Math.abs(daysOut)} days overdue`;
}

/**
 * The sentence the creation email ends with, so the recipient knows what else
 * is coming and does not treat the first email as the only warning.
 */
export function describeReminderSchedule(dueDate: Date | null, now = new Date()): string | undefined {
  if (!dueDate) return undefined;
  const daysOut = daysUntil(dueDate, now);
  if (daysOut < 0) return "This task is already past its due date, so no further reminders will be sent.";
  const upcoming = REMINDER_LADDER.filter((r) => daysOut > r.minExclusive).map((r) =>
    r.stage === "DUE_TODAY" ? "on the day itself" : r.stage === "DUE_IN_3_DAYS" ? "3 days before" : "a week before"
  );
  if (upcoming.length === 0) return "No further reminders will be sent about this task.";
  return `You will be reminded again ${upcoming.join(", ")}.`;
}

export interface TaskRemindersSummary {
  ranAt: string;
  dryRun: boolean;
  /// One count per rung, so a silent ladder is visible on the log.
  sentByStage: Record<string, number>;
  customNotified: number;
  escalated: number;
  /// Due, on a rung, and reaching nobody — no assignee and no contactable
  /// creator. Recorded rather than skipped silently, because "I set a due date
  /// and nothing happened" has to have an answer here.
  reachedNobody: Array<{ taskId: string; title: string; dueDate: string; stage: string }>;
  errors: number;
}

/**
 * Has this notice already gone out for THIS due date?
 *
 * The due date is half of the question. A task reminded at "3 days to go" and
 * then pushed back a month must get its ladder again — otherwise moving a
 * deadline silences it forever, which is the opposite of what moving a deadline
 * should do.
 */
function alreadySent(
  rows: Array<{ stage: TaskReminderStage; forDueDate: Date | null }>,
  stage: TaskReminderStage,
  forDueDate: Date | null
): boolean {
  const row = rows.find((r) => r.stage === stage);
  if (!row) return false;
  if (!forDueDate || !row.forDueDate) return !forDueDate && !row.forDueDate;
  return row.forDueDate.getTime() === forDueDate.getTime();
}

export async function runTaskReminders(
  opts: { dryRun?: boolean; now?: Date } = {}
): Promise<TaskRemindersSummary> {
  // One list per person. Someone holding eight due tasks needs one email about
  // eight tasks, not eight emails — see lib/reminder-digest.ts.
  const dryRun = !!opts.dryRun;
  const now = opts.now ?? new Date();
  const digest = new ReminderDigest({ dryRun });

  const summary: TaskRemindersSummary = {
    ranAt: now.toISOString(),
    dryRun,
    sentByStage: { DUE_IN_7_DAYS: 0, DUE_IN_3_DAYS: 0, DUE_TODAY: 0 },
    customNotified: 0,
    escalated: 0,
    reachedNobody: [],
    errors: 0,
  };

  const today = utcDay(now);
  const horizon = new Date(today.getTime() + (LADDER_HORIZON_DAYS + 1) * DAY_MS);

  /** Assignee if there is one, else whoever raised it. An unassigned task with
   *  a deadline is still somebody's problem, and that somebody is the person
   *  who wrote it down. */
  const recipientOf = (t: {
    assignee: { userId: string | null } | null;
    createdBy: { userId: string | null } | null;
  }) => t.assignee?.userId ?? t.createdBy?.userId ?? null;

  // ── 1. The ladder ───────────────────────────────────────────────────────────
  const due = await db.task.findMany({
    where: {
      deletedAt: null,
      status: { in: [...OPEN_TASK_STATUSES] },
      dueDate: { gte: today, lt: horizon },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      priority: true,
      assignee: { select: { userId: true } },
      createdBy: { select: { userId: true } },
      reminders: { select: { stage: true, forDueDate: true } },
    },
    take: 1000,
  });

  for (const t of due) {
    try {
      if (!t.dueDate) continue;
      const daysOut = daysUntil(t.dueDate, now);
      const rung = stageForDaysOut(daysOut);
      if (!rung) continue;

      const forDueDate = utcDay(t.dueDate);
      if (alreadySent(t.reminders, rung.stage, forDueDate)) continue;

      const userId = recipientOf(t);
      if (!userId) {
        // Deliberately NOT recorded in the ledger. Assign the task tomorrow and
        // the notice should still go out while the rung is open; a row written
        // here would suppress it.
        summary.reachedNobody.push({
          taskId: t.id,
          title: t.title,
          dueDate: t.dueDate.toISOString().slice(0, 10),
          stage: rung.stage,
        });
        continue;
      }

      if (!dryRun) {
        // Reserve before sending, as the holiday job does: if the process dies
        // mid-run, the next run must not start the same batch again from the
        // top. An upsert rather than a create so a moved due date overwrites
        // the stale row instead of colliding with it.
        await db.taskReminder.upsert({
          where: { taskId_stage: { taskId: t.id, stage: rung.stage } },
          create: { taskId: t.id, stage: rung.stage, forDueDate, sentCount: 1 },
          update: { forDueDate, sentCount: 1, sentAt: now },
        });
        await digest.add({
          userId,
          title: rung.label,
          message: `${t.title} — ${describeDueDistance(daysOut)} (${formatTaskDate(t.dueDate)})`,
          type: `TASK_${rung.stage}`,
          link: `/tasks?taskId=${t.id}`,
          urgent: rung.urgent || t.priority === "URGENT",
        });
      }
      summary.sentByStage[rung.stage] = (summary.sentByStage[rung.stage] ?? 0) + 1;
    } catch (err) {
      console.error(`[task-reminders] task ${t.id}:`, err);
      summary.errors++;
    }
  }

  // ── 2. Custom reminders, for a task carrying its own reminderDate ───────────
  // Separate from the ladder and tracked under its own stage, so the two can no
  // longer cancel each other out.
  const custom = await db.task.findMany({
    where: {
      deletedAt: null,
      status: { in: [...OPEN_TASK_STATUSES] },
      reminderDate: { lte: new Date(now.getTime() + DAY_MS) },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      reminderDate: true,
      priority: true,
      assignee: { select: { userId: true } },
      createdBy: { select: { userId: true } },
      reminders: { select: { stage: true, forDueDate: true } },
    },
    take: 500,
  });

  for (const t of custom) {
    try {
      if (!t.reminderDate) continue;
      // Keyed on the reminder date, not the due date, so moving the reminder
      // re-arms it the same way moving a deadline re-arms the ladder.
      const forDueDate = utcDay(t.reminderDate);
      if (alreadySent(t.reminders, "CUSTOM", forDueDate)) continue;

      const userId = recipientOf(t);
      if (!userId) continue;

      if (!dryRun) {
        await db.taskReminder.upsert({
          where: { taskId_stage: { taskId: t.id, stage: "CUSTOM" } },
          create: { taskId: t.id, stage: "CUSTOM", forDueDate, sentCount: 1 },
          update: { forDueDate, sentCount: 1, sentAt: now },
        });
        await digest.add({
          userId,
          title: "Task reminder",
          message: t.dueDate
            ? `${t.title} — ${describeDueDistance(daysUntil(t.dueDate, now))} (${formatTaskDate(t.dueDate)})`
            : t.title,
          type: "TASK_REMINDER",
          link: `/tasks?taskId=${t.id}`,
          urgent: t.priority === "URGENT",
        });
        // Kept current for anything still reading the old column, though
        // nothing in this file does any more.
        await db.task.update({ where: { id: t.id }, data: { reminderSentAt: now } });
      }
      summary.customNotified++;
    } catch (err) {
      console.error(`[task-reminders] custom ${t.id}:`, err);
      summary.errors++;
    }
  }

  // ── 3. Escalation: overdue past escalationDate, tell a manager ──────────────
  const overdue = await db.task.findMany({
    where: {
      deletedAt: null,
      status: { in: [...OPEN_TASK_STATUSES] },
      escalationDate: { lte: now },
      escalatedAt: null,
      assigneeId: { not: null },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      assignee: { select: { user: { select: { id: true, name: true, regionId: true } } } },
    },
    take: 500,
  });

  for (const t of overdue) {
    try {
      const assignee = t.assignee?.user;
      if (!assignee) continue;
      // A Regional Manager in the same region, else a super admin. The assignee
      // is deliberately not notified here — they have had the whole ladder.
      let escalateTo = await db.user.findFirst({
        where: {
          role: "REGIONAL_MANAGER",
          isActive: true,
          deletedAt: null,
          ...(assignee.regionId ? { regionId: assignee.regionId } : {}),
        },
        select: { id: true },
      });
      if (!escalateTo) {
        escalateTo = await db.user.findFirst({
          where: { role: "SUPER_ADMIN", isActive: true, deletedAt: null },
          select: { id: true },
        });
      }
      if (!escalateTo) continue;
      if (!dryRun) {
        await digest.add({
          userId: escalateTo.id,
          title: "Overdue task escalated",
          message: `${assignee.name ?? "A team member"} has an overdue task: ${t.title}`,
          type: "TASK_ESCALATED",
          link: `/tasks?taskId=${t.id}`,
          urgent: true,
        });
        await db.task.update({ where: { id: t.id }, data: { escalatedAt: now } });
      }
      summary.escalated++;
    } catch (err) {
      console.error(`[task-reminders] escalation ${t.id}:`, err);
      summary.errors++;
    }
  }

  await digest.flush({
    heading: "Tasks",
    intro: "these tasks need you today.",
  });

  if (summary.reachedNobody.length > 0) {
    console.warn(
      `[task-reminders] ${summary.reachedNobody.length} due task(s) reached nobody — ` +
        `no assignee and no contactable creator: ` +
        summary.reachedNobody.map((r) => `${r.title} (${r.dueDate})`).join("; ")
    );
  }

  return summary;
}
