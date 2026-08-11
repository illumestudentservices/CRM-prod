import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { trashRecord } from "@/lib/recycle-bin";

// ─── GET /api/travel/[id] ─────────────────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await effectiveHasPermission(session.user.role, "travel", "read"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const travelRequest = await db.travelRequest.findUnique({
    where: { id },
    include: {
      employee: {
        include: { user: { select: { id: true, name: true, image: true } } },
      },
      itineraryItems: { orderBy: { date: "asc" } },
      travelMeetings: { orderBy: { date: "asc" } },
    },
  });

  if (!travelRequest) {
    return NextResponse.json({ error: "Travel request not found" }, { status: 404 });
  }

  return NextResponse.json({ travelRequest });
}

// ─── PATCH /api/travel/[id] ───────────────────────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await effectiveHasPermission(session.user.role, "travel", "write"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const existing = await db.travelRequest.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Travel request not found" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    destination,
    purpose,
    departDate,
    returnDate,
    estimatedCost,
    actualCost,
    status,
    notes,
  } = body as {
    destination?: string;
    purpose?: string;
    departDate?: string;
    returnDate?: string;
    estimatedCost?: number;
    actualCost?: number;
    status?: string;
    notes?: string;
  };

  const updateData: Record<string, unknown> = {};
  if (destination !== undefined) updateData.destination = destination;
  if (purpose !== undefined) updateData.purpose = purpose;
  if (departDate !== undefined) updateData.departDate = new Date(departDate);
  if (returnDate !== undefined) updateData.returnDate = new Date(returnDate);
  if (estimatedCost !== undefined) updateData.estimatedCost = estimatedCost;
  if (actualCost !== undefined) updateData.actualCost = actualCost;
  if (notes !== undefined) updateData.notes = notes;

  if (status !== undefined) {
    updateData.status = status;
    if (status === "APPROVED") {
      updateData.approvedById = session.user.id;
      updateData.approvedAt = new Date();
    }
  }

  const updated = await db.travelRequest.update({
    where: { id },
    data: updateData,
    include: {
      employee: {
        include: { user: { select: { id: true, name: true } } },
      },
      itineraryItems: { orderBy: { date: "asc" } },
      travelMeetings: { orderBy: { date: "asc" } },
    },
  });

  return NextResponse.json({ travelRequest: updated });
}

// ─── DELETE /api/travel/[id] ──────────────────────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await effectiveHasPermission(session.user.role, "travel", "delete"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const existing = await db.travelRequest.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: "Travel request not found" }, { status: 404 });
  }

  await trashRecord({ entityType: "TravelRequest", entityId: id, userId: session.user.id });

  return NextResponse.json({ success: true });
}
