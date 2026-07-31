import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { HRDashboardStats } from "./_components/hr-dashboard-stats";
import { HRTabsClient } from "./_components/hr-tabs-client";
import { ACTIVE_EMPLOYEE, OWNED_BY_LIVE_EMPLOYEE } from "@/lib/hr-scope";
import { canRequestAccount, canReviewAccountRequest } from "@/lib/account-requests";

export default async function HRPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const { role, id: userId } = session.user;
  const isHR = role === "HR_MANAGER" || role === "SUPER_ADMIN";
  const canSeeAccountRequests = canRequestAccount(role) || canReviewAccountRequest(role);

  // For employee self-service: redirect to their profile
  if (role === "EMPLOYEE") {
    const emp = await db.employee.findUnique({ where: { userId } });
    if (emp) redirect(`/hr/employees/${emp.id}`);
  }

  const [totalEmployees, onLeaveToday, openTasks, pendingLeave] = await Promise.all([
    db.employee.count({ where: ACTIVE_EMPLOYEE }),
    db.leaveRequest.count({
      where: {
        status: "APPROVED",
        startDate: { lte: new Date() },
        endDate: { gte: new Date() },
        ...OWNED_BY_LIVE_EMPLOYEE,
      },
    }),
    db.task.count({ where: { status: { in: ["TODO", "IN_PROGRESS"] }, deletedAt: null } }),
    db.leaveRequest.count({ where: { status: "PENDING", ...OWNED_BY_LIVE_EMPLOYEE } }),
  ]);

  // Stats for HRDashboardStats
  const deptHeadcount = await db.department.findMany({
    // Counted with the same rule as the headcount above, or the chart would
    // disagree with the stat card sitting directly beside it.
    include: { _count: { select: { employees: { where: ACTIVE_EMPLOYEE } } } },
  });

  const leaveUtilization = await db.leaveBalance.groupBy({
    by: ["leaveType"],
    where: OWNED_BY_LIVE_EMPLOYEE,
    _sum: { usedDays: true, totalDays: true },
  });

  const trainingCompletion = await db.trainingRecord.count({
    where: { completedAt: { not: null }, ...OWNED_BY_LIVE_EMPLOYEE },
  });
  const trainingTotal = await db.trainingRecord.count({ where: OWNED_BY_LIVE_EMPLOYEE });

  const perfScores = await db.performanceReview.findMany({
    where: { score: { not: null }, ...OWNED_BY_LIVE_EMPLOYEE },
    select: { score: true },
  });

  return (
    <div className="p-6 space-y-6">
      <PageHeader title="HR & ERP" description="Workforce management, HR operations, and internal tools" />

      <HRDashboardStats
        deptHeadcount={deptHeadcount.map((d) => ({ name: d.name, count: d._count.employees }))}
        leaveUtilization={leaveUtilization.map((l) => ({ type: l.leaveType, used: l._sum.usedDays ?? 0, total: l._sum.totalDays ?? 0 }))}
        trainingCompletion={trainingTotal > 0 ? Math.round((trainingCompletion / trainingTotal) * 100) : 0}
        perfScoreDistribution={perfScores.map((p) => ({ score: p.score ?? 0 }))}
      />

      <HRTabsClient
        isHR={isHR}
        isSuperAdmin={role === "SUPER_ADMIN"}
        canSeeAccountRequests={canSeeAccountRequests}
        userId={userId}
        totalEmployees={totalEmployees}
        onLeaveToday={onLeaveToday}
        openTasks={openTasks}
        pendingLeave={pendingLeave}
      />
    </div>
  );
}
