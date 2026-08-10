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
        // Migration 021 dropped EventInstitution — participations is the
        // sole join now.
        participations: {
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

    // Update participations if institutionIds provided.
    //
    // Spec §7 — EventParticipation is the authoritative join going forward
    // (per-institution ICR / status / notes). During cutover we ALSO wrote
    // to the flat EventInstitution join for legacy readers; now that
    // /(dashboard)/events reads participations, we STOP dual-writing on
    // PATCH. The flat table will be dropped in a future migration once no
    // reader references it (grep confirms none as of this change).
    //
    // Reconciliation is delete-then-insert: PATCH's contract is "the list I
    // provide is the complete new list", and preserving un-referenced rows
    // would silently retain an institution the caller thinks they removed.
    // Existing per-institution ICR/status/notes are lost if you remove an
    // institution from the list — matching the previous PATCH semantics.
    if (Array.isArray(institutionIds)) {
      await db.eventParticipation.deleteMany({ where: { eventId: id } });
      if (institutionIds.length > 0) {
        await db.eventParticipation.createMany({
          data: institutionIds.map((iid: string) => ({
            eventId: id,
            institutionId: iid,
            status: "CONFIRMED" as const,
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
        participations: {
          include: { institution: { select: { id: true, name: true } } },
        },
      },
    });

    // Spec Tasks §10 — event lifecycle triggers. When the status transitions
    // to COMPLETED or CLOSED, fire task templates keyed on
    // "RECRUITMENT_EVENT_<status>" so the "Upload Outcome" / "Schedule
    // Follow-up Webinar" workflow the spec describes runs automatically.
    if (
      status &&
      status !== existing.status &&
      (status === "COMPLETED" || status === "CLOSED")
    ) {
      try {
        const { fireEventTriggers } = await import("@/lib/task-workflow");
        const creator = await db.employee.findFirst({
          where: { userId: session.user.id },
          select: { id: true },
        });
        if (creator) {
          await fireEventTriggers(`RECRUITMENT_EVENT_${status}`, {
            createdById: creator.id,
            assigneeId: creator.id,
            parentType: "RECRUITMENT_EVENT",
            parentId: id,
          });
        }
      } catch (triggerErr) {
        console.error("[event trigger] failed to fire task templates", triggerErr);
      }
    }

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
