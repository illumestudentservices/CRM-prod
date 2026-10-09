import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { assignableEmployees } from "@/lib/task-assignment";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { PageHeader } from "@/components/shared/page-header";
import { TasksClient } from "./_components/tasks-client";
import { MyDashboard } from "./_components/my-dashboard";
import { FireTemplatesButton } from "./_components/fire-templates-button";

async function getAllTasks() {
  return db.task.findMany({
    where: { deletedAt: null },
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
    getAllTasks(),
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
