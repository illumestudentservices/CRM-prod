import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { type KPICategory, type KPIPeriod } from "@prisma/client";

// ─── GET /api/institutions/:id/kpis ───────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "institutions", "read")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const institution = await db.institution.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!institution || institution.deletedAt) {
      return NextResponse.json({ error: "Institution not found" }, { status: 404 });
    }

    const { searchParams } = new URL(req.url);
    const yearParam = searchParams.get("year");

    const kpis = await db.clientKPI.findMany({
      where: {
        institutionId: id,
        ...(yearParam ? { year: parseInt(yearParam, 10) } : {}),
      },
      orderBy: [{ year: "desc" }, { category: "asc" }, { name: "asc" }],
    });

    return NextResponse.json(kpis);
  } catch (error) {
    console.error("[GET /api/institutions/:id/kpis]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/institutions/:id/kpis ──────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "institutions", "write")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const institution = await db.institution.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!institution || institution.deletedAt) {
      return NextResponse.json({ error: "Institution not found" }, { status: 404 });
    }

    const body = await req.json();
    const { category, name, description, targetValue, unit, period, year, month, quarter } = body;

    if (!category || !name || targetValue === undefined || !unit || !period || !year) {
      return NextResponse.json(
        { error: "category, name, targetValue, unit, period, and year are required" },
        { status: 400 }
      );
    }

    const kpi = await db.clientKPI.create({
      data: {
        institutionId: id,
        category: category as KPICategory,
        name,
        description: description || null,
        targetValue: Number(targetValue),
        unit,
        period: period as KPIPeriod,
        year: parseInt(year, 10),
        month: month !== undefined && month !== null ? parseInt(month, 10) : null,
        quarter: quarter !== undefined && quarter !== null ? parseInt(quarter, 10) : null,
      },
    });

    await db.auditLog.create({
      data: {
        action: "CREATE",
        entity: "ClientKPI",
        entityId: kpi.id,
        userId: session.user.id,
        changes: { after: body },
      },
    });

    return NextResponse.json(kpi, { status: 201 });
  } catch (error) {
    console.error("[POST /api/institutions/:id/kpis]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
