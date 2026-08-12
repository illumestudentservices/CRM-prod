import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { institutionIdsForUser } from "@/lib/lead-access";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function quarterMonths(quarter: number): number[] {
  const start = (quarter - 1) * 3 + 1;
  return [start, start + 1, start + 2];
}

/**
 * GET /api/reports/qbr?institutionId=&year=
 *
 * List QBRs, optionally filtered by institution and year.
 */
export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Was signed-in-only, so any role could list every client's QBR while POST
    // in this same file required HQ roles.
    const role = session.user.role as Role;
    if (!(await effectiveHasPermission(role, "reports", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = req.nextUrl;
    const institutionId = searchParams.get("institutionId");
    const year = searchParams.get("year");

    const where: Record<string, unknown> = {};
    if (institutionId) where.institutionId = institutionId;
    if (year) where.year = parseInt(year);

    // reports:read alone is not enough here: INSTITUTION_CLIENT holds it, and a
    // QBR belongs to one institution. Restrict clients to their own, rather
    // than letting the permission imply access to every other client's review.
    if (role === "INSTITUTION_CLIENT") {
      const allowed = await institutionIdsForUser(session.user.id, role);
      if (allowed.length === 0) return NextResponse.json([]);
      where.institutionId = institutionId && allowed.includes(institutionId)
        ? institutionId
        : { in: allowed };
    }

    const qbrs = await db.quarterlyBusinessReview.findMany({
      where,
      orderBy: [{ year: "desc" }, { quarter: "desc" }],
      include: {
        institution: { select: { id: true, name: true, country: true } },
      },
    });

    return NextResponse.json(qbrs);
  } catch (error) {
    console.error("[qbr] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const createQBRSchema = z.object({
  institutionId: z.string().min(1),
  year: z.number().int().min(2020).max(2035),
  quarter: z.number().int().min(1).max(4),
});

/**
 * POST /api/reports/qbr
 *
 * Auto-generate a QBR for an institution + year + quarter.
 * Aggregates data from MonthlyReports, ClientKPIs, Activities, and Leads.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role } = session.user as { role: Role; id: string };

    // Only HQ-level roles can generate QBRs
    if (!["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER"].includes(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = createQBRSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });
    }

    const { institutionId, year, quarter } = parsed.data;

    // Check for existing QBR
    const existing = await db.quarterlyBusinessReview.findUnique({
      where: { institutionId_year_quarter: { institutionId, year, quarter } },
    });
    if (existing) {
      return NextResponse.json(
        { error: "A QBR for this institution, year and quarter already exists", qbrId: existing.id },
        { status: 409 }
      );
    }

    const months = quarterMonths(quarter);
    const periodStart = new Date(year, months[0] - 1, 1);
    const periodEnd = new Date(year, months[2], 0, 23, 59, 59);

    // Fetch institution
    const institution = await db.institution.findUnique({
      where: { id: institutionId },
      select: { name: true, country: true },
    });
    if (!institution) {
      return NextResponse.json({ error: "Institution not found" }, { status: 404 });
    }

    // ── Aggregate data in parallel ─────────────────────────────────────────
    const [monthlyReports, kpis, activities, leads] = await Promise.all([
      // Monthly reports for the 3 months
      db.monthlyReport.findMany({
        where: {
          institutionId,
          reportingYear: year,
          reportingMonth: { in: months },
          deletedAt: null,
        },
        select: {
          reportingMonth: true,
          status: true,
          kpiSummary: true,
          engagementNotes: true,
          challengesOpportunities: true,
          successStories: true,
          marketInsights: true,
          leadsData: true,
          eventActivities: true,
        },
      }),

      // Client KPIs for the quarter
      db.clientKPI.findMany({
        where: {
          institutionId,
          year,
          OR: [
            { quarter },
            { month: { in: months } },
          ],
        },
      }),

      // Activities in that quarter
      db.activity.findMany({
        where: {
          deletedAt: null,
          institutionId,
          date: { gte: periodStart, lte: periodEnd },
        },
        select: {
          type: true,
          title: true,
          cost: true,
          leadsGenerated: true,
          outcomes: true,
          studentsEngaged: true,
          market: { select: { id: true, name: true } },
        },
      }),

      // Leads generated in that quarter
      db.lead.findMany({
        where: {
          institutionId,
          deletedAt: null,
          createdAt: { gte: periodStart, lte: periodEnd },
        },
        select: {
          stage: true,
          interestedProgram: true,
          nationality: true,
          studyLevel: true,
          source: { select: { name: true } },
        },
      }),
    ]);

    // ── Market Performance ─────────────────────────────────────────────────
    const leadsByMarket: Record<string, number> = {};
    for (const lead of leads) {
      const market = lead.nationality || "Unknown";
      leadsByMarket[market] = (leadsByMarket[market] || 0) + 1;
    }

    const leadsByStage: Record<string, number> = {};
    for (const lead of leads) {
      leadsByStage[lead.stage] = (leadsByStage[lead.stage] || 0) + 1;
    }

    const leadsByProgram: Record<string, number> = {};
    for (const lead of leads) {
      leadsByProgram[lead.interestedProgram] = (leadsByProgram[lead.interestedProgram] || 0) + 1;
    }

    const marketPerformance = {
      totalLeads: leads.length,
      leadsByMarket,
      leadsByStage,
      leadsByProgram,
      topMarkets: Object.entries(leadsByMarket)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 5)
        .map(([market, count]) => ({ market, count })),
    };

    // ── ROI Analysis ───────────────────────────────────────────────────────
    const totalCost = activities.reduce((sum, a) => sum + (a.cost || 0), 0);
    const totalLeadsFromActivities = activities.reduce((sum, a) => sum + (a.leadsGenerated || 0), 0);
    const totalStudentsEngaged = activities.reduce((sum, a) => sum + (a.studentsEngaged || 0), 0);
    const enrolled = leads.filter((l) => l.stage === "ENROLLED").length;

    const roiAnalysis = {
      totalActivities: activities.length,
      totalCost,
      totalLeadsFromActivities,
      totalStudentsEngaged,
      enrolled,
      costPerLead: leads.length > 0 ? Math.round((totalCost / leads.length) * 100) / 100 : 0,
      costPerEnrollment: enrolled > 0 ? Math.round((totalCost / enrolled) * 100) / 100 : 0,
      activityBreakdown: Object.entries(
        activities.reduce<Record<string, { count: number; cost: number; leads: number }>>((acc, a) => {
          const type = a.type;
          if (!acc[type]) acc[type] = { count: 0, cost: 0, leads: 0 };
          acc[type].count++;
          acc[type].cost += a.cost || 0;
          acc[type].leads += a.leadsGenerated || 0;
          return acc;
        }, {})
      ).map(([type, data]) => ({ type, ...data })),
    };

    // ── KPI Summary ────────────────────────────────────────────────────────
    const kpiSummary = {
      kpis: kpis.map((k) => ({
        category: k.category,
        name: k.name,
        target: k.targetValue,
        current: k.currentValue,
        unit: k.unit,
        achievement: k.targetValue > 0
          ? Math.round((k.currentValue / k.targetValue) * 100)
          : 0,
      })),
      monthlyKPIs: monthlyReports.map((r) => ({
        month: MONTH_NAMES[r.reportingMonth],
        kpi: r.kpiSummary,
      })),
    };

    // ── Executive Summary (auto-generated) ─────────────────────────────────
    const qLabel = `Q${quarter} ${year}`;
    const conversionRate = leads.length > 0
      ? Math.round((enrolled / leads.length) * 100)
      : 0;

    const topMarketsText = marketPerformance.topMarkets
      .slice(0, 3)
      .map((m) => `${m.market} (${m.count})`)
      .join(", ");

    const challengesList = monthlyReports
      .filter((r) => r.challengesOpportunities)
      .map((r) => r.challengesOpportunities)
      .filter(Boolean);

    const successList = monthlyReports
      .filter((r) => r.successStories)
      .map((r) => r.successStories)
      .filter(Boolean);

    let executiveSummary = `Quarterly Business Review for ${institution.name} — ${qLabel}\n\n`;
    executiveSummary += `During ${qLabel}, ${institution.name} generated ${leads.length} total leads across ${activities.length} activities, `;
    executiveSummary += `achieving a ${conversionRate}% conversion rate with ${enrolled} enrollments.\n\n`;

    if (topMarketsText) {
      executiveSummary += `Top performing markets: ${topMarketsText}.\n\n`;
    }

    executiveSummary += `Total investment: $${totalCost.toLocaleString()}`;
    if (leads.length > 0) {
      executiveSummary += ` ($${roiAnalysis.costPerLead.toFixed(2)} per lead)`;
    }
    executiveSummary += `.\n`;

    if (successList.length > 0) {
      executiveSummary += `\nKey Successes:\n${successList.map((s) => `- ${s}`).join("\n")}\n`;
    }

    if (challengesList.length > 0) {
      executiveSummary += `\nChallenges:\n${challengesList.map((c) => `- ${c}`).join("\n")}\n`;
    }

    // ── Strategic Recommendations ──────────────────────────────────────────
    let strategicRecommendations = `Strategic Recommendations for ${institution.name} — ${qLabel}\n\n`;

    // Lead volume assessment
    if (leads.length === 0) {
      strategicRecommendations += `1. Lead Generation: No leads were generated this quarter. Consider increasing marketing activities and event participation.\n\n`;
    } else if (conversionRate < 10) {
      strategicRecommendations += `1. Conversion Improvement: The ${conversionRate}% conversion rate is below target. Focus on lead nurturing, follow-up cadence, and quality of initial engagement.\n\n`;
    } else {
      strategicRecommendations += `1. Maintain Momentum: The ${conversionRate}% conversion rate is performing well. Continue current engagement strategies.\n\n`;
    }

    // Market diversification
    const marketCount = Object.keys(leadsByMarket).length;
    if (marketCount <= 2) {
      strategicRecommendations += `2. Market Diversification: Leads came from only ${marketCount} market(s). Explore new geographic markets for growth.\n\n`;
    } else {
      strategicRecommendations += `2. Market Depth: ${marketCount} markets are active. Consider deepening penetration in top-performing markets.\n\n`;
    }

    // ROI efficiency
    if (totalCost > 0 && roiAnalysis.costPerLead > 500) {
      strategicRecommendations += `3. Cost Optimization: Cost per lead ($${roiAnalysis.costPerLead.toFixed(2)}) is elevated. Review activity ROI and reallocate budget to higher-performing channels.\n\n`;
    } else if (totalCost > 0) {
      strategicRecommendations += `3. Investment Strategy: Current cost efficiency is good at $${roiAnalysis.costPerLead.toFixed(2)} per lead. Consider scaling successful activity types.\n\n`;
    }

    strategicRecommendations += `4. Next Quarter Focus: Review and update KPI targets based on ${qLabel} performance. Align activities with institutional strategic objectives.\n`;

    // ── Create the QBR ─────────────────────────────────────────────────────
    const qbr = await db.quarterlyBusinessReview.create({
      data: {
        institutionId,
        year,
        quarter,
        executiveSummary,
        marketPerformance: marketPerformance as unknown as object,
        roiAnalysis: roiAnalysis as unknown as object,
        strategicRecommendations,
        kpiSummary: kpiSummary as unknown as object,
        status: "DRAFT",
      },
      include: {
        institution: { select: { id: true, name: true, country: true } },
      },
    });

    return NextResponse.json(qbr, { status: 201 });
  } catch (error) {
    console.error("[qbr] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
