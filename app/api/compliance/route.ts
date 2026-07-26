import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import type { ComplianceType } from "@prisma/client";

// ─── GET /api/compliance ─────────────────────────────────────────────────

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
    const complianceType = searchParams.get("complianceType");
    const status = searchParams.get("status");
    const institutionId = searchParams.get("institutionId");

    const items = await db.complianceItem.findMany({
      where: {
        ...(complianceType
          ? { complianceType: complianceType as ComplianceType }
          : {}),
        ...(status ? { status } : {}),
        ...(institutionId ? { institutionId } : {}),
      },
      include: {
        assignedTo: { select: { id: true, name: true } },
        institution: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(items);
  } catch (error) {
    console.error("[GET /api/compliance]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── POST /api/compliance ────────────────────────────────────────────────

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
      complianceType,
      title,
      description,
      status,
      dueDate,
      assignedToId,
      institutionId,
    } = body;

    if (!title) {
      return NextResponse.json(
        { error: "Title is required" },
        { status: 400 }
      );
    }

    const item = await db.complianceItem.create({
      data: {
        complianceType: (complianceType as ComplianceType) ?? "OTHER",
        title,
        description: description || null,
        status: status ?? "PENDING",
        dueDate: dueDate ? new Date(dueDate) : null,
        assignedToId: assignedToId || null,
        institutionId: institutionId || null,
      },
      include: {
        assignedTo: { select: { id: true, name: true } },
        institution: { select: { id: true, name: true } },
      },
    });

    await db.auditLog.create({
      data: {
        action: "CREATE",
        entity: "ComplianceItem",
        entityId: item.id,
        userId: session.user.id,
        changes: body,
      },
    });

    return NextResponse.json(item, { status: 201 });
  } catch (error) {
    console.error("[POST /api/compliance]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
