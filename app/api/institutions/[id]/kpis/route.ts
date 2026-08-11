import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import {
  type KPICategory, type KPIPeriod,
  KPICategory as KPICategoryEnum, KPIPeriod as KPIPeriodEnum,
} from "@prisma/client";
import {
  readJsonBody, handleApiError, assertEnum, assertString, assertNumber,
} from "@/lib/api-validation";

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
    return handleApiError(error, "[GET /api/institutions/:id/kpis]");
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

    const body = await readJsonBody(req);
    const { category, name, description, targetValue, currentValue, unit, period, year, month, quarter } = body;

    if (!category || !name || targetValue === undefined || !unit || !period || !year) {
      return NextResponse.json(
        { error: "category, name, targetValue, unit, period, and year are required" },
        { status: 400 }
      );
    }

    // Enum + numeric guards run before Prisma, which otherwise answers 500 on
    // an unknown category/period or a non-numeric target.
    assertEnum(category, KPICategoryEnum, "category");
    assertEnum(period, KPIPeriodEnum, "period");
    assertString(name, "name", { max: 300 });
    assertNumber(targetValue, "targetValue");
    assertNumber(currentValue, "currentValue", { required: false });
    assertNumber(year, "year", { min: 2000, max: 2100, integer: true });
    assertNumber(month, "month", { required: false, min: 1, max: 12, integer: true });
    assertNumber(quarter, "quarter", { required: false, min: 1, max: 4, integer: true });

    const kpi = await db.clientKPI.create({
      data: {
        institutionId: id,
        category: category as KPICategory,
        name,
        description: description || null,
        targetValue: Number(targetValue),
        // The KPI dialog collects a starting value ("we're at 40 of 100
        // already"), and PATCH has always honoured it — but create dropped it
        // on the floor, so every new KPI began at 0 and had to be edited
        // immediately to show its real position.
        ...(currentValue !== undefined && currentValue !== null
          ? { currentValue: Number(currentValue) }
          : {}),
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
    return handleApiError(error, "[POST /api/institutions/:id/kpis]");
  }
}
