import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role } = session.user as { role: Role; id: string };

    if (!await effectiveHasPermission(role, "analytics", "read")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Only executive roles can access this endpoint
    if (!["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS"].includes(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const quarterMonth = Math.floor(now.getMonth() / 3) * 3;
    const quarterStart = new Date(now.getFullYear(), quarterMonth, 1);
    const ninetyDaysFromNow = new Date(now);
    ninetyDaysFromNow.setDate(now.getDate() + 90);

    // ── Parallel queries ────────────────────────────────────────────────────
    const [
      // Revenue
      activeInstitutions,
      renewalPipeline,

      // Delivery
      activitiesThisMonth,
      activitiesThisQuarter,
      totalDeliverables,
      completedDeliverables,
      overdueDeliverables,

      // Recruitment
      applicationCount,
      offerCount,
      enrolledCount,
      totalLeads,

      // Market Coverage
      schoolsCount,
      agentsCount,
      counsellorsCount,
      marketsCount,

      // Team Performance - top ICRs by lead count
      topICRs,
      // KPI achievement
      kpiTotal,
      kpiAchieved,

      // Risk
      openRisksByType,
      criticalRisks,
      pendingCompliance,
      overdueCompliance,
    ] = await Promise.all([
      // Revenue: active contract values
      db.institution.aggregate({
        where: { accountStatus: "ACTIVE", deletedAt: null },
        _sum: { contractValue: true },
        _count: { id: true },
      }),
      // Revenue: renewal pipeline (renewalDate within next 90 days)
      db.institution.aggregate({
        where: {
          deletedAt: null,
          renewalDate: { gte: now, lte: ninetyDaysFromNow },
        },
        _sum: { contractValue: true },
        _count: { id: true },
      }),

      // Delivery: activities this month
      db.activity.count({
        where: { date: { gte: monthStart, lte: now }, deletedAt: null },
      }),
      // Delivery: activities this quarter
      db.activity.count({
        where: { date: { gte: quarterStart, lte: now }, deletedAt: null },
      }),
      // Delivery: total deliverables
      db.deliverable.count(),
      // Delivery: completed deliverables
      db.deliverable.count({ where: { completedAt: { not: null } } }),
      // Delivery: overdue deliverables
      db.deliverable.count({
        where: { dueDate: { lt: now }, completedAt: null },
      }),

      // Recruitment
      db.lead.count({ where: { stage: "APPLICATION_SUBMITTED", deletedAt: null } }),
      db.lead.count({ where: { stage: "OFFER_RECEIVED", deletedAt: null } }),
      db.lead.count({ where: { stage: "ENROLLED", deletedAt: null } }),
      db.lead.count({ where: { deletedAt: null } }),

      // Market Coverage
      db.school.count({ where: { isActive: true, deletedAt: null } }),
      db.source.count({
        where: { type: "AGENT", isActive: true, deletedAt: null },
      }),
      db.counsellor.count({ where: { isActive: true } }),
      db.market.count({ where: { isActive: true, deletedAt: null } }),

      // Team Performance: top 5 ICRs by leads
      db.lead.groupBy({
        by: ["assignedICRId"],
        where: { deletedAt: null, assignedICRId: { not: null } },
        _count: { id: true },
        orderBy: { _count: { id: "desc" } },
        take: 5,
      }),

      // KPI achievement
      db.kPITarget.count(),
      db.kPITarget.count({ where: { achieved: true } }),

      // Risk: open risks by type
      db.riskRegister.groupBy({
        by: ["type"],
        where: { status: "OPEN" },
        _count: { id: true },
      }),
      // Risk: critical risks (riskScore >= 20)
      db.riskRegister.count({
        where: { status: "OPEN", riskScore: { gte: 20 } },
      }),
      // Compliance: pending
      db.complianceItem.count({ where: { status: "PENDING" } }),
      // Compliance: overdue
      db.complianceItem.count({
        where: { status: "PENDING", dueDate: { lt: now } },
      }),
    ]);

    // ── Resolve ICR names ──────────────────────────────────────────────────
    const icrIds = topICRs
      .map((g) => g.assignedICRId)
      .filter(Boolean) as string[];

    const icrUsers = icrIds.length
      ? await db.user.findMany({
          where: { id: { in: icrIds } },
          select: { id: true, name: true, email: true },
        })
      : [];

    const icrNameMap: Record<string, string> = {};
    for (const u of icrUsers) {
      icrNameMap[u.id] = u.name ?? u.email;
    }

    const topICRsFormatted = topICRs.map((g) => ({
      id: g.assignedICRId,
      name: g.assignedICRId ? (icrNameMap[g.assignedICRId] ?? "Unknown") : "Unassigned",
      leads: g._count.id,
    }));

    // ── Risk breakdown map ─────────────────────────────────────────────────
    const riskBreakdown: Record<string, number> = {
      MARKET: 0,
      STAFF: 0,
      CLIENT: 0,
      OPERATIONAL: 0,
    };
    for (const r of openRisksByType) {
      riskBreakdown[r.type] = r._count.id;
    }

    // ── Build response ─────────────────────────────────────────────────────
    return NextResponse.json({
      revenue: {
        totalContractValue: activeInstitutions._sum.contractValue ?? 0,
        activeContracts: activeInstitutions._count.id,
        renewalPipelineCount: renewalPipeline._count.id,
        renewalPipelineValue: renewalPipeline._sum.contractValue ?? 0,
      },
      delivery: {
        activitiesThisMonth,
        activitiesThisQuarter,
        totalDeliverables,
        completedDeliverables,
        completionRate:
          totalDeliverables > 0
            ? Math.round((completedDeliverables / totalDeliverables) * 100)
            : 0,
        overdueDeliverables,
      },
      recruitment: {
        applications: applicationCount,
        offers: offerCount,
        enrolments: enrolledCount,
        totalLeads,
        conversionRate:
          totalLeads > 0
            ? Math.round((enrolledCount / totalLeads) * 100 * 10) / 10
            : 0,
      },
      marketCoverage: {
        schools: schoolsCount,
        agents: agentsCount,
        counsellors: counsellorsCount,
        markets: marketsCount,
      },
      teamPerformance: {
        topICRs: topICRsFormatted,
        kpiAchievementRate:
          kpiTotal > 0
            ? Math.round((kpiAchieved / kpiTotal) * 100)
            : 0,
      },
      risk: {
        breakdown: riskBreakdown,
        criticalCount: criticalRisks,
        pendingCompliance,
        overdueCompliance,
      },
    });
  } catch (error) {
    console.error("[analytics/executive] GET error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
