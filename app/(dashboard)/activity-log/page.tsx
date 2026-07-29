import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { ActivityLogView } from "./_components/activity-log-view";

export default async function ActivityLogPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (session.user.role !== "SUPER_ADMIN") redirect("/dashboard");

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [totalCount, todayCount, todayUsers, topEntities] = await Promise.all([
    db.auditLog.count(),
    db.auditLog.count({ where: { createdAt: { gte: today } } }),
    db.auditLog.findMany({
      // Entries whose author has been deleted share a null userId, which would
      // otherwise count as one extra "active user".
      where:  { createdAt: { gte: today }, userId: { not: null } },
      select: { userId: true },
      distinct: ["userId"],
    }),
    db.auditLog.groupBy({
      by: ["entity"],
      _count: { entity: true },
      orderBy: { _count: { entity: "desc" } },
      take: 1,
    }),
  ]);

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Activity Log"
        description="Complete audit trail of all actions taken on the portal — visible to Super Admins only"
      />
      <ActivityLogView
        stats={{
          total:            totalCount,
          today:            todayCount,
          activeUsersToday: todayUsers.length,
          topEntity:        topEntities[0]?.entity ?? "—",
        }}
      />
    </div>
  );
}
