import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { sendLeaveAppliedEmail } from "@/lib/email";

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

const createLeaveSchema = z.object({
  employeeId: z.string().min(1),
  leaveType: z.enum(["ANNUAL", "SICK", "MATERNITY", "PATERNITY", "UNPAID", "COMP_OFF"]),
  startDate: z.string().transform((v) => new Date(v)),
  endDate: z.string().transform((v) => new Date(v)),
  reason: z.string().optional(),
});

function calcWorkingDays(start: Date, end: Date): number {
  let count = 0;
  const cur = new Date(start);
  while (cur <= end) {
    const day = cur.getDay();
    if (day !== 0 && day !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

// ─── GET /api/hr/leave ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get("employeeId");
  const status = searchParams.get("status");
  const leaveType = searchParams.get("leaveType");
  const isHR = HR_ROLES.includes(session.user.role as Role);

  const where: Record<string, unknown> = {};

  if (employeeId) {
    where.employeeId = employeeId;
  } else if (!isHR) {
    // Non-HR can only see their own
    const employee = await db.employee.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });
    if (!employee) return NextResponse.json({ requests: [] });
    where.employeeId = employee.id;
  }

  if (status) where.status = status;
  if (leaveType) where.leaveType = leaveType;

  const requests = await db.leaveRequest.findMany({
    where,
    include: {
      employee: {
        include: { user: { select: { id: true, name: true, image: true } } },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ requests });
}

// ─── POST /api/hr/leave ────────────────────────────────────────────────────────

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

  const parsed = createLeaveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const data = parsed.data;

  // Verify access
  const employee = await db.employee.findUnique({
    where: { id: data.employeeId },
    include: {
      user: { select: { id: true, name: true, regionId: true } },
      manager: {
        include: { user: { select: { name: true, email: true } } },
      },
    },
  });
  if (!employee) {
    return NextResponse.json({ error: "Employee not found" }, { status: 404 });
  }

  const isHR = HR_ROLES.includes(session.user.role as Role);
  const isSelf = employee.user.id === session.user.id;
  if (!isHR && !isSelf) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (data.endDate < data.startDate) {
    return NextResponse.json({ error: "End date must be after start date" }, { status: 422 });
  }

  const days = calcWorkingDays(data.startDate, data.endDate);
  const year = data.startDate.getFullYear();

  // Check balance (skip check for UNPAID)
  if (data.leaveType !== "UNPAID") {
    const balance = await db.leaveBalance.findUnique({
      where: {
        employeeId_leaveType_year: {
          employeeId: data.employeeId,
          leaveType: data.leaveType,
          year,
        },
      },
    });

    if (!balance) {
      return NextResponse.json(
        { error: `No ${data.leaveType} leave balance configured for ${year}` },
        { status: 422 }
      );
    }

    const available = balance.totalDays - balance.usedDays - balance.pendingDays;
    if (days > available) {
      return NextResponse.json(
        { error: `Insufficient leave balance. Available: ${available} days, Requested: ${days} days` },
        { status: 422 }
      );
    }

    // Increment pending days
    await db.leaveBalance.update({
      where: {
        employeeId_leaveType_year: {
          employeeId: data.employeeId,
          leaveType: data.leaveType,
          year,
        },
      },
      data: { pendingDays: { increment: days } },
    });
  }

  const request = await db.leaveRequest.create({
    data: {
      employeeId: data.employeeId,
      leaveType: data.leaveType,
      startDate: data.startDate,
      endDate: data.endDate,
      days,
      reason: data.reason,
      status: "PENDING",
    },
    include: {
      employee: {
        include: { user: { select: { id: true, name: true } } },
      },
    },
  });

  // Notify direct manager + region manager (fire-and-forget)
  const fmt = (d: Date) => d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
  const leaveEmailPayload = {
    employeeName: employee.user.name ?? "Employee",
    leaveType: data.leaveType,
    startDate: fmt(data.startDate),
    endDate: fmt(data.endDate),
    days,
    reason: data.reason,
    leaveUrl: `${process.env.NEXTAUTH_URL ?? ""}/hr`,
  };

  // Email direct manager
  if (employee.manager?.user) {
    sendLeaveAppliedEmail({
      to: employee.manager.user.email,
      managerName: employee.manager.user.name ?? "Manager",
      ...leaveEmailPayload,
    });
  }

  // Email region manager (if different from direct manager)
  const regionId = employee.user.regionId;
  if (regionId) {
    db.user.findFirst({
      where: { role: "REGIONAL_MANAGER", regionId, isActive: true, deletedAt: null },
      select: { name: true, email: true },
    }).then((rm) => {
      if (rm && rm.email !== employee.manager?.user.email) {
        sendLeaveAppliedEmail({
          to: rm.email,
          managerName: rm.name ?? "Manager",
          ...leaveEmailPayload,
        });
      }
    }).catch(() => {});
  }

  return NextResponse.json({ request }, { status: 201 });
}
