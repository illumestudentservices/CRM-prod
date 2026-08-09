import { db } from "@/lib/db";

/**
 * Spec Tasks §8 — task reminders + escalation.
 *
 * This job runs daily and produces three side effects:
 *   1. Reminders for tasks whose reminderDate is within the next 24h and
 *      have never been reminded (`reminderSentAt IS NULL`).
 *   2. Due-soon reminders 3 days out and 1 day out for tasks with dueDate
 *      but no explicit reminderDate — a simpler default cadence.
 *   3. Escalations for overdue tasks past their escalationDate: notify the
 *      assignee's Regional Manager (or SUPER_ADMIN if the assignee has none).
 *
 * Best-effort throughout: a failure inside one task doesn't stop the loop,
 * so a bad row can't block reminders for the rest of the fleet.
 */

export interface TaskRemindersSummary {
  ranAt: string;
  dryRun: boolean;
  reminderNotified: number;
  dueSoonNotified: number;
  escalated: number;
  errors: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function runTaskReminders(opts: { dryRun?: boolean } = {}): Promise<TaskRemindersSummary> {
  const dryRun = !!opts.dryRun;
  const summary: TaskRemindersSummary = {
    ranAt: new Date().toISOString(),
    dryRun,
    reminderNotified: 0,
    dueSoonNotified: 0,
    escalated: 0,
    errors: 0,
  };

  const now = new Date();

  // 1. Explicit reminders: reminderDate ≤ now + 24h and not yet sent.
  const withReminders = await db.task.findMany({
    where: {
      deletedAt: null,
      status: { in: ["NOT_STARTED", "IN_PROGRESS", "WAITING_ON_EXTERNAL_PARTY"] },
      reminderDate: { lte: new Date(now.getTime() + DAY_MS) },
      // reminderSentAt is nullable and set by this same job. Skip already-notified rows.
      reminderSentAt: null,
      assigneeId: { not: null },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      assignee: { select: { userId: true, id: true } },
    },
    take: 500,
  });

  for (const t of withReminders) {
    try {
      if (!t.assignee?.userId) continue;
      if (!dryRun) {
        await db.notification.create({
          data: {
            userId: t.assignee.userId,
            title: "Task reminder",
            message: `${t.title}${t.dueDate ? ` (due ${t.dueDate.toISOString().slice(0, 10)})` : ""}`,
            type: "TASK_REMINDER",
            link: `/tasks?taskId=${t.id}`,
          },
        });
        await db.task.update({
          where: { id: t.id },
          data: { reminderSentAt: new Date() },
        });
      }
      summary.reminderNotified++;
    } catch {
      summary.errors++;
    }
  }

  // 2. Due-soon (3 day + 1 day) for tasks without a reminderDate but with a
  //    dueDate. We reuse `reminderSentAt` as the "was this sent" flag so we
  //    don't nag the same person twice.
  const dueSoon = await db.task.findMany({
    where: {
      deletedAt: null,
      status: { in: ["NOT_STARTED", "IN_PROGRESS", "WAITING_ON_EXTERNAL_PARTY"] },
      reminderDate: null,
      reminderSentAt: null,
      assigneeId: { not: null },
      dueDate: {
        gte: now,
        lte: new Date(now.getTime() + 3 * DAY_MS),
      },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      assignee: { select: { userId: true } },
    },
    take: 500,
  });

  for (const t of dueSoon) {
    try {
      if (!t.assignee?.userId) continue;
      if (!dryRun) {
        await db.notification.create({
          data: {
            userId: t.assignee.userId,
            title: "Task due soon",
            message: `${t.title}${t.dueDate ? ` (due ${t.dueDate.toISOString().slice(0, 10)})` : ""}`,
            type: "TASK_DUE_SOON",
            link: `/tasks?taskId=${t.id}`,
          },
        });
        await db.task.update({
          where: { id: t.id },
          data: { reminderSentAt: new Date() },
        });
      }
      summary.dueSoonNotified++;
    } catch {
      summary.errors++;
    }
  }

  // 3. Escalation: overdue past escalationDate, notify the assignee's
  //    Regional Manager (or fall back to a SUPER_ADMIN).
  const overdue = await db.task.findMany({
    where: {
      deletedAt: null,
      status: { in: ["NOT_STARTED", "IN_PROGRESS", "WAITING_ON_EXTERNAL_PARTY"] },
      escalationDate: { lte: now },
      escalatedAt: null,
      assigneeId: { not: null },
    },
    select: {
      id: true,
      title: true,
      dueDate: true,
      assignee: {
        select: {
          user: { select: { id: true, name: true, regionId: true } },
        },
      },
    },
    take: 500,
  });

  for (const t of overdue) {
    try {
      const assignee = t.assignee?.user;
      if (!assignee) continue;
      // Find a Regional Manager in the same region, or fall back to a super
      // admin. We deliberately do not notify the Assignee here — they already
      // got the reminder + due-soon path.
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
        await db.notification.create({
          data: {
            userId: escalateTo.id,
            title: "Overdue task escalated",
            message: `${assignee.name ?? "A team member"} has an overdue task: ${t.title}`,
            type: "TASK_ESCALATED",
            link: `/tasks?taskId=${t.id}`,
          },
        });
        await db.task.update({
          where: { id: t.id },
          data: { escalatedAt: new Date() },
        });
      }
      summary.escalated++;
    } catch {
      summary.errors++;
    }
  }

  return summary;
}
