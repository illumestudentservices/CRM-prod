import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { ActivitiesClient } from "./_components/activities-client";

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

async function getActivityStats() {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [total, thisMonth, byType] = await Promise.all([
    db.activity.count({ where: { deletedAt: null } }),
    db.activity.count({ where: { deletedAt: null, date: { gte: startOfMonth } } }),
    db.activity.groupBy({
      by: ["type"],
      where: { deletedAt: null },
      _count: true,
    }),
  ]);

  return {
    total,
    thisMonth,
    byType: byType.map((b) => ({ type: b.type, count: b._count })),
  };
}

export default async function ActivitiesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await effectiveHasPermission(session.user.role, "activities", "read"))) redirect("/dashboard");

  const [activities, stats] = await Promise.all([getActivities(), getActivityStats()]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activities"
        description="Track school visits, agent meetings, student events, fairs, and partner meetings"
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Activities" }]}
      />
      <ActivitiesClient activities={activities} stats={stats} />
    </div>
  );
}
