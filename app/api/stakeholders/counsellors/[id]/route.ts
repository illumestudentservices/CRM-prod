import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";

// ─── PATCH /api/stakeholders/counsellors/:id ──────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!(await effectiveHasPermission(session.user.role, "stakeholders", "write")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const existing = await db.counsellor.findUnique({ where: { id } });
    if (!existing)
      return NextResponse.json(
        { error: "Counsellor not found" },
        { status: 404 }
      );

    const body = await req.json();
    const {
      name,
      email,
      phone,
      position,
      influenceScore,
      institutionAffinity,
      lastEngagementDate,
      notes,
    } = body;

    const updated = await db.counsellor.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(position !== undefined && { position }),
        ...(influenceScore !== undefined && {
          influenceScore: influenceScore
            ? parseInt(influenceScore, 10)
            : null,
        }),
        ...(institutionAffinity !== undefined && { institutionAffinity }),
        ...(lastEngagementDate !== undefined && {
          lastEngagementDate: lastEngagementDate
            ? new Date(lastEngagementDate)
            : null,
        }),
        ...(notes !== undefined && { notes }),
      },
    });

    await db.auditLog.create({
      data: {
        action: "UPDATE",
        entity: "Counsellor",
        entityId: updated.id,
        userId: session.user.id,
        changes: { before: existing, after: body },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[PATCH /api/stakeholders/counsellors/:id]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── DELETE /api/stakeholders/counsellors/:id ─────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!(await effectiveHasPermission(session.user.role, "stakeholders", "delete")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const existing = await db.counsellor.findUnique({ where: { id } });
    if (!existing)
      return NextResponse.json(
        { error: "Counsellor not found" },
        { status: 404 }
      );

    await db.counsellor.update({
      where: { id },
      data: { isActive: false },
    });

    await db.auditLog.create({
      data: {
        action: "DELETE",
        entity: "Counsellor",
        entityId: id,
        userId: session.user.id,
        changes: { before: existing },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/stakeholders/counsellors/:id]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
