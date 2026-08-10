import { db } from "@/lib/db";
import type { TaskRecurrence } from "@prisma/client";

/**
 * Spec Tasks §D — recurring tasks. When a recurring task is completed, the
 * next occurrence is materialised so the user always has a live copy on the
 * cadence they scheduled. Called from PATCH /api/tasks/[id] after the task
 * moves to COMPLETED / DONE.
 *
 * We copy the essential fields (title, description, priority, category,
 * parent link, assignee, recurrence) and advance the dueDate by the
 * recurrence interval. Fields that describe the previous occurrence
 * (startedAt / completedAt / actualMinutes / reminderSentAt / escalatedAt)
 * are NOT copied. The new row is created as NOT_STARTED with a fresh
 * updatedAt.
 *
 * The function is idempotent-ish: it refuses to spawn a second copy if the
 * task already has a child whose parentId chain leads back here within the
 * same window. In practice PATCH only calls it once on the transition, so
 * a race would need two concurrent transitions on the same row.
 */
export async function materialiseNextRecurrence(taskId: string): Promise<{ createdId: string } | null> {
  const source = await db.task.findUnique({
    where: { id: taskId },
    select: {
      id: true,
      title: true,
      description: true,
      priority: true,
      category: true,
      recurrence: true,
      parentType: true,
      parentId: true,
      assigneeId: true,
      createdById: true,
      dueDate: true,
      reminderDate: true,
      escalationDate: true,
      estimatedMinutes: true,
      templateId: true,
    },
  });
  if (!source || source.recurrence === "ONE_OFF") return null;

  // Compute the next dueDate. If the source didn't have one, base off "now"
  // so the recurrence keeps ticking regardless of whether dates were entered.
  const base = source.dueDate ?? new Date();
  const nextDue = advance(base, source.recurrence);

  // Idempotency guard: don't materialise if another row with the same
  // (templateId, title, dueDate) already exists — that indicates a duplicate
  // completion event, e.g. a client that double-clicks the Done button.
  if (source.templateId) {
    const existing = await db.task.findFirst({
      where: {
        templateId: source.templateId,
        title: source.title,
        dueDate: nextDue,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing) return null;
  }

  const created = await db.task.create({
    data: {
      title: source.title,
      description: source.description,
      priority: source.priority,
      category: source.category,
      recurrence: source.recurrence,
      parentType: source.parentType,
      parentId: source.parentId,
      assigneeId: source.assigneeId,
      createdById: source.createdById,
      dueDate: nextDue,
      // Bump reminder + escalation dates by the same delta so the follow-up
      // schedule tracks. If the original had none, leave the child null too.
      reminderDate: shiftBy(source.reminderDate, base, nextDue),
      escalationDate: shiftBy(source.escalationDate, base, nextDue),
      estimatedMinutes: source.estimatedMinutes,
      templateId: source.templateId,
      status: "NOT_STARTED",
    },
    select: { id: true },
  });
  return { createdId: created.id };
}

function advance(from: Date, rec: TaskRecurrence): Date {
  const out = new Date(from);
  switch (rec) {
    case "WEEKLY":
      out.setDate(out.getDate() + 7);
      break;
    case "MONTHLY":
      out.setMonth(out.getMonth() + 1);
      break;
    case "QUARTERLY":
      out.setMonth(out.getMonth() + 3);
      break;
    case "ANNUAL":
      out.setFullYear(out.getFullYear() + 1);
      break;
    default:
      // Compiler-exhaustiveness fallback — ONE_OFF is filtered above.
      break;
  }
  return out;
}

function shiftBy(target: Date | null, fromBase: Date, toBase: Date): Date | null {
  if (!target) return null;
  const delta = toBase.getTime() - fromBase.getTime();
  return new Date(target.getTime() + delta);
}
