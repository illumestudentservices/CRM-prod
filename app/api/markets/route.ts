import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import type { MarketRiskLevel } from "@prisma/client";

// ─── GET /api/markets ─────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (
      !(await effectiveHasPermission(
        session.user.role as Role,
        "markets",
        "read"
      ))
    )
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search");

    const markets = await db.market.findMany({
      where: {
        deletedAt: null,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: "insensitive" } },
                { code: { contains: search, mode: "insensitive" } },
                {
                  countryCode: { contains: search, mode: "insensitive" },
                },
              ],
            }
          : {}),
      },
      include: {
        _count: {
          select: { schools: true, activities: true, riskRegisters: true },
        },
      },
      orderBy: { name: "asc" },
    });

    return NextResponse.json(markets);
  } catch (error) {
    console.error("[GET /api/markets]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── POST /api/markets ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (
      !(await effectiveHasPermission(
        session.user.role as Role,
        "markets",
        "write"
      ))
    )
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const body = await req.json();
    const {
      name,
      code,
      countryCode,
      studentMobilityNotes,
      competitorInstitutions,
      visaTrends,
      currencyTrends,
      politicalRiskLevel,
      recruitmentOpportunities,
      govtStakeholders,
      industryAssociations,
      healthScore,
    } = body;

    if (!name || !code) {
      return NextResponse.json(
        { error: "Name and code are required" },
        { status: 400 }
      );
    }

    const market = await db.market.create({
      data: {
        name,
        code,
        countryCode: countryCode || null,
        studentMobilityNotes: studentMobilityNotes || null,
        competitorInstitutions: competitorInstitutions || null,
        visaTrends: visaTrends || null,
        currencyTrends: currencyTrends || null,
        politicalRiskLevel:
          (politicalRiskLevel as MarketRiskLevel) ?? "LOW",
        recruitmentOpportunities: recruitmentOpportunities || null,
        govtStakeholders: govtStakeholders || null,
        industryAssociations: industryAssociations || null,
        healthScore: healthScore != null ? Number(healthScore) : null,
        createdById: session.user.id,
      },
    });

    await db.auditLog.create({
      data: {
        action: "CREATE",
        entity: "Market",
        entityId: market.id,
        userId: session.user.id,
        changes: body,
      },
    });

    return NextResponse.json(market, { status: 201 });
  } catch (error) {
    console.error("[POST /api/markets]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
