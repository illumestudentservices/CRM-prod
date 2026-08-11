import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { readJsonBody, handleApiError } from "@/lib/api-validation";

// ─── GET /api/travel ──────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await effectiveHasPermission(session.user.role, "travel", "read"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const employeeId = searchParams.get("employeeId");

  const where: Record<string, unknown> = {};
  if (status) where.status = status;
  if (employeeId) where.employeeId = employeeId;

  const travelRequests = await db.travelRequest.findMany({
    where,
    include: {
      employee: {
        include: { user: { select: { id: true, name: true, image: true } } },
      },
      itineraryItems: { orderBy: { date: "asc" } },
      travelMeetings: { orderBy: { date: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ travelRequests });
}

// ─── POST /api/travel ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await effectiveHasPermission(session.user.role, "travel", "write"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const {
    employeeId,
    destination,
    purpose,
    departDate,
    returnDate,
    estimatedCost,
    notes,
    itineraryItems,
    travelMeetings,
  } = body as {
    employeeId: string;
    destination: string;
    purpose: string;
    departDate: string;
    returnDate: string;
    estimatedCost?: number;
    notes?: string;
    itineraryItems?: {
      type: string;
      description: string;
      departureLocation?: string;
      arrivalLocation?: string;
      date: string;
      cost?: number;
      confirmationRef?: string;
      notes?: string;
    }[];
    travelMeetings?: {
      title: string;
      location?: string;
      date: string;
      notes?: string;
    }[];
  };

  if (!employeeId || !destination || !purpose || !departDate || !returnDate) {
    return NextResponse.json(
      { error: "Missing required fields: employeeId, destination, purpose, departDate, returnDate" },
      { status: 422 }
    );
  }

  // Verify employee exists
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { id: true, userId: true },
  });
  if (!employee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  const depart = new Date(departDate);
  const ret = new Date(returnDate);

  if (ret < depart) {
    return NextResponse.json(
      { error: "Return date must be after depart date" },
      { status: 422 }
    );
  }

  const travelRequest = await db.travelRequest.create({
    data: {
      employeeId,
      destination,
      purpose,
      departDate: depart,
      returnDate: ret,
      estimatedCost: estimatedCost ?? null,
      notes: notes ?? null,
      itineraryItems: itineraryItems?.length
        ? {
            create: itineraryItems.map((item) => ({
              type: item.type as "FLIGHT" | "HOTEL" | "TRANSFER" | "OTHER_TRAVEL",
              description: item.description,
              departureLocation: item.departureLocation ?? null,
              arrivalLocation: item.arrivalLocation ?? null,
              date: new Date(item.date),
              cost: item.cost ?? null,
              confirmationRef: item.confirmationRef ?? null,
              notes: item.notes ?? null,
            })),
          }
        : undefined,
      travelMeetings: travelMeetings?.length
        ? {
            create: travelMeetings.map((m) => ({
              title: m.title,
              location: m.location ?? null,
              date: new Date(m.date),
              notes: m.notes ?? null,
            })),
          }
        : undefined,
    },
    include: {
      employee: {
        include: { user: { select: { id: true, name: true } } },
      },
      itineraryItems: true,
      travelMeetings: true,
    },
  });

  return NextResponse.json({ travelRequest }, { status: 201 });
}
