// Field Operations is the redesign's name for the old Activities module.
// Route redirects (/activities → /field-operations) live in next.config.ts;
// this page re-uses the existing ActivitiesClient so behaviour is identical
// until the code-level rename PR ships.
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { ActivitiesClient } from "../activities/_components/activities-client";

async function getActivities() {
  return db.activity.findMany({
    where: { deletedAt: null },
    include: {
      user: { select: { id: true, name: true, image: true } },
      institution: { select: { id: true, name: true } },
      market: { select: { id: true, name: true } },
      school: { select: { id: true, name: true } },
      _count: { select: { attendees: true } },
    },
    orderBy: { date: "desc" },
    take: 100,
  });
}

async function getStats() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const [total, thisMonth, byType] = await Promise.all([
    db.activity.count({ where: { deletedAt: null } }),
    db.activity.count({ where: { deletedAt: null, date: { gte: startOfMonth } } }),
    db.activity.groupBy({ by: ["type"], where: { deletedAt: null }, _count: true }),
  ]);
  return { total, thisMonth, byType: byType.map((b) => ({ type: b.type, count: b._count })) };
}

export default async function FieldOperationsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  if (!(await effectiveHasPermission(session.user.role as any, "field_operations", "read"))) {
    redirect("/dashboard");
  }
  const [activities, stats] = await Promise.all([getActivities(), getStats()]);
  return (
    <div className="p-6">
      <PageHeader
        title="Field Operations"
        description="Planned service-delivery activities linked to Clients, Recruitment Partners, Events and Markets."
      />
      <ActivitiesClient activities={activities} stats={stats} />
    </div>
  );
}
