import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import type { RiskStatus, RiskType } from "@prisma/client";

// ─── GET /api/risks/:id ──────────────────────────────────────────────────

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
        "risk_compliance",
        "read"
      ))
    )
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const risk = await db.riskRegister.findUnique({
      where: { id },
      include: {
        owner: { select: { id: true, name: true, email: true } },
        institution: { select: { id: true, name: true } },
        market: { select: { id: true, name: true } },
      },
    });

    if (!risk) {
      return NextResponse.json({ error: "Risk not found" }, { status: 404 });
    }

    return NextResponse.json(risk);
  } catch (error) {
    console.error("[GET /api/risks/:id]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── PATCH /api/risks/:id ────────────────────────────────────────────────

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
        "risk_compliance",
        "write"
      ))
    )
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const existing = await db.riskRegister.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Risk not found" }, { status: 404 });
    }

    const body = await req.json();
    const {
      type,
      title,
      description,
      likelihood,
      impact,
      mitigationPlan,
      status,
      institutionId,
      marketId,
    } = body;

    // Recalculate risk score if likelihood or impact changes
    const newLikelihood =
      likelihood !== undefined ? Number(likelihood) : existing.likelihood;
    const newImpact =
      impact !== undefined ? Number(impact) : existing.impact;
    const riskScore = newLikelihood * newImpact;

    const updated = await db.riskRegister.update({
      where: { id },
      data: {
        ...(type !== undefined && { type: type as RiskType }),
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description: description || null }),
        ...(likelihood !== undefined && { likelihood: newLikelihood }),
        ...(impact !== undefined && { impact: newImpact }),
        riskScore,
        ...(mitigationPlan !== undefined && {
          mitigationPlan: mitigationPlan || null,
        }),
        ...(status !== undefined && { status: status as RiskStatus }),
        ...(institutionId !== undefined && {
          institutionId: institutionId || null,
        }),
        ...(marketId !== undefined && { marketId: marketId || null }),
      },
      include: {
        owner: { select: { id: true, name: true } },
        institution: { select: { id: true, name: true } },
        market: { select: { id: true, name: true } },
      },
    });

    await db.auditLog.create({
      data: {
        action: "UPDATE",
        entity: "RiskRegister",
        entityId: id,
        userId: session.user.id,
        changes: body,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[PATCH /api/risks/:id]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── DELETE /api/risks/:id ───────────────────────────────────────────────

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
        "risk_compliance",
        "delete"
      ))
    )
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const existing = await db.riskRegister.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Risk not found" }, { status: 404 });
    }

    await db.riskRegister.delete({ where: { id } });

    await db.auditLog.create({
      data: {
        action: "DELETE",
        entity: "RiskRegister",
        entityId: id,
        userId: session.user.id,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/risks/:id]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
