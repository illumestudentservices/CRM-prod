import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { deriveLeaveBalances } from "@/lib/leave-policy";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/shared/page-header";
import { HRDashboardStats } from "./_components/hr-dashboard-stats";
import { HRTabsClient } from "./_components/hr-tabs-client";
import { ACTIVE_EMPLOYEE, OWNED_BY_LIVE_EMPLOYEE } from "@/lib/hr-scope";
import { canRequestAccount, canReviewAccountRequest } from "@/lib/account-requests";
import {
  canRequestOffboarding,
  canReviewOffboardingRequest,
} from "@/lib/offboarding-requests";

export default async function HRPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const { role, id: userId } = session.user;
  const isHR = role === "HR_MANAGER" || role === "SUPER_ADMIN";
  const canSeeAccountRequests = canRequestAccount(role) || canReviewAccountRequest(role);
  const canSeeOffboarding = canRequestOffboarding(role) || canReviewOffboardingRequest(role);

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

  // Utilisation is used-against-entitlement, and entitlement is derived per
  // employee from their joining date. A groupBy over the stored totalDays column
  // summed a column that is always 0, so the chart read "n days used of 0".
  const leaveEmployees = await db.employee.findMany({
    where: ACTIVE_EMPLOYEE,
    select: {
      startDate: true,
      leaveBalances: {
        where: { year: new Date().getUTCFullYear() },
        select: { leaveType: true, usedDays: true, pendingDays: true, adjustmentDays: true },
      },
    },
  });

  const utilisation = new Map<string, { used: number; total: number }>();
  for (const emp of leaveEmployees) {
    for (const b of deriveLeaveBalances(emp.startDate, emp.leaveBalances)) {
      const acc = utilisation.get(b.leaveType) ?? { used: 0, total: 0 };
      acc.used += b.usedDays;
      acc.total += b.totalDays;
      utilisation.set(b.leaveType, acc);
    }
  }
  const leaveUtilization = [...utilisation.entries()].map(([type, v]) => ({
    type,
    used: Number(v.used.toFixed(2)),
    total: Number(v.total.toFixed(2)),
  }));

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
        leaveUtilization={leaveUtilization}
        trainingCompletion={trainingTotal > 0 ? Math.round((trainingCompletion / trainingTotal) * 100) : 0}
        perfScoreDistribution={perfScores.map((p) => ({ score: p.score ?? 0 }))}
      />

      <HRTabsClient
        isHR={isHR}
        isSuperAdmin={role === "SUPER_ADMIN"}
        canSeeAccountRequests={canSeeAccountRequests}
        canSeeOffboarding={canSeeOffboarding}
        userId={userId}
        totalEmployees={totalEmployees}
        onLeaveToday={onLeaveToday}
        openTasks={openTasks}
        pendingLeave={pendingLeave}
      />
    </div>
  );
}
