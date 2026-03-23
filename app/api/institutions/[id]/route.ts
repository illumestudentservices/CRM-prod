import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { type AccountStatus } from "@prisma/client";

// ─── GET /api/institutions/:id ─────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const institution = await db.institution.findUnique({
      where: { id },
      include: {
        region: { select: { id: true, name: true } },
        contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
        contracts: { orderBy: { startDate: "desc" } },
        engagementLogs: {
          include: { user: { select: { id: true, name: true, image: true } } },
          orderBy: { date: "desc" },
        },
        deliverables: { orderBy: { createdAt: "desc" } },
        documents: { orderBy: { uploadedAt: "desc" } },
        leads: {
          where: { deletedAt: null },
          include: {
            assignedICR: { select: { id: true, name: true } },
            source: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 100,
        },
        enrollmentTargets: { orderBy: { year: "asc" } },
        users: { include: { user: { select: { id: true, name: true, image: true } } } },
        _count: {
          select: { leads: true, contacts: true, contracts: true, engagementLogs: true },
        },
      },
    });

    if (!institution || institution.deletedAt) {
      return NextResponse.json({ error: "Institution not found" }, { status: 404 });
    }

    return NextResponse.json(institution);
  } catch (error) {
    console.error("[GET /api/institutions/:id]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── PATCH /api/institutions/:id ───────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const existing = await db.institution.findUnique({
      where: { id },
    });
    if (!existing || existing.deletedAt) return NextResponse.json({ error: "Institution not found" }, { status: 404 });

    const body = await req.json();
    const { name, country, type, website, primaryContact, accountStatus, regionId, notes } =
      body;

    const updated = await db.institution.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(country !== undefined && { country }),
        ...(type !== undefined && { type }),
        ...(website !== undefined && { website }),
        ...(primaryContact !== undefined && { primaryContact }),
        ...(accountStatus !== undefined && {
          accountStatus: accountStatus as AccountStatus,
        }),
        ...(regionId !== undefined && { regionId: regionId || null }),
        ...(notes !== undefined && { notes }),
      },
    });

    await db.auditLog.create({
      data: {
        action: "UPDATE",
        entity: "Institution",
        entityId: updated.id,
        userId: session.user.id,
        changes: { before: existing, after: body },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[PATCH /api/institutions/:id]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── DELETE /api/institutions/:id ──────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { id } = await params;

    const existing = await db.institution.findUnique({
      where: { id },
    });
    if (!existing || existing.deletedAt) return NextResponse.json({ error: "Institution not found" }, { status: 404 });

    await db.institution.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await db.auditLog.create({
      data: {
        action: "DELETE",
        entity: "Institution",
        entityId: id,
        userId: session.user.id,
        changes: { before: existing },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/institutions/:id]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
