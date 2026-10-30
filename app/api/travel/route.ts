import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { readJsonBody, handleApiError } from "@/lib/api-validation";
import { logActivity } from "@/lib/activity-logger";

// ─── GET /api/travel ──────────────────────────────────────────────────────────

/**
 * Who may see everyone's trips.
 *
 * Deliberately the same two roles that hold travel:"approve" in
 * PERMISSION_MATRIX — reviewing a request is the reason to read someone else's.
 * Mirrors HR_ROLES in app/api/hr/leave/route.ts, which solves the same problem
 * for the same reason.
 */
const TRAVEL_ADMIN_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

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

  // The permission check above only asks whether the caller may read travel at
  // all — every role except INSTITUTION_CLIENT holds travel:read, including
  // EMPLOYEE. `where` was then built from query parameters alone, so any signed
  // in member of staff listed every colleague's trips, and ?employeeId= handed
  // back a named individual's: destination, purpose and cost.
  //
  // GET /api/hr/leave already narrows non-HR callers to their own employee
  // record; travel never got the same treatment.
  const isTravelAdmin = TRAVEL_ADMIN_ROLES.includes(session.user.role as Role);

  if (isTravelAdmin) {
    if (employeeId) where.employeeId = employeeId;
  } else {
    const employee = await db.employee.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    // A user with no employee record owns no trips. Returning an empty list is
    // the honest answer; falling through would return all of them.
    if (!employee) return NextResponse.json({ travelRequests: [] });
    if (employeeId && employeeId !== employee.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    where.employeeId = employee.id;
  }

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

  if (!destination || !purpose || !departDate || !returnDate) {
    return NextResponse.json(
      { error: "Missing required fields: destination, purpose, departDate, returnDate" },
      { status: 422 }
    );
  }

  // Mass-assignment guard. employeeId came straight from the body, so any
  // travel:write holder (EMPLOYEE, ICR and REGIONAL_MANAGER, not only HR/admin)
  // could file a trip in a colleague's name — a real cost and an approval chain
  // attached to someone who never asked for it, and a way to read that person's
  // travel back through the created row. Only the travel-admin roles may raise
  // travel for someone else; everyone else is pinned to their own employee
  // record, exactly as GET narrows them to it.
  const isTravelAdmin = TRAVEL_ADMIN_ROLES.includes(session.user.role as Role);
  let targetEmployeeId: string;
  if (isTravelAdmin) {
    if (!employeeId) {
      return NextResponse.json({ error: "employeeId is required" }, { status: 422 });
    }
    targetEmployeeId = employeeId;
  } else {
    const ownEmployee = await db.employee.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!ownEmployee) {
      return NextResponse.json(
        { error: "You have no employee record, so you cannot raise travel." },
        { status: 403 }
      );
    }
    // A non-admin may omit employeeId (it is their own), but naming someone
    // else is refused outright — 403, not a silent override, so the attempt is
    // visible rather than quietly corrected.
    if (employeeId && employeeId !== ownEmployee.id) {
      return NextResponse.json(
        { error: "You can only raise travel for yourself." },
        { status: 403 }
      );
    }
    targetEmployeeId = ownEmployee.id;
  }

  // Verify the target employee exists (an admin may pass any id).
  const employee = await db.employee.findUnique({
    where: { id: targetEmployeeId },
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
      employeeId: targetEmployeeId,
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
  void logActivity(session.user.id, "CREATE", "TravelRequest", travelRequest.id, { route: "travel" });

  return NextResponse.json({ travelRequest }, { status: 201 });
}
