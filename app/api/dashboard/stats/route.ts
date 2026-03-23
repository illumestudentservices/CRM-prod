import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function startOfLastMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() - 1, 1);
}
function endOfLastMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), 0, 23, 59, 59, 999);
}
function pct(current: number, previous: number) {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100 * 10) / 10;
}

// ─── GET /api/dashboard/stats ─────────────────────────────────────────────────

export async function GET() {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId, regionId } = session.user;
    const now = new Date();
    const thisMonthStart = startOfMonth(now);
    const lastMonthStart = startOfLastMonth(now);
    const lastMonthEnd = endOfLastMonth(now);

    // Build scope where clause
    const scopeWhere = buildScopeWhere(role, userId, regionId);

    const ERP_ONLY: Role[] = ["HR_MANAGER", "EMPLOYEE"];

    if (ERP_ONLY.includes(role)) {
      return getERPStats(userId, now);
    }

    const scopedRegionId = scopeWhere.regionId;
    const scopedICRId = scopeWhere.assignedICRId;

    // Build lead scope filter explicitly to satisfy Prisma's type checker
    const leadScope = {
      deletedAt: null as null,
      ...(scopedICRId ? { assignedICRId: scopedICRId } : {}),
      ...(scopedRegionId ? { regionId: scopedRegionId } : {}),
    };
    const geoScope = scopedRegionId ? { regionId: scopedRegionId } : {};

    const [
      totalLeads,
      leadsThisMonth,
      leadsLastMonth,
      enrolled,
      enrolledLastMonth,
      totalEvents,
      eventsThisMonth,
      eventsLastMonth,
      totalSources,
      sourcesLastMonth,
      totalInstitutions,
      institutionsLastMonth,
      byStage,
    ] = await Promise.all([
      db.lead.count({ where: leadScope }),
      db.lead.count({ where: { ...leadScope, createdAt: { gte: thisMonthStart } } }),
      db.lead.count({ where: { ...leadScope, createdAt: { gte: lastMonthStart, lte: lastMonthEnd } } }),
      db.lead.count({ where: { ...leadScope, stage: "ENROLLED" } }),
      db.lead.count({ where: { ...leadScope, stage: "ENROLLED", updatedAt: { gte: lastMonthStart, lte: lastMonthEnd } } }),
      db.event.count({ where: { deletedAt: null, ...geoScope } }),
      db.event.count({ where: { deletedAt: null, createdAt: { gte: thisMonthStart }, ...geoScope } }),
      db.event.count({ where: { deletedAt: null, createdAt: { gte: lastMonthStart, lte: lastMonthEnd }, ...geoScope } }),
      db.source.count({ where: { deletedAt: null, ...geoScope } }),
      db.source.count({ where: { deletedAt: null, createdAt: { lte: lastMonthEnd }, ...geoScope } }),
      db.institution.count({ where: { deletedAt: null, ...geoScope } }),
      db.institution.count({ where: { deletedAt: null, createdAt: { lte: lastMonthEnd }, ...geoScope } }),
      db.lead.groupBy({
        by: ["stage"],
        where: leadScope,
        _count: { stage: true },
      }),
    ]);

    const stageBreakdown = byStage.reduce(
      (acc: Record<string, number>, s: { stage: string; _count: { stage: number } }) => {
        acc[s.stage] = s._count.stage;
        return acc;
      },
      {} as Record<string, number>
    );

    return NextResponse.json({
      data: {
        leads: {
          total: totalLeads,
          thisMonth: leadsThisMonth,
          lastMonth: leadsLastMonth,
          change: pct(leadsThisMonth, leadsLastMonth),
        },
        enrolled: {
          total: enrolled,
          lastMonth: enrolledLastMonth,
          change: pct(enrolled - enrolledLastMonth, enrolledLastMonth),
        },
        events: {
          total: totalEvents,
          thisMonth: eventsThisMonth,
          lastMonth: eventsLastMonth,
          change: pct(eventsThisMonth, eventsLastMonth),
        },
        sources: {
          total: totalSources,
          lastMonth: sourcesLastMonth,
          change: pct(totalSources, sourcesLastMonth),
        },
        institutions: {
          total: totalInstitutions,
          lastMonth: institutionsLastMonth,
          change: pct(totalInstitutions, institutionsLastMonth),
        },
        stageBreakdown,
      },
      meta: {
        role,
        scopedToRegion: !!scopedRegionId,
        generatedAt: now.toISOString(),
      },
    });
  } catch (error) {
    console.error("[GET /api/dashboard/stats]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── Scope helper ─────────────────────────────────────────────────────────────

interface ScopeFilter {
  assignedICRId?: string;
  regionId?: string;
}

function buildScopeWhere(
  role: Role,
  userId: string,
  regionId: string | null
): ScopeFilter {
  switch (role) {
    case "ICR":
      return { assignedICRId: userId };
    case "REGIONAL_MANAGER":
      return regionId ? { regionId } : {};
    default:
      return {};
  }
}

// ─── ERP Stats ────────────────────────────────────────────────────────────────

async function getERPStats(userId: string, now: Date) {
  const employee = await db.employee.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!employee) {
    return NextResponse.json({
      data: { erp: { employee: null } },
    });
  }

  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  const [openTasks, pendingLeaves, travelRequests, leaveBalances] =
    await Promise.all([
      db.task.count({
        where: {
          assigneeId: employee.id,
          status: { in: ["TODO", "IN_PROGRESS"] },
          deletedAt: null,
        },
      }),
      db.leaveRequest.count({
        where: { employeeId: employee.id, status: "PENDING" },
      }),
      db.travelRequest.count({
        where: {
          employeeId: employee.id,
          status: { in: ["PENDING", "APPROVED"] },
        },
      }),
      db.leaveBalance.findMany({
        where: { employeeId: employee.id, year: currentYear },
        select: { leaveType: true, totalDays: true, usedDays: true, pendingDays: true },
      }),
    ]);

  return NextResponse.json({
    data: {
      erp: {
        openTasks,
        pendingLeaves,
        travelRequests,
        leaveBalances,
        currentMonth,
        currentYear,
      },
    },
    meta: {
      role: "EMPLOYEE",
      generatedAt: now.toISOString(),
    },
  });
}
