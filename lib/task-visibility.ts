import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

/**
 * Who may see a task.
 *
 * Set on 2026-10-09 and deliberately absolute:
 *
 *   • the person it is ASSIGNED to
 *   • the person who ALLOCATED it
 *
 * and nobody else. Not HR, not a line manager who did not raise it, not a
 * SUPER_ADMIN. A manager sees their own work plus the work they handed out,
 * which is the same shape as the assignment rule in lib/task-assignment.ts:
 * you may give a task to yourself or to a direct report, and you may see a
 * task you hold or a task you gave.
 *
 * ★ WHY THERE IS NO ADMIN ESCAPE HATCH.
 *
 * There was one — `tasks:approve` widened GET /api/tasks to the whole
 * organisation, and HR_ROLES did the same on /api/hr/tasks. Both are removed.
 * A permission that is only ever used to read everybody's work is not an
 * administrative tool, it is a standing exemption, and the point of being
 * strict is that nothing holds one. An admin who needs to see a task can be
 * given it or can ask the person who allocated it; a database restore is the
 * answer to the genuine emergency, and it leaves a trace.
 *
 * ★ A COUNT IS A DISCLOSURE TOO.
 *
 * Every count, groupBy and stat card is scoped through here for the same
 * reason. "Open Tasks: 47" on a dashboard above a list showing three of them
 * tells the reader there are forty-four they cannot see, which is both a leak
 * and a bug report waiting to happen.
 */

/** The `where` fragment that expresses the whole rule. */
export function visibleTaskWhere(employeeId: string): Prisma.TaskWhereInput {
  return { OR: [{ assigneeId: employeeId }, { createdById: employeeId }] };
}

/**
 * The signed-in user's Employee row id, or null.
 *
 * A user with no employee record holds no tasks and allocated none, so the
 * correct answer for them is an empty list — never an unfiltered one. Every
 * caller here treats null as "see nothing", which is why this returns null
 * rather than throwing: a thrown error in a dashboard loader tends to get
 * caught and turned into a fallback that forgets to filter.
 */
export async function employeeIdOf(userId: string): Promise<string | null> {
  const me = await db.employee.findFirst({ where: { userId }, select: { id: true } });
  return me?.id ?? null;
}

/**
 * Scopes any task query to what this USER may see.
 *
 * Returns a `where` that matches nothing when the user has no employee
 * record, rather than one that matches everything. The difference between
 * `{}` and "nothing" is the entire bug class this file exists to prevent.
 */
export async function visibleTaskWhereForUser(
  userId: string,
  extra: Prisma.TaskWhereInput = {}
): Promise<Prisma.TaskWhereInput> {
  const employeeId = await employeeIdOf(userId);
  if (!employeeId) return { ...extra, id: { in: [] } };
  return { ...extra, ...visibleTaskWhere(employeeId) };
}

/** May this user see this one task? Used by row-level gates. */
export async function canSeeTask(userId: string, taskId: string): Promise<boolean> {
  const employeeId = await employeeIdOf(userId);
  if (!employeeId) return false;
  const hit = await db.task.findFirst({
    where: { id: taskId, deletedAt: null, ...visibleTaskWhere(employeeId) },
    select: { id: true },
  });
  return hit !== null;
}

/**
 * The relationship a user has to a task, for the routes that treat the two
 * roles differently — an assignee reports progress, the person who allocated
 * it owns the task itself and is the only one who may delete it.
 */
export async function taskRelation(
  userId: string,
  taskId: string
): Promise<{ isAssignee: boolean; isCreator: boolean; canSee: boolean }> {
  const none = { isAssignee: false, isCreator: false, canSee: false };
  const employeeId = await employeeIdOf(userId);
  if (!employeeId) return none;
  const task = await db.task.findFirst({
    where: { id: taskId, deletedAt: null },
    select: { assigneeId: true, createdById: true },
  });
  if (!task) return none;
  const isAssignee = task.assigneeId === employeeId;
  const isCreator = task.createdById === employeeId;
  return { isAssignee, isCreator, canSee: isAssignee || isCreator };
}
