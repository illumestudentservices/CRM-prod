import { db } from "@/lib/db";
import { describeReminderSchedule, formatTaskDate } from "@/lib/task-reminders";

/**
 * The fields a task-update email cares about, read BEFORE the update so each
 * change can be compared against what it replaced.
 */
type TaskBefore = {
  status?: string | null;
  priority?: string | null;
  dueDate?: Date | string | null;
  assigneeId?: string | null;
};

/**
 * Turns an applied task patch into the list of KEY changes a manager should
 * hear about. Deliberately NOT every edit — a title tweak or a TODO→In Progress
 * flip is the assignee's own business. Only the events that change the shape of
 * the work: it was finished, cancelled, handed to someone else, re-dated, or
 * re-prioritised.
 *
 * Compared against `before` so a PATCH that re-sends an unchanged value says
 * nothing, and fed the APPLIED patch (not the raw request) so a field the route
 * stripped — e.g. an assignee who may only move status — is never reported as a
 * change that did not happen.
 */
export function summariseKeyTaskChanges(
  applied: Record<string, unknown>,
  before: TaskBefore
): string[] {
  const out: string[] = [];

  if (typeof applied.status === "string" && applied.status !== before.status) {
    if (applied.status === "DONE" || applied.status === "COMPLETED") out.push("marked it complete");
    else if (applied.status === "CANCELLED") out.push("cancelled it");
  }

  if (typeof applied.priority === "string" && applied.priority !== before.priority) {
    out.push(`changed the priority to ${applied.priority.toLowerCase()}`);
  }

  if ("dueDate" in applied && applied.dueDate !== undefined) {
    const nd = applied.dueDate ? new Date(applied.dueDate as string | Date).getTime() : null;
    const od = before.dueDate ? new Date(before.dueDate).getTime() : null;
    if (nd !== od) out.push(nd ? "changed the due date" : "cleared the due date");
  }

  if (typeof applied.assigneeId === "string" && applied.assigneeId !== before.assigneeId) {
    out.push("reassigned it");
  }

  return out;
}

/**
 * Tells the editor's manager that their team member changed a task.
 *
 * ★ WHO: the manager of the person who made the change (resolveManager follows
 * Employee.managerId first, region second). An action by someone with no
 * manager, or whose manager is themselves, tells nobody — the same quiet-null
 * rule the lead notifications use.
 *
 * Only KEY changes reach here (see summariseKeyTaskChanges); an empty list is a
 * no-op. Fire-and-forget: never throws, never blocks the update that already
 * saved.
 */
export async function notifyManagerOfTaskUpdate(opts: {
  taskId: string;
  actorUserId: string;
  changes: string[];
}): Promise<boolean> {
  try {
    if (opts.changes.length === 0) return false;

    const task = await db.task.findUnique({
      where: { id: opts.taskId },
      select: { id: true, title: true, status: true, dueDate: true, priority: true },
    });
    if (!task) return false;

    // resolveManager lives with the lead notifications but is generic — it
    // answers "who does this user report to", which is exactly the question here.
    const { resolveManager } = await import("@/lib/lead-notifications");
    const manager = await resolveManager(opts.actorUserId);
    if (!manager) return false; // nobody to tell

    const actor = await db.user.findUnique({
      where: { id: opts.actorUserId },
      select: { name: true, email: true },
    });
    if (manager.email === actor?.email) return false; // never email the editor themselves

    const actorName = actor?.name ?? "A team member";

    // In-app bell for the manager, alongside the email record.
    const managerUser = await db.user.findFirst({
      where: { email: manager.email },
      select: { id: true },
    });
    if (managerUser && managerUser.id !== opts.actorUserId) {
      await db.notification
        .create({
          data: {
            userId: managerUser.id,
            title: "Task updated",
            message: `${actorName} ${opts.changes[0]} — ${task.title}`,
            type: "TASK_UPDATED",
            link: `/tasks?taskId=${task.id}`,
          },
        })
        .catch(() => { /* the email is the record; the bell is a bonus */ });
    }

    const { sendTaskUpdatedEmail } = await import("@/lib/email");
    await sendTaskUpdatedEmail({
      to: manager.email,
      managerName: manager.name,
      actorName,
      taskTitle: task.title,
      taskId: task.id,
      changes: opts.changes,
      status: task.status,
      priority: task.priority ?? undefined,
      dueDate: task.dueDate ? formatTaskDate(task.dueDate) : undefined,
      taskUrl: `${process.env.NEXTAUTH_URL ?? ""}/tasks?taskId=${task.id}`,
    });
    return true;
  } catch (err) {
    console.error("[task-notify] manager update notify failed for task", opts.taskId, err);
    return false;
  }
}

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
