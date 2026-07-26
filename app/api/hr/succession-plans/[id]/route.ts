import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";

// ─── PATCH /api/hr/succession-plans/[id] ──────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await effectiveHasPermission(session.user.role, "erp_hr", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await db.successionPlan.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Succession plan not found" }, { status: 404 });
    }

    const body = await req.json();
    const { backupPersonnel, crossTraining, emergencyCoverage, readinessLevel, notes } = body;

    const data: Record<string, unknown> = {};
    if (backupPersonnel !== undefined) data.backupPersonnel = backupPersonnel;
    if (crossTraining !== undefined) data.crossTraining = crossTraining;
    if (emergencyCoverage !== undefined) data.emergencyCoverage = emergencyCoverage;
    if (readinessLevel !== undefined) data.readinessLevel = readinessLevel;
    if (notes !== undefined) data.notes = notes;

    const plan = await db.successionPlan.update({
      where: { id },
      data,
      include: {
        employee: {
          include: { user: { select: { id: true, name: true } } },
        },
      },
    });

    return NextResponse.json({ plan });
  } catch (error) {
    console.error("[PATCH /api/hr/succession-plans/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── DELETE /api/hr/succession-plans/[id] ─────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await effectiveHasPermission(session.user.role, "erp_hr", "delete"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await db.successionPlan.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Succession plan not found" }, { status: 404 });
    }

    await db.successionPlan.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/hr/succession-plans/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
