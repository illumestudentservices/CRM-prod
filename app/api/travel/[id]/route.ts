import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { trashRecord } from "@/lib/recycle-bin";
import { logActivity } from "@/lib/activity-logger";

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

  // Object scope: holding travel:read is not the right to read ANY trip by id.
  // Only the owner, or someone who may approve travel (HR/admin), may see it —
  // mirroring how GET /api/travel scopes the list. 404, not 403, so a stranger
  // cannot even confirm the id exists.
  const canApproveTravel = await effectiveHasPermission(session.user.role, "travel", "approve");
  const isOwner = travelRequest.employee.user?.id === session.user.id;
  if (!isOwner && !canApproveTravel) {
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

  const existing = await db.travelRequest.findUnique({
    where: { id },
    include: { employee: { select: { user: { select: { id: true } } } } },
  });
  if (!existing) {
    return NextResponse.json({ error: "Travel request not found" }, { status: 404 });
  }

  // Object scope + approval authority. travel:write lets you edit YOUR OWN trip,
  // not any trip by id, and it must NOT let you approve one — that is travel:approve.
  const canApproveTravel = await effectiveHasPermission(session.user.role, "travel", "approve");
  const isOwner = existing.employee.user?.id === session.user.id;
  if (!isOwner && !canApproveTravel) {
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
    // Guard the enum ourselves — an unknown value would otherwise reach Prisma
    // and surface as a 500 rather than a clean 400.
    const VALID_STATUSES = ["PENDING", "APPROVED", "REJECTED", "COMPLETED"];
    if (!VALID_STATUSES.includes(status)) {
      return NextResponse.json({ error: "Invalid travel status." }, { status: 400 });
    }
    // Changing status is a management action: it needs travel:approve, NOT
    // travel:write (which only lets the owner edit their own request's details).
    if (!canApproveTravel) {
      return NextResponse.json({ error: "You don't have permission to change a travel request's status." }, { status: 403 });
    }
    // And nobody signs off their own trip, approver or not.
    if (isOwner && (status === "APPROVED" || status === "REJECTED")) {
      return NextResponse.json({ error: "You can't approve or reject your own travel request." }, { status: 403 });
    }
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
  void logActivity(session.user.id, "UPDATE", "TravelRequest", updated.id, { route: "travel/[id]" });

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
