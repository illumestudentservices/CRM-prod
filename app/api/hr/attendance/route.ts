import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

const checkInSchema = z.object({
  employeeId: z.string().min(1),
  notes: z.string().optional(),
});

const checkOutSchema = z.object({
  employeeId: z.string().min(1),
  notes: z.string().optional(),
});

// ─── GET /api/hr/attendance ───────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get("employeeId");
  const fromDate = searchParams.get("from");
  const toDate = searchParams.get("to");
  const isHR = HR_ROLES.includes(session.user.role as Role);

  const where: Record<string, unknown> = {};

  if (employeeId) {
    where.employeeId = employeeId;
  } else if (!isHR) {
    const employee = await db.employee.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!employee) return NextResponse.json({ records: [] });
    where.employeeId = employee.id;
  }

  if (fromDate || toDate) {
    where.date = {
      ...(fromDate ? { gte: new Date(fromDate) } : {}),
      ...(toDate ? { lte: new Date(toDate) } : {}),
    };
  }

  const records = await db.attendance.findMany({
    where,
    include: {
      employee: {
        include: { user: { select: { id: true, name: true, image: true } } },
      },
    },
    orderBy: { date: "desc" },
    take: 100,
  });

  return NextResponse.json({ records });
}

// ─── POST /api/hr/attendance (check-in) ──────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = checkInSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { employeeId, notes } = parsed.data;

  // Verify it's the employee themselves or HR
  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { userId: true },
  });
  if (!employee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  const isHR = HR_ROLES.includes(session.user.role as Role);
  if (!isHR && employee.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Check if already checked in today
  const existing = await db.attendance.findUnique({
    where: { employeeId_date: { employeeId, date: today } },
  });

  if (existing) {
    return NextResponse.json({ error: "Already checked in today" }, { status: 409 });
  }

  const record = await db.attendance.create({
    data: {
      employeeId,
      date: today,
      checkIn: new Date(),
      notes,
    },
  });

  return NextResponse.json({ record }, { status: 201 });
}

// ─── PATCH /api/hr/attendance (check-out) ────────────────────────────────────

export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = checkOutSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const { employeeId, notes } = parsed.data;

  const employee = await db.employee.findUnique({
    where: { id: employeeId },
    select: { userId: true },
  });
  if (!employee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  const isHR = HR_ROLES.includes(session.user.role as Role);
  if (!isHR && employee.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const existing = await db.attendance.findUnique({
    where: { employeeId_date: { employeeId, date: today } },
  });

  if (!existing) {
    return NextResponse.json({ error: "No check-in record found for today" }, { status: 404 });
  }

  if (existing.checkOut) {
    return NextResponse.json({ error: "Already checked out today" }, { status: 409 });
  }

  const checkOut = new Date();
  const hoursWorked = existing.checkIn
    ? (checkOut.getTime() - existing.checkIn.getTime()) / (1000 * 60 * 60)
    : 0;
  const overtime = Math.max(0, hoursWorked - 8);

  const record = await db.attendance.update({
    where: { employeeId_date: { employeeId, date: today } },
    data: {
      checkOut,
      hoursWorked: Math.round(hoursWorked * 100) / 100,
      overtime: Math.round(overtime * 100) / 100,
      notes: notes ?? existing.notes,
    },
  });

  return NextResponse.json({ record });
}
