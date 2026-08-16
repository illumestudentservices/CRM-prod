import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { threeCountLine, pipelineByStage, marketCountryValues } from "@/lib/report-metrics";

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

    // Scope by market. There is no Market→Lead relation, so country is the only
    // linkage available — but the two sides are stored differently:
    // markets.countryCode is ISO alpha-2 ("IN") while leads.countryOfResidence,
    // activities.country and events.country hold names ("India").
    //
    // This route previously did two separate wrong things. The recruitment and
    // pipeline figures were fetched with NO market filter at all and returned
    // as that market's numbers, so leadership was reading business-wide totals
    // under one country's heading. And the event and activity counts compared
    // a name to a code, which never matches, so both were permanently zero.
    const countries = await marketCountryValues(marketId);

    // Fail closed. A market with no resolvable country cannot be reported on,
    // and returning unscoped totals is precisely the bug being fixed here — a
    // wrong number presented confidently is worse than an absent one.
    if (!countries) {
      return NextResponse.json(
        {
          error:
            "This market has no country set, so its figures cannot be separated from the rest of the business. Set the market's country first.",
          marketId,
          marketName: market.name,
        },
        { status: 409 }
      );
    }

    const [threeCount, byStage, events, activities, schools] = await Promise.all([
      threeCountLine({ from, to, countryIn: countries.leads }),
      pipelineByStage({ from, to, countryIn: countries.leads }),
      db.event.count({ where: { deletedAt: null, date: { gte: from, lte: to }, country: { in: countries.events } } }),
      db.activity.count({ where: { deletedAt: null, date: { gte: from, lte: to }, country: { in: countries.activities } } }),
      db.school.count({ where: { deletedAt: null, marketId } }),
    ]);

    return NextResponse.json({
      market,
      quarter, year,
      window: { from, to },
      recruitment: threeCount,
      pipelineByStage: byStage,
      events, activities, schools,
      // Stated so a reader can see WHICH stored country values these figures
      // cover, rather than trusting that the market matched what they expect.
      scopedBy: {
        countryCode: countries.code,
        leadCountries: countries.leads,
        activityCountries: countries.activities,
        eventCountries: countries.events,
      },
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
