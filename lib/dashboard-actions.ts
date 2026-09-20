import { db } from "@/lib/db";
import type { LeadStage } from "@prisma/client";
import {
  PIPELINE_STAGES,
  STAGE_LABELS,
  INACTIVITY_REMINDER_DAYS,
  INACTIVITY_ESCALATION_DAYS,
} from "@/lib/lead-pipeline";
import type { ActionItem, MyTask } from "@/app/(dashboard)/dashboard/_components/action-items";

/**
 * "What needs me today" for one person's dashboard.
 *
 * Built from the SAME signals as the nightly email digest — approaching
 * deadlines, stalled students, overdue tasks — so the screen and the inbox
 * cannot disagree. If the morning email says six things need you, this is
 * where you find out which six.
 *
 * Runs on every dashboard load, so every query is indexed on a column the
 * schema already indexes and capped with `take`. It must not scan a caseload.
 */

/**
 * Open work.
 *
 * ★ TWO enum members mean "not started" and TWO mean "finished" — TODO and
 * NOT_STARTED, DONE and COMPLETED — a legacy of an earlier vocabulary. Listing
 * only the obvious one silently under-counts someone's workload, which is the
 * kind of wrong that looks right.
 */
export const OPEN_TASK_STATUSES = [
  "TODO",
  "NOT_STARTED",
  "IN_PROGRESS",
  "WAITING_ON_EXTERNAL_PARTY",
] as const;

export type DashboardActions = {
  items: ActionItem[];
  tasks: MyTask[];
  counts: {
    deadlines: number;
    stale: number;
    overdueTasks: number;
    openTasks: number;
  };
};

export async function getDashboardActions(userId: string): Promise<DashboardActions> {
  const now = new Date();
  const in7Days = new Date(now.getTime() + 7 * 86_400_000);
  const staleCutoff = new Date(now.getTime() - INACTIVITY_REMINDER_DAYS * 86_400_000);

  // ★ Task.assigneeId references employees.id, NOT users.id — the odd one out
  // among the ownership columns. A user account may also have no employee row
  // at all, so this has to cope with null rather than assume a join.
  const employee = await db.employee.findFirst({
    where: { userId },
    select: { id: true },
  });

  const [deadlines, stale, openTasks] = await Promise.all([
    db.leadApplication.findMany({
      where: {
        lead: { assignedICRId: userId, deletedAt: null },
        OR: [
          { offerExpiryDate: { gte: now, lte: in7Days } },
          { depositPaid: false, depositDeadline: { gte: now, lte: in7Days } },
        ],
      },
      select: {
        id: true,
        offerExpiryDate: true,
        depositDeadline: true,
        depositPaid: true,
        lead: { select: { id: true, firstName: true, lastName: true } },
        institution: { select: { name: true } },
      },
      take: 10,
    }),
    db.lead.findMany({
      where: {
        assignedICRId: userId,
        deletedAt: null,
        // Only the live funnel. A closed or deferred student is SUPPOSED to be
        // dormant, and listing them as needing attention would bury the ones
        // that do.
        stage: { in: [...PIPELINE_STAGES] as LeadStage[] },
        stageEnteredAt: { lte: staleCutoff },
      },
      select: {
        id: true, firstName: true, lastName: true, stage: true, stageEnteredAt: true,
      },
      orderBy: { stageEnteredAt: "asc" },
      take: 10,
    }),
    employee
      ? db.task.findMany({
          where: {
            assigneeId: employee.id,
            status: { in: [...OPEN_TASK_STATUSES] as never },
          },
          select: { id: true, title: true, dueDate: true, priority: true },
          // Nulls last: a task with no due date is real work, but it is not
          // what someone should be looking at first.
          orderBy: [{ dueDate: { sort: "asc", nulls: "last" } }],
          take: 25,
        })
      : Promise.resolve([]),
  ]);

  const items: ActionItem[] = [];

  for (const app of deadlines) {
    const parts: string[] = [];
    if (app.offerExpiryDate) {
      const d = Math.ceil((app.offerExpiryDate.getTime() - now.getTime()) / 86_400_000);
      parts.push(`offer expires in ${d} day${d === 1 ? "" : "s"}`);
    }
    if (!app.depositPaid && app.depositDeadline) {
      const d = Math.ceil((app.depositDeadline.getTime() - now.getTime()) / 86_400_000);
      parts.push(`deposit due in ${d} day${d === 1 ? "" : "s"}`);
    }
    if (parts.length === 0) continue;
    items.push({
      kind: "deadline",
      title: `${app.lead.firstName} ${app.lead.lastName}`.trim(),
      detail: `${app.institution.name} — ${parts.join(", ")}`,
      href: `/students/${app.lead.id}`,
      // A closing offer or deposit window is the one thing here that cannot be
      // caught up on afterwards.
      urgent: true,
    });
  }

  for (const lead of stale) {
    const days = Math.floor((now.getTime() - lead.stageEnteredAt.getTime()) / 86_400_000);
    items.push({
      kind: "stale",
      title: `${lead.firstName} ${lead.lastName}`.trim(),
      detail: `${days} days in ${STAGE_LABELS[lead.stage]} with no progress`,
      href: `/students/${lead.id}`,
      // Matches the point at which the nightly job escalates to a manager, so
      // the dashboard turns amber at the same moment the email does.
      urgent: days >= INACTIVITY_ESCALATION_DAYS,
    });
  }

  const overdueTasks = openTasks.filter((t) => t.dueDate && t.dueDate < now);
  for (const task of overdueTasks.slice(0, 10)) {
    items.push({
      kind: "task",
      title: task.title,
      detail: `Overdue since ${task.dueDate!.toISOString().slice(0, 10)}`,
      href: `/tasks?taskId=${task.id}`,
      urgent: true,
    });
  }

  // Urgent first, so the top of the card is the part that cannot wait. Stable
  // beyond that: each source is already ordered, and re-sorting them together
  // would shuffle the list between loads for no reason.
  items.sort((a, b) => Number(b.urgent) - Number(a.urgent));

  return {
    items,
    tasks: openTasks,
    counts: {
      deadlines: deadlines.length,
      stale: stale.length,
      overdueTasks: overdueTasks.length,
      openTasks: openTasks.length,
    },
  };
}
