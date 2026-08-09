import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { threeCountLine, pipelineByStage } from "@/lib/report-metrics";

/// Spec §8 — Quarterly Market Report is auto-populated. RM adds only
/// narrative sections. This endpoint returns a rich payload the UI stitches
/// into a document.
const schema = z.object({
  marketId: z.string().min(1),
  quarter: z.number().int().min(1).max(4),
  year: z.number().int().min(2024).max(2035),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role } = session.user;
    if (!(await effectiveHasPermission(role as Role, "market_intelligence", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }
    const { marketId, quarter, year } = parsed.data;

    const market = await db.market.findUnique({
      where: { id: marketId },
      include: { regionalManager: { select: { id: true, name: true } } },
    });
    if (!market) return NextResponse.json({ error: "Market not found" }, { status: 404 });

    const quarterStartMonth = (quarter - 1) * 3;
    const from = new Date(year, quarterStartMonth, 1);
    const to = new Date(year, quarterStartMonth + 3, 0, 23, 59, 59);

    // Scope by market — connect via institution-interest → institution → market? The
    // schema doesn't link Institution directly to Market. We use the lead's
    // country against the market's countryCode as a best-effort.
    const [threeCount, byStage, events, activities, schools] = await Promise.all([
      threeCountLine({ from, to }),
      pipelineByStage({ from, to }),
      db.event.count({ where: { deletedAt: null, date: { gte: from, lte: to }, country: market.countryCode ?? undefined } }),
      db.activity.count({ where: { deletedAt: null, date: { gte: from, lte: to }, country: market.countryCode ?? undefined } }),
      db.school.count({ where: { deletedAt: null, marketId } }),
    ]);

    return NextResponse.json({
      market,
      quarter, year,
      window: { from, to },
      recruitment: threeCount,
      pipelineByStage: byStage,
      events, activities, schools,
      intelligence: {
        overview: market.overview,
        recruitmentOpportunities: market.recruitmentOpportunities,
        visaTrends: market.visaTrends,
        currencyTrends: market.currencyTrends,
        competitorInstitutions: market.competitorInstitutions,
        strategicRecommendations: market.strategicRecommendations,
      },
    });
  } catch (err) {
    console.error("[POST market-intelligence/quarterly-report]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
