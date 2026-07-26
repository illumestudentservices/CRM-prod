import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";

// ─── PATCH /api/institutions/:id/deliverables/:deliverableId ──────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; deliverableId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "institutions", "write")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id, deliverableId } = await params;

    const existing = await db.deliverable.findFirst({
      where: { id: deliverableId, institutionId: id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Deliverable not found" }, { status: 404 });
    }

    const body = await req.json();
    const { title, description, dueDate, completedAt, status } = body;

    const updated = await db.deliverable.update({
      where: { id: deliverableId },
      data: {
        ...(title !== undefined && { title }),
        ...(description !== undefined && { description }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(completedAt !== undefined && { completedAt: completedAt ? new Date(completedAt) : null }),
        ...(status !== undefined && { status }),
      },
    });

    await db.auditLog.create({
      data: {
        action: "UPDATE",
        entity: "Deliverable",
        entityId: deliverableId,
        userId: session.user.id,
        changes: { before: existing, after: body },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[PATCH /api/institutions/:id/deliverables/:deliverableId]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── DELETE /api/institutions/:id/deliverables/:deliverableId ─────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; deliverableId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "institutions", "delete")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id, deliverableId } = await params;

    const existing = await db.deliverable.findFirst({
      where: { id: deliverableId, institutionId: id },
    });
    if (!existing) {
      return NextResponse.json({ error: "Deliverable not found" }, { status: 404 });
    }

    await db.deliverable.delete({ where: { id: deliverableId } });

    await db.auditLog.create({
      data: {
        action: "DELETE",
        entity: "Deliverable",
        entityId: deliverableId,
        userId: session.user.id,
        changes: { before: existing },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/institutions/:id/deliverables/:deliverableId]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
