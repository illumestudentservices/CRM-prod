import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assignableEmployees } from "@/lib/task-assignment";
import { visibleTaskWhereForUser } from "@/lib/task-visibility";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { PageHeader } from "@/components/shared/page-header";
import { TasksClient } from "./_components/tasks-client";
import { MyDashboard } from "./_components/my-dashboard";
import { FireTemplatesButton } from "./_components/fire-templates-button";

/**
 * The tasks this person is entitled to see, with a count of the files on each.
 *
 * ★ IT USED TO BE `where: { deletedAt: null }` — EVERY TASK IN THE COMPANY.
 *
 * GET /api/tasks was narrowed for exactly this reason: anyone holding
 * tasks:read could list the two hundred most recent tasks across the whole
 * organisation. The page was not narrowed with it, so the hole stayed open on
 * the surface staff actually use, and a task title is rarely neutral — "Draft
 * exit letter for <name>" tells you something nobody meant to publish.
 *
 * The scope now matches the API's exactly, and there is no longer an admin
 * tier above it: your own tasks plus the ones you allocated, for everybody.
 * The `tasks:approve` widening this page briefly honoured was removed on
 * 2026-10-09 — see lib/task-visibility.ts for why.
 */
async function getVisibleTasks(userId: string) {
  const tasks = await db.task.findMany({
    where: await visibleTaskWhereForUser(userId, { deletedAt: null }),
    include: {
      assignee: {
        include: { user: { select: { id: true, name: true, image: true } } },
      },
      createdBy: {
        include: { user: { select: { id: true, name: true } } },
      },
      sourceActivity: {
        select: { id: true, title: true, type: true },
      },
    },
    orderBy: [{ priority: "desc" }, { dueDate: "asc" }, { createdAt: "desc" }],
  });

  // One grouped count rather than a query per row. Without it the paperclip
  // can only say "attachments exist somewhere in here", which is the state the
  // screen was in: the option was hidden in a row menu and nothing on the page
  // ever indicated a task had a file on it at all.
  if (tasks.length === 0) return [];
  const counts = await db.attachment.groupBy({
    by: ["parentId"],
    where: {
      parentType: "TASK",
      parentId: { in: tasks.map((t) => t.id) },
      deletedAt: null,
    },
    _count: { _all: true },
  });
  const byTask = new Map(counts.map((c) => [c.parentId, c._count._all]));
  return tasks.map((t) => ({ ...t, attachmentCount: byTask.get(t.id) ?? 0 }));
}

/**
 * Who this person may put a task on: themselves, and their direct reports.
 *
 * It used to be every active employee in the company. The assignee dropdown is
 * the only place staff learn what the rule is, and offering a name the server
 * will refuse is worse than not offering it — the refusal arrives after the
 * task has been written out. Built from the same helper the API enforces with,
 * so the list and the rule cannot drift apart.
 */
async function getAssignableEmployees(userId: string) {
  const me = await db.employee.findFirst({ where: { userId }, select: { id: true } });
  if (!me) return [];
  return assignableEmployees(me.id);
}

export default async function TasksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await effectiveHasPermission(session.user.role, "tasks", "read"))) redirect("/dashboard");

  const canWrite = await effectiveHasPermission(session.user.role, "tasks", "write");

  const [tasks, employees, templates] = await Promise.all([
    getVisibleTasks(session.user.id),
    getAssignableEmployees(session.user.id),
    canWrite
      ? db.taskTemplate.findMany({
          orderBy: [{ isActive: "desc" }, { name: "asc" }],
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        description="Manage and track tasks across all teams and activities"
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Tasks" },
        ]}
        actions={
          canWrite ? (
            <FireTemplatesButton
              templates={templates.map((t) => ({
                id: t.id,
                name: t.name,
                description: t.description,
                triggerEvent: t.triggerEvent,
                category: t.category,
                recurrence: t.recurrence,
                isActive: t.isActive,
              }))}
            />
          ) : undefined
        }
      />
      <MyDashboard />
      <TasksClient tasks={tasks} employees={employees} />
    </div>
  );
}
