import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import type { MarketRiskLevel } from "@prisma/client";

// ─── GET /api/markets/:id ─────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    const market = await db.market.findUnique({
      where: { id },
      include: {
        schools: {
          where: { deletedAt: null },
          include: {
            _count: { select: { counsellors: true } },
          },
          orderBy: { name: "asc" },
        },
        activities: {
          where: { deletedAt: null },
          include: {
            user: { select: { id: true, name: true } },
          },
          orderBy: { date: "desc" },
        },
        riskRegisters: {
          include: {
            owner: { select: { id: true, name: true } },
          },
          orderBy: { riskScore: "desc" },
        },
        _count: {
          select: { schools: true, activities: true, riskRegisters: true },
        },
      },
    });

    if (!market || market.deletedAt) {
      return NextResponse.json(
        { error: "Market not found" },
        { status: 404 }
      );
    }

    return NextResponse.json(market);
  } catch (error) {
    console.error("[GET /api/markets/:id]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── PATCH /api/markets/:id ───────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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

    const { id } = await params;

    const existing = await db.market.findUnique({ where: { id } });
    if (!existing || existing.deletedAt)
      return NextResponse.json(
        { error: "Market not found" },
        { status: 404 }
      );

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
      isActive,
    } = body;

    const updated = await db.market.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(code !== undefined && { code }),
        ...(countryCode !== undefined && { countryCode }),
        ...(studentMobilityNotes !== undefined && { studentMobilityNotes }),
        ...(competitorInstitutions !== undefined && {
          competitorInstitutions,
        }),
        ...(visaTrends !== undefined && { visaTrends }),
        ...(currencyTrends !== undefined && { currencyTrends }),
        ...(politicalRiskLevel !== undefined && {
          politicalRiskLevel: politicalRiskLevel as MarketRiskLevel,
        }),
        ...(recruitmentOpportunities !== undefined && {
          recruitmentOpportunities,
        }),
        ...(govtStakeholders !== undefined && { govtStakeholders }),
        ...(industryAssociations !== undefined && { industryAssociations }),
        ...(healthScore !== undefined && {
          healthScore: healthScore != null ? Number(healthScore) : null,
        }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    await db.auditLog.create({
      data: {
        action: "UPDATE",
        entity: "Market",
        entityId: updated.id,
        userId: session.user.id,
        changes: { before: existing, after: body },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[PATCH /api/markets/:id]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── DELETE /api/markets/:id ──────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (
      !(await effectiveHasPermission(
        session.user.role as Role,
        "markets",
        "delete"
      ))
    )
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const existing = await db.market.findUnique({ where: { id } });
    if (!existing || existing.deletedAt)
      return NextResponse.json(
        { error: "Market not found" },
        { status: 404 }
      );

    await db.market.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await db.auditLog.create({
      data: {
        action: "DELETE",
        entity: "Market",
        entityId: id,
        userId: session.user.id,
        changes: { before: existing },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/markets/:id]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
