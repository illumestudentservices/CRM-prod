import { db } from "@/lib/db";
import { ACTIVE_EMPLOYEE } from "@/lib/hr-scope";

/**
 * Who may be given a task, and by whom.
 *
 * The rule, set on 2026-10-09, is deliberately narrow:
 *
 *   • you may give a task to YOURSELF
 *   • you may give a task to someone who REPORTS DIRECTLY TO YOU
 *   • there is no third way
 *
 * No role is exempt, including SUPER_ADMIN. That is the point of it: a task is
 * a commitment made on somebody's behalf, and the person who answers for that
 * commitment is their line manager. An admin who needs a task done two levels
 * down asks the manager in between, which is also how the work would be chased
 * if it slipped.
 *
 * ★ WHY THIS IS ENFORCED IN FIVE PLACES AND NOT ONE.
 *
 * There is no single choke point. A task's assignee can be set by
 * POST /api/tasks, POST /api/hr/tasks, PATCH on either of those, and
 * POST /api/tasks/templates/fire — which fires a whole template at someone in
 * one request. Guarding creation alone would leave the obvious hole: raise the
 * task for yourself, then PATCH it onto anybody you like. Every one of those
 * five calls this.
 *
 * Automations are NOT subject to it. lib/task-workflow.ts, the recurrence
 * materialiser and the event triggers create tasks from rules the business
 * already agreed, not from a person's choice in a dialog, and the assignee
 * there is derived rather than picked. The rule governs what a USER may choose.
 */

/** Why an assignment was refused, phrased for the person who tried it. */
export type AssignmentRefusal = { status: 403 | 404; error: string };

/**
 * Returns null when the assignment is allowed, or the refusal to return.
 *
 * `assigneeId` is an Employee id, not a User id — tasks are assigned to
 * employee records, and the two are easy to confuse at a call site.
 */
export async function refuseAssignment(
  creatorEmployeeId: string,
  assigneeId: string
): Promise<AssignmentRefusal | null> {
  // Yourself. The common case, and the one that must never need a lookup.
  if (assigneeId === creatorEmployeeId) return null;

  const assignee = await db.employee.findFirst({
    where: { id: assigneeId, ...ACTIVE_EMPLOYEE },
    select: { id: true, managerId: true },
  });

  // Not found, or found but inactive/deleted. Both answer the same way: a
  // caller must not be able to tell a departed colleague's employee id from a
  // string they made up.
  if (!assignee) {
    return { status: 404, error: "That employee was not found." };
  }

  if (assignee.managerId === creatorEmployeeId) return null;

  return {
    status: 403,
    error:
      "You can only assign tasks to yourself or to someone who reports directly to you. " +
      "Ask their manager to raise it.",
  };
}

/**
 * The people the signed-in employee may pick in an assignee dropdown: them,
 * then their direct reports by name.
 *
 * The UI list and the API rule are built from the same definition on purpose.
 * A dropdown offering somebody the server will refuse is not a smaller problem
 * than no dropdown at all — it is a worse one, because the refusal arrives
 * after the person has written the task out.
 */
export async function assignableEmployees(employeeId: string) {
  const [self, reports] = await Promise.all([
    db.employee.findFirst({
      where: { id: employeeId, ...ACTIVE_EMPLOYEE },
      include: { user: { select: { id: true, name: true, image: true } } },
    }),
    db.employee.findMany({
      where: { managerId: employeeId, ...ACTIVE_EMPLOYEE },
      include: { user: { select: { id: true, name: true, image: true } } },
      orderBy: { user: { name: "asc" } },
    }),
  ]);
  return self ? [self, ...reports] : reports;
}
