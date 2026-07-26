import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";

// ─── GET /api/sources/:id ──────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "sources", "read")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const source = await db.source.findUnique({
      where: { id },
      include: {
        region: { select: { id: true, name: true } },
        campaigns: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
        leads: {
          where: { deletedAt: null },
          include: {
            assignedICR: { select: { id: true, name: true } },
            institution: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
          take: 50,
        },
        _count: { select: { leads: true, campaigns: true } },
      },
    });

    if (!source || source.deletedAt) {
      return NextResponse.json({ error: "Source not found" }, { status: 404 });
    }

    const totalLeads = source._count.leads;
    const enrolledLeads = source.leads.filter((l) => l.stage === "ENROLLED").length;
    const conversionRate = totalLeads > 0 ? (enrolledLeads / totalLeads) * 100 : 0;

    return NextResponse.json({ ...source, totalLeads, enrolledLeads, conversionRate });
  } catch (error) {
    console.error("[GET /api/sources/:id]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── PATCH /api/sources/:id ────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "sources", "write")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const existing = await db.source.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) return NextResponse.json({ error: "Source not found" }, { status: 404 });

    const body = await req.json();
    const {
      name,
      type,
      country,
      city,
      regionId,
      contactPerson,
      email,
      phone,
      agreementStatus,
      rating,
      notes,
      isActive,
    } = body;

    const updated = await db.source.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(country !== undefined && { country }),
        ...(city !== undefined && { city }),
        ...(regionId !== undefined && { regionId: regionId || null }),
        ...(contactPerson !== undefined && { contactPerson }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
        ...(agreementStatus !== undefined && { agreementStatus }),
        ...(rating !== undefined && { rating }),
        ...(notes !== undefined && { notes }),
        ...(isActive !== undefined && { isActive }),
      },
    });

    await db.auditLog.create({
      data: {
        action: "UPDATE",
        entity: "Source",
        entityId: updated.id,
        userId: session.user.id,
        changes: { before: existing, after: body },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[PATCH /api/sources/:id]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── DELETE /api/sources/:id ───────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "sources", "delete")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const existing = await db.source.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) return NextResponse.json({ error: "Source not found" }, { status: 404 });

    // Soft delete
    await db.source.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });

    await db.auditLog.create({
      data: {
        action: "DELETE",
        entity: "Source",
        entityId: id,
        userId: session.user.id,
        changes: { before: existing },
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/sources/:id]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
