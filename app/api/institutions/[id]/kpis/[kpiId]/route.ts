import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { type KPICategory, type KPIPeriod } from "@prisma/client";

// ─── PATCH /api/institutions/:id/kpis/:kpiId ─────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; kpiId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "institutions", "write")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id, kpiId } = await params;

    const existing = await db.clientKPI.findFirst({
      where: { id: kpiId, institutionId: id },
    });
    if (!existing) {
      return NextResponse.json({ error: "KPI not found" }, { status: 404 });
    }

    const body = await req.json();
    const { category, name, description, targetValue, currentValue, unit, period, year, month, quarter } = body;

    const updated = await db.clientKPI.update({
      where: { id: kpiId },
      data: {
        ...(category !== undefined && { category: category as KPICategory }),
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description }),
        ...(targetValue !== undefined && { targetValue: Number(targetValue) }),
        ...(currentValue !== undefined && { currentValue: Number(currentValue) }),
        ...(unit !== undefined && { unit }),
        ...(period !== undefined && { period: period as KPIPeriod }),
        ...(year !== undefined && { year: parseInt(year, 10) }),
        ...(month !== undefined && { month: month !== null ? parseInt(month, 10) : null }),
        ...(quarter !== undefined && { quarter: quarter !== null ? parseInt(quarter, 10) : null }),
      },
    });

    await db.auditLog.create({
      data: {
        action: "UPDATE",
        entity: "ClientKPI",
        entityId: kpiId,
        userId: session.user.id,
        changes: { before: existing, after: body },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[PATCH /api/institutions/:id/kpis/:kpiId]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── DELETE /api/institutions/:id/kpis/:kpiId ─────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; kpiId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "institutions", "delete")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id, kpiId } = await params;

    const existing = await db.clientKPI.findFirst({
      where: { id: kpiId, institutionId: id },
    });
    if (!existing) {
      return NextResponse.json({ error: "KPI not found" }, { status: 404 });
    }

    await db.clientKPI.delete({ where: { id: kpiId } });

    await db.auditLog.create({
      data: {
        action: "DELETE",
        entity: "ClientKPI",
        entityId: kpiId,
        userId: session.user.id,
        changes: { before: existing },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/institutions/:id/kpis/:kpiId]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
