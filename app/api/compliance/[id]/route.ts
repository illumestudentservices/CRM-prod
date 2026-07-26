import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import type { ComplianceType } from "@prisma/client";

// ─── PATCH /api/compliance/:id ───────────────────────────────────────────

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

    const existing = await db.complianceItem.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Compliance item not found" },
        { status: 404 }
      );
    }

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

    // Set completedAt when status changes to COMPLETED
    let completedAt = existing.completedAt;
    if (status === "COMPLETED" && existing.status !== "COMPLETED") {
      completedAt = new Date();
    } else if (status !== undefined && status !== "COMPLETED") {
      completedAt = null;
    }

    const updated = await db.complianceItem.update({
      where: { id },
      data: {
        ...(complianceType !== undefined && {
          complianceType: complianceType as ComplianceType,
        }),
        ...(title !== undefined && { title }),
        ...(description !== undefined && {
          description: description || null,
        }),
        ...(status !== undefined && { status }),
        ...(dueDate !== undefined && {
          dueDate: dueDate ? new Date(dueDate) : null,
        }),
        ...(assignedToId !== undefined && {
          assignedToId: assignedToId || null,
        }),
        ...(institutionId !== undefined && {
          institutionId: institutionId || null,
        }),
        completedAt,
      },
      include: {
        assignedTo: { select: { id: true, name: true } },
        institution: { select: { id: true, name: true } },
      },
    });

    await db.auditLog.create({
      data: {
        action: "UPDATE",
        entity: "ComplianceItem",
        entityId: id,
        userId: session.user.id,
        changes: body,
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[PATCH /api/compliance/:id]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── DELETE /api/compliance/:id ──────────────────────────────────────────

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

    const existing = await db.complianceItem.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json(
        { error: "Compliance item not found" },
        { status: 404 }
      );
    }

    await db.complianceItem.delete({ where: { id } });

    await db.auditLog.create({
      data: {
        action: "DELETE",
        entity: "ComplianceItem",
        entityId: id,
        userId: session.user.id,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/compliance/:id]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
