import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { trashRecord } from "@/lib/recycle-bin";

// ─── GET /api/stakeholders/schools/:id ────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user)
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    if (!(await effectiveHasPermission(session.user.role, "stakeholders", "read")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const school = await db.school.findUnique({
      where: { id },
      include: {
        market: { select: { id: true, name: true } },
        counsellors: {
          where: { isActive: true },
          orderBy: { name: "asc" },
        },
        activities: {
          where: { deletedAt: null },
          orderBy: { date: "desc" },
          take: 20,
          select: {
            id: true,
            type: true,
            title: true,
            date: true,
            leadsGenerated: true,
            studentsEngaged: true,
          },
        },
        _count: { select: { counsellors: true, activities: true } },
      },
    });

    if (!school || school.deletedAt) {
      return NextResponse.json({ error: "School not found" }, { status: 404 });
    }

    // Compute relationship score based on activity and counsellor engagement
    const activityCount = school._count.activities;
    const counsellorCount = school._count.counsellors;
    const hasRecentVisit =
      school.lastVisitDate &&
      new Date(school.lastVisitDate) >
        new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    const computedScore = Math.min(
      100,
      activityCount * 10 + counsellorCount * 15 + (hasRecentVisit ? 20 : 0)
    );

    return NextResponse.json({
      ...school,
      computedRelationshipScore: school.relationshipScore ?? computedScore,
    });
  } catch (error) {
    console.error("[GET /api/stakeholders/schools/:id]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── PATCH /api/stakeholders/schools/:id ──────────────────────────────────

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

    const existing = await db.school.findUnique({ where: { id } });
    if (!existing || existing.deletedAt)
      return NextResponse.json({ error: "School not found" }, { status: 404 });

    const body = await req.json();
    const {
      name,
      country,
      city,
      address,
      website,
      type,
      principalName,
      principalEmail,
      phone,
      relationshipStatus,
      studentVolume,
      lastVisitDate,
      relationshipScore,
      marketId,
      notes,
    } = body;

    const updated = await db.school.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(country !== undefined && { country }),
        ...(city !== undefined && { city }),
        ...(address !== undefined && { address }),
        ...(website !== undefined && { website }),
        ...(type !== undefined && { type }),
        ...(principalName !== undefined && { principalName }),
        ...(principalEmail !== undefined && { principalEmail }),
        ...(phone !== undefined && { phone }),
        ...(relationshipStatus !== undefined && { relationshipStatus }),
        ...(studentVolume !== undefined && {
          studentVolume: studentVolume ? parseInt(studentVolume, 10) : null,
        }),
        ...(lastVisitDate !== undefined && {
          lastVisitDate: lastVisitDate ? new Date(lastVisitDate) : null,
        }),
        ...(relationshipScore !== undefined && {
          relationshipScore: relationshipScore
            ? parseInt(relationshipScore, 10)
            : null,
        }),
        ...(marketId !== undefined && { marketId: marketId || null }),
        ...(notes !== undefined && { notes }),
      },
    });

    await db.auditLog.create({
      data: {
        action: "UPDATE",
        entity: "School",
        entityId: updated.id,
        userId: session.user.id,
        changes: { before: existing, after: body },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[PATCH /api/stakeholders/schools/:id]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// ─── DELETE /api/stakeholders/schools/:id ─────────────────────────────────

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

    const existing = await db.school.findUnique({ where: { id } });
    if (!existing || existing.deletedAt)
      return NextResponse.json({ error: "School not found" }, { status: 404 });

    // Soft delete
    await trashRecord({ entityType: "School", entityId: id, userId: session.user.id });

    await db.auditLog.create({
      data: {
        action: "DELETE",
        entity: "School",
        entityId: id,
        userId: session.user.id,
        changes: { before: existing },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/stakeholders/schools/:id]", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
