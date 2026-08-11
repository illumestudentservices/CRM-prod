import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import type { MarketRiskLevel } from "@prisma/client";
import { readJsonBody, handleApiError } from "@/lib/api-validation";

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
    return handleApiError(error, "[GET /api/markets]");
  }
}

// ─── POST /api/markets ────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // Spec §1 (Market Intelligence): "Only System Administrators can create
    // new markets." The permission matrix opens `markets:write` to RM/ICR
    // for the rest of the module (editing intelligence, submitting
    // suggestions); creation is deliberately narrower.
    if (session.user.role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Only System Administrators may create markets." },
        { status: 403 }
      );
    }

    const body = await readJsonBody(req);
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

    // Spec §1: "One Market = One Country." Enforce uniqueness on countryCode
    // (when provided) so a second India/Vietnam/Brazil can't be created.
    if (countryCode) {
      const existing = await db.market.findFirst({
        where: { countryCode, deletedAt: null },
        select: { id: true, name: true },
      });
      if (existing) {
        return NextResponse.json(
          {
            error: `A market for country ${countryCode} already exists ("${existing.name}").`,
            existing,
          },
          { status: 409 }
        );
      }
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
    return handleApiError(error, "[POST /api/markets]");
  }
}
