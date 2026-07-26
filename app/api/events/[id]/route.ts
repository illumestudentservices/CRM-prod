import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { type EventStatus } from "@prisma/client";

// ─── GET /api/events/:id ───────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "events", "read")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const event = await db.event.findUnique({
      where: { id },
      include: {
        region: { select: { id: true, name: true } },
        assignedICR: { select: { id: true, name: true } },
        institutions: {
          include: { institution: { select: { id: true, name: true } } },
        },
        expenses: { orderBy: { createdAt: "asc" } },
        leads: {
          where: { deletedAt: null },
          include: {
            assignedICR: { select: { id: true, name: true } },
            institution: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "desc" },
        },
        _count: { select: { leads: true, expenses: true } },
      },
    });

    if (!event || event.deletedAt) {
      return NextResponse.json({ error: "Event not found" }, { status: 404 });
    }

    const enrolledCount = event.leads.filter((l) => l.stage === "ENROLLED").length;
    const roi =
      event.totalCost > 0
        ? ((enrolledCount * 5000 - event.totalCost) / event.totalCost) * 100
        : null;

    return NextResponse.json({ ...event, enrolledCount, roi });
  } catch (error) {
    console.error("[GET /api/events/:id]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── PATCH /api/events/:id ─────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "events", "write")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const existing = await db.event.findUnique({
      where: { id },
    });
    if (!existing || existing.deletedAt) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const body = await req.json();
    const {
      name,
      type,
      date,
      city,
      country,
      status,
      budget,
      regionId,
      assignedICRId,
      institutionIds,
      notes,
      postEventNotes,
    } = body;

    // Recalculate totalCost from expenses
    const expenses = await db.eventExpense.findMany({
      where: { eventId: id },
      select: { amount: true },
    });
    const totalCost = expenses.reduce((sum, e) => sum + e.amount, 0);

    // Update institutions if provided
    if (Array.isArray(institutionIds)) {
      await db.eventInstitution.deleteMany({ where: { eventId: id } });
      if (institutionIds.length > 0) {
        await db.eventInstitution.createMany({
          data: institutionIds.map((iid: string) => ({
            eventId: id,
            institutionId: iid,
          })),
          skipDuplicates: true,
        });
      }
    }

    const updated = await db.event.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(type !== undefined && { type }),
        ...(date !== undefined && { date: new Date(date) }),
        ...(city !== undefined && { city }),
        ...(country !== undefined && { country }),
        ...(status !== undefined && { status: status as EventStatus }),
        ...(budget !== undefined && { budget }),
        ...(regionId !== undefined && { regionId: regionId || null }),
        ...(assignedICRId !== undefined && { assignedICRId: assignedICRId || null }),
        ...(notes !== undefined && { notes }),
        ...(postEventNotes !== undefined && { postEventNotes }),
        totalCost,
      },
      include: {
        institutions: {
          include: { institution: { select: { id: true, name: true } } },
        },
      },
    });

    return NextResponse.json(updated);
  } catch (error) {
    console.error("[PATCH /api/events/:id]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── DELETE /api/events/:id ────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "events", "delete")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const existing = await db.event.findUnique({
      where: { id },
    });
    if (!existing || existing.deletedAt) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    await db.event.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/events/:id]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
