import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { PageHeader } from "@/components/shared/page-header";
import { TasksClient } from "./_components/tasks-client";
import { MyDashboard } from "./_components/my-dashboard";
import { FireTemplatesButton } from "./_components/fire-templates-button";
import { ACTIVE_EMPLOYEE } from "@/lib/hr-scope";

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

async function getEmployees() {
  return db.employee.findMany({
    where: ACTIVE_EMPLOYEE,
    include: { user: { select: { id: true, name: true, image: true } } },
    orderBy: { user: { name: "asc" } },
  });
}

export default async function TasksPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await effectiveHasPermission(session.user.role, "tasks", "read"))) redirect("/dashboard");

  const canWrite = await effectiveHasPermission(session.user.role, "tasks", "write");

  const [tasks, employees, templates] = await Promise.all([
    getAllTasks(),
    getEmployees(),
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
