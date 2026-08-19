import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { regionScope } from "@/lib/region-scope";

/**
 * Parses a range boundary, treating a date-only value as the whole of that day.
 *
 * `new Date("2026-08-12")` is midnight UTC, so `lte` against it excluded
 * everything recorded during 12 August — every lead added today was missing from
 * the KPIs, the monthly chart and top markets, while the stage breakdown (which
 * has no date filter) still counted it, making the screen look self-contradictory.
 * Both dashboards send a bare `YYYY-MM-DD`.
 *
 * app/api/activity-log/route.ts already did this correctly; analytics did not.
 * An unparseable value falls back rather than passing `Invalid Date` to Prisma.
 */
function parseBoundary(param: string | null, fallback: Date, endOfDay: boolean): Date {
  if (!param) return fallback;
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(param)
    ? `${param}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z`
    : param;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

function buildScopeFilter(role: Role, userId: string, regionId: string | null) {
  switch (role) {
    case "ICR":
      return { assignedICRId: userId };
    case "REGIONAL_MANAGER":
      // A manager with no region gets no rows, not every row. This used to fall
      // back to `{}`, which served a regionless manager analytics numerically
      // identical to a SUPER_ADMIN's. See lib/region-scope.ts.
      return regionScope(regionId);
    default:
      return {};
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId, regionId: userRegionId } = session.user as {
      role: Role;
      id: string;
      regionId: string | null;
    };

    if (!await effectiveHasPermission(role, "analytics", "read")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = req.nextUrl;
    const startDateParam = searchParams.get("startDate");
    const endDateParam = searchParams.get("endDate");
    const regionIdParam = searchParams.get("regionId");
    const institutionIdParam = searchParams.get("institutionId");

    const now = new Date();
    const ytdStart = new Date(now.getFullYear(), 0, 1);
    const lastYearStart = new Date(now.getFullYear() - 1, 0, 1);
    const lastYearEnd = new Date(now.getFullYear() - 1, 11, 31, 23, 59, 59);

    const startDate = parseBoundary(startDateParam, ytdStart, false);
    const endDate = parseBoundary(endDateParam, now, true);

    const baseScope = buildScopeFilter(role, userId, userRegionId);

    // Override regionId if param provided (for HQ roles)
    if (regionIdParam && (role === "SUPER_ADMIN" || role === "HQ_EXECUTIVE" || role === "HQ_ANALYTICS")) {
      (baseScope as Record<string, unknown>).regionId = regionIdParam;
    }
    if (institutionIdParam) {
      (baseScope as Record<string, unknown>).institutionId = institutionIdParam;
    }

    const dateFilter = { createdAt: { gte: startDate, lte: endDate } };
    const lastYearDateFilter = { createdAt: { gte: lastYearStart, lte: lastYearEnd } };

    // ── Local types for Prisma results ─────────────────────────────────────
    type LeadMonthly = { createdAt: Date; stage: string };
    type StageCount = { stage: string; _count: { stage: number } };
    type MarketCount = { countryOfResidence: string; _count: { countryOfResidence: number } };
    type SourceCount = { sourceId: string | null; _count: { sourceId: number } };
    type EnrollTarget = { institutionId: string; target: number; actual: number; institution: { id: string; name: string } };

    // ── Parallel queries ────────────────────────────────────────────────────
    const results = await Promise.all([
      // Total leads YTD
      db.lead.count({ where: { ...baseScope, ...dateFilter, deletedAt: null } }),
      // Total leads last year
      db.lead.count({ where: { ...baseScope, ...lastYearDateFilter, deletedAt: null } }),
      // All leads YTD for monthly breakdown
      db.lead.findMany({ where: { ...baseScope, ...dateFilter, deletedAt: null }, select: { createdAt: true, stage: true } }),
      // All leads last year for monthly breakdown
      db.lead.findMany({ where: { ...baseScope, ...lastYearDateFilter, deletedAt: null }, select: { createdAt: true, stage: true } }),
      // Stage breakdown
      db.lead.groupBy({ by: ["stage"], where: { ...baseScope, deletedAt: null }, _count: { stage: true } }),
      // Top markets (by countryOfResidence)
      db.lead.groupBy({ by: ["countryOfResidence"], where: { ...baseScope, ...dateFilter, deletedAt: null }, _count: { countryOfResidence: true }, orderBy: { _count: { countryOfResidence: "desc" } }, take: 10 }),
      // Top sources
      db.lead.groupBy({ by: ["sourceId"], where: { ...baseScope, ...dateFilter, deletedAt: null, sourceId: { not: null } }, _count: { sourceId: true }, orderBy: { _count: { sourceId: "desc" } }, take: 5 }),
      // Institution enrollment targets for current year
      db.enrollmentTarget.findMany({ where: { year: now.getFullYear() }, include: { institution: { select: { id: true, name: true } } }, orderBy: { target: "desc" }, take: 15 }),
    ]);

    const totalLeadsYTD = results[0] as number;
    const totalLeadsLastYear = results[1] as number;
    const allLeadsYTD = results[2] as LeadMonthly[];
    const allLeadsLastYear = results[3] as LeadMonthly[];
    const stageBreakdown = results[4] as StageCount[];
    const topMarketGroups = results[5] as MarketCount[];
    const topSourceGroups = results[6] as SourceCount[];
    const institutionTargets = results[7] as EnrollTarget[];

    // ── Monthly breakdown ───────────────────────────────────────────────────
    const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    const leadsByMonthCurrent = Array(12).fill(0);
    const leadsByMonthLastYear = Array(12).fill(0);
    const enrollmentsByMonthCurrent = Array(12).fill(0);

    for (const lead of allLeadsYTD) {
      const month = lead.createdAt.getMonth();
      leadsByMonthCurrent[month]++;
      if (lead.stage === "ENROLLED") {
        enrollmentsByMonthCurrent[month]++;
      }
    }
    for (const lead of allLeadsLastYear) {
      const month = lead.createdAt.getMonth();
      leadsByMonthLastYear[month]++;
    }

    const leadsByMonth = monthNames.map((name, i) => ({
      month: name,
      current: leadsByMonthCurrent[i],
      lastYear: leadsByMonthLastYear[i],
    }));

    // ── Enrollments YTD ────────────────────────────────────────────────────
    const enrollmentsYTD = allLeadsYTD.filter((l) => l.stage === "ENROLLED").length;

    // ── Stage breakdown formatted ──────────────────────────────────────────
    const stageMap: Record<string, number> = {};
    for (const s of stageBreakdown) {
      stageMap[s.stage] = s._count.stage;
    }

    // ── Top markets formatted ──────────────────────────────────────────────
    const enrolledByCountry = await db.lead.groupBy({
      by: ["countryOfResidence"],
      where: { ...baseScope, ...dateFilter, deletedAt: null, stage: "ENROLLED" },
      _count: { countryOfResidence: true },
    });
    const enrolledCountryMap: Record<string, number> = {};
    for (const e of enrolledByCountry) {
      enrolledCountryMap[e.countryOfResidence] = e._count.countryOfResidence;
    }

    const topMarkets = topMarketGroups.map((g) => {
      const total = g._count.countryOfResidence;
      const enrolled = enrolledCountryMap[g.countryOfResidence] ?? 0;
      return {
        country: g.countryOfResidence,
        leads: total,
        enrolled,
        conversionRate: total > 0 ? Math.round((enrolled / total) * 100) : 0,
      };
    });

    // ── Top sources formatted ──────────────────────────────────────────────
    const sourceIds = topSourceGroups.map((g) => g.sourceId).filter(Boolean) as string[];
    const sources = await db.recruitmentPartner.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true, name: true },
    });
    const sourceNameMap: Record<string, string> = {};
    for (const s of sources) {
      sourceNameMap[s.id] = s.name;
    }

    const enrolledBySource = await db.lead.groupBy({
      by: ["sourceId"],
      where: { ...baseScope, ...dateFilter, deletedAt: null, stage: "ENROLLED", sourceId: { in: sourceIds } },
      _count: { sourceId: true },
    });
    const enrolledSourceMap: Record<string, number> = {};
    for (const e of enrolledBySource) {
      if (e.sourceId) enrolledSourceMap[e.sourceId] = e._count.sourceId;
    }

    const topSources = topSourceGroups.map((g) => {
      const total = g._count.sourceId;
      const enrolled = g.sourceId ? (enrolledSourceMap[g.sourceId] ?? 0) : 0;
      return {
        sourceId: g.sourceId,
        name: g.sourceId ? (sourceNameMap[g.sourceId] ?? "Unknown") : "Unknown",
        leads: total,
        enrolled,
        conversionRate: total > 0 ? Math.round((enrolled / total) * 100) : 0,
      };
    });

    // ── Institution targets ────────────────────────────────────────────────
    const institutionTargetsFormatted = institutionTargets.map((t) => ({
      institutionId: t.institutionId,
      name: t.institution.name,
      target: t.target,
      actual: t.actual,
      attainment: t.target > 0 ? Math.round((t.actual / t.target) * 100) : 0,
    }));

    // ── Active partners (sources) ──────────────────────────────────────────
    const activePartners = await db.recruitmentPartner.count({
      where: {
        isActive: true,
        deletedAt: null,
        ...(role === "REGIONAL_MANAGER" && userRegionId ? { regionId: userRegionId } : {}),
        ...(role === "ICR" ? { leads: { some: { assignedICRId: userId } } } : {}),
      },
    });

    // ── Events this year ───────────────────────────────────────────────────
    const eventsThisYear = await db.event.count({
      where: {
        deletedAt: null,
        date: { gte: ytdStart, lte: now },
        ...(role === "REGIONAL_MANAGER" && userRegionId ? { regionId: userRegionId } : {}),
        ...(role === "ICR" ? { assignedICRId: userId } : {}),
      },
    });

    return NextResponse.json({
      totalLeadsYTD,
      totalLeadsLastYear,
      enrollmentsYTD,
      activePartners,
      eventsThisYear,
      leadsByMonth,
      stageBreakdown: stageMap,
      topMarkets,
      topSources,
      institutionTargets: institutionTargetsFormatted,
    });
  } catch (error) {
    console.error("[analytics/overview] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
