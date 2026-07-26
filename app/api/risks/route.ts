import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import type { RiskStatus, RiskType } from "@prisma/client";

// ─── GET /api/risks ──────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
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

    const { searchParams } = new URL(req.url);
    const status = searchParams.get("status");
    const type = searchParams.get("type");
    const institutionId = searchParams.get("institutionId");

    const risks = await db.riskRegister.findMany({
      where: {
        ...(status ? { status: status as RiskStatus } : {}),
        ...(type ? { type: type as RiskType } : {}),
        ...(institutionId ? { institutionId } : {}),
      },
      include: {
        owner: { select: { id: true, name: true } },
        institution: { select: { id: true, name: true } },
        market: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(risks);
  } catch (error) {
    console.error("[GET /api/risks]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── POST /api/risks ─────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
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

    if (!type || !title || !likelihood || !impact) {
      return NextResponse.json(
        { error: "Type, title, likelihood, and impact are required" },
        { status: 400 }
      );
    }

    if (likelihood < 1 || likelihood > 5 || impact < 1 || impact > 5) {
      return NextResponse.json(
        { error: "Likelihood and impact must be between 1 and 5" },
        { status: 400 }
      );
    }

    const riskScore = likelihood * impact;

    const risk = await db.riskRegister.create({
      data: {
        type: type as RiskType,
        title,
        description: description || null,
        likelihood: Number(likelihood),
        impact: Number(impact),
        riskScore,
        mitigationPlan: mitigationPlan || null,
        status: (status as RiskStatus) ?? "OPEN",
        ownerId: session.user.id,
        institutionId: institutionId || null,
        marketId: marketId || null,
      },
      include: {
        owner: { select: { id: true, name: true } },
        institution: { select: { id: true, name: true } },
        market: { select: { id: true, name: true } },
      },
    });

    await db.auditLog.create({
      data: {
        action: "CREATE",
        entity: "RiskRegister",
        entityId: risk.id,
        userId: session.user.id,
        changes: body,
      },
    });

    return NextResponse.json(risk, { status: 201 });
  } catch (error) {
    console.error("[POST /api/risks]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
