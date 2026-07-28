import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { sendLeaveAppliedEmail } from "@/lib/email";
import {
  LEAVE_POLICIES,
  computeEntitlement,
  startOfDayUTC,
  type LeaveTypeKey,
} from "@/lib/leave-policy";

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

/** Thrown inside the transaction to surface a 422 without rolling back silently. */
class LeaveError extends Error {}

const createLeaveSchema = z.object({
  employeeId: z.string().min(1),
  leaveType: z.enum(["ANNUAL", "SICK", "MATERNITY", "PATERNITY", "UNPAID", "COMP_OFF"]),
  startDate: z.string().transform((v) => new Date(v)),
  endDate: z.string().transform((v) => new Date(v)),
  reason: z.string().optional(),
});

/**
 * Chargeable days between two dates: weekdays, less any public holiday that
 * applies to the employee's region.
 *
 * Dates are compared in UTC — using local-time getDay() shifted the day
 * boundary for anyone west of UTC and could misclassify which days are weekend.
 */
function calcWorkingDays(start: Date, end: Date, holidays: Date[]): number {
  const holidaySet = new Set(
    holidays.map((h) => startOfDayUTC(h).toISOString().slice(0, 10))
  );
  let count = 0;
  const cur = startOfDayUTC(start);
  const last = startOfDayUTC(end);
  while (cur <= last) {
    const day = cur.getUTCDay();
    const isWeekend = day === 0 || day === 6;
    const isHoliday = holidaySet.has(cur.toISOString().slice(0, 10));
    if (!isWeekend && !isHoliday) count++;
    cur.setUTCDate(cur.getUTCDate() + 1);
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

  const year = data.startDate.getUTCFullYear();
  const leaveType = data.leaveType as LeaveTypeKey;
  const policy = LEAVE_POLICIES[leaveType];

  // Public holidays that apply to this employee — global ones plus their region's
  const holidayRows = await db.holiday.findMany({
    where: {
      date: { gte: startOfDayUTC(data.startDate), lte: startOfDayUTC(data.endDate) },
      OR: [{ isGlobal: true }, { regionId: employee.user.regionId ?? undefined }],
    },
    select: { date: true },
  });

  const days = calcWorkingDays(data.startDate, data.endDate, holidayRows.map((h) => h.date));

  if (days <= 0) {
    return NextResponse.json(
      { error: "That range contains no working days — it falls entirely on weekends or public holidays." },
      { status: 422 }
    );
  }

  // Overlapping requests would silently double-book the same dates
  const clash = await db.leaveRequest.findFirst({
    where: {
      employeeId: data.employeeId,
      status: { in: ["PENDING", "APPROVED"] },
      startDate: { lte: data.endDate },
      endDate: { gte: data.startDate },
    },
    select: { id: true, startDate: true, endDate: true, status: true },
  });
  if (clash) {
    const f = (d: Date) => d.toISOString().slice(0, 10);
    return NextResponse.json(
      { error: `You already have a ${clash.status.toLowerCase()} request covering ${f(clash.startDate)} to ${f(clash.endDate)}.` },
      { status: 409 }
    );
  }

  // Reserving the days and creating the request must happen together: doing the
  // balance update first meant a failed create left pending days stranded, and
  // two concurrent requests could both pass the check before either reserved.
  let request;
  try {
    request = await db.$transaction(async (tx) => {
      if (policy.tracksBalance) {
        const consumed = await tx.leaveBalance.findUnique({
          where: {
            employeeId_leaveType_year: { employeeId: data.employeeId, leaveType, year },
          },
        });

        const entitlement = computeEntitlement(
          leaveType,
          employee.startDate,
          {
            usedDays: consumed?.usedDays ?? 0,
            pendingDays: consumed?.pendingDays ?? 0,
            adjustmentDays: consumed?.adjustmentDays ?? 0,
          },
          data.startDate
        );

        if (entitlement.inWaitingPeriod) {
          throw new LeaveError(
            `${policy.label} becomes available on ${entitlement.eligibleFrom.toISOString().slice(0, 10)}, ${policy.waitingPeriodMonths} months after joining.`
          );
        }

        if (days > entitlement.availableDays) {
          throw new LeaveError(
            `Insufficient ${policy.label.toLowerCase()}. Available: ${entitlement.availableDays} days, requested: ${days}.`
          );
        }

        // Row is created on first use — entitlement itself is derived, so there
        // is nothing to seed at hire or roll over in January.
        await tx.leaveBalance.upsert({
          where: {
            employeeId_leaveType_year: { employeeId: data.employeeId, leaveType, year },
          },
          create: {
            employeeId: data.employeeId,
            leaveType,
            year,
            totalDays: 0,
            adjustmentDays: 0,
            usedDays: 0,
            pendingDays: days,
          },
          update: { pendingDays: { increment: days } },
        });
      }

      return tx.leaveRequest.create({
        data: {
          employeeId: data.employeeId,
          leaveType,
          startDate: data.startDate,
          endDate: data.endDate,
          days,
          reason: data.reason,
          status: "PENDING",
        },
        include: {
          employee: { include: { user: { select: { id: true, name: true } } } },
        },
      });
    });
  } catch (err) {
    if (err instanceof LeaveError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    throw err;
  }

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
