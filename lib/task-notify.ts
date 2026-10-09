import { db } from "@/lib/db";
import { describeReminderSchedule, formatTaskDate } from "@/lib/task-reminders";

/**
 * The first notice in a task's life: an email the moment it lands on someone.
 *
 * ★ WHY THIS IS ONE FUNCTION AND NOT FOUR CALL SITES.
 *
 * There are two task endpoints and each has a create and an update path, and
 * before this they behaved four different ways. /api/tasks wrote an in-app
 * notification on create and on reassign; /api/hr/tasks — the one the Tasks
 * screen actually posts to — wrote nothing at all, on either. So the path every
 * member of staff uses was the one path that told nobody anything, and not one
 * of the four ever sent an email.
 *
 * Every site now calls this, so the behaviour cannot drift apart again.
 *
 * Nothing here throws. A notification that fails must not fail the request that
 * created the task — the task is the user's work and it has already been saved.
 */
export async function notifyTaskAssigned(opts: {
  taskId: string;
  /// The signed-in user doing the assigning. They are never emailed about their
  /// own action: raising a task for yourself is not news, and a self-assigned
  /// task is the most common kind.
  actorUserId: string;
  reason: "created" | "reassigned";
}): Promise<boolean> {
  try {
    const task = await db.task.findUnique({
      where: { id: opts.taskId },
      select: {
        id: true,
        title: true,
        description: true,
        dueDate: true,
        priority: true,
        category: true,
        assignee: {
          select: { user: { select: { id: true, name: true, email: true, isActive: true, deletedAt: true } } },
        },
        createdBy: { select: { user: { select: { name: true } } } },
      },
    });
    if (!task) return false;

    const target = task.assignee?.user;
    if (!target) return false;                       // unassigned — nobody to tell
    if (target.id === opts.actorUserId) return false; // assigned it to themselves
    if (!target.isActive || target.deletedAt) return false;

    // Recorded even when the email later fails: the point of the row is "this
    // task was announced", which is what stops a second announcement.
    if (opts.reason === "created") {
      await db.taskReminder
        .upsert({
          where: { taskId_stage: { taskId: task.id, stage: "CREATED" } },
          create: { taskId: task.id, stage: "CREATED", sentCount: 1 },
          update: { sentCount: { increment: 1 } },
        })
        .catch(() => { /* the notice matters more than the bookkeeping */ });
    }

    await db.notification.create({
      data: {
        userId: target.id,
        title: opts.reason === "created" ? "New task assigned" : "Task reassigned to you",
        message: task.title,
        type: "TASK_ASSIGNED",
        link: `/tasks?taskId=${task.id}`,
      },
    });

    if (!target.email) return false;

    const { sendTaskAssignedEmail } = await import("@/lib/email");
    await sendTaskAssignedEmail({
      to: target.email,
      recipientName: target.name ?? "there",
      taskTitle: task.title,
      taskId: task.id,
      assignedByName: task.createdBy?.user?.name ?? "A colleague",
      dueDate: task.dueDate ? formatTaskDate(task.dueDate) : undefined,
      priority: task.priority,
      category: task.category ? task.category.replace(/_/g, " ").toLowerCase() : undefined,
      description: task.description?.slice(0, 300) ?? undefined,
      reminderSchedule: describeReminderSchedule(task.dueDate),
    });
    return true;
  } catch (err) {
    console.error("[task-notify] failed for task", opts.taskId, err);
    return false;
  }
}
