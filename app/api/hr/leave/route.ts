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
  LEAVE_TYPES,
  checkGenderEligibility,
} from "@/lib/leave-policy";
import { logActivity } from "@/lib/activity-logger";

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

/** Thrown inside the transaction to surface a 422 without rolling back silently. */
class LeaveError extends Error {}

const createLeaveSchema = z.object({
  employeeId: z.string().min(1),
  // Derived from LEAVE_TYPES so a policy change cannot leave this list stale.
  leaveType: z.enum(LEAVE_TYPES as [LeaveTypeKey, ...LeaveTypeKey[]]),
  startDate: z.string().transform((v) => new Date(v)),
  endDate: z.string().transform((v) => new Date(v)),
  reason: z.string().optional(),
});

/** How a date reads in a notification or an email. */
const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });

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
  // "team" = the requests of the people who report to me, and only those. Its
  // own scope rather than widening the default list, so "Your leave requests"
  // keeps meaning exactly that and a manager's own history never mixes into
  // the queue they are being asked to decide.
  const scope = searchParams.get("scope");
  const isHR = HR_ROLES.includes(session.user.role as Role);

  const where: Record<string, unknown> = {};

  // The viewer's own employee record, needed by both the team scope and the
  // self scope below.
  const me = await db.employee.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  if (scope === "team") {
    // A manager could always APPROVE a direct report — PATCH /api/hr/leave/[id]
    // accepts `isManager` and says so in its refusal text. Nothing ever listed
    // the requests to them, so the permission was real and unreachable: the
    // only screen rendering an Approve button is gated on isHR, and this
    // endpoint forced every non-HR caller down to their own rows. Managers were
    // emailed "Action Required" and had nowhere to act.
    if (!me) return NextResponse.json({ requests: [] });
    const reports = await db.employee.findMany({
      where: { managerId: me.id },
      select: { id: true },
    });
    const reportIds = reports.map((r) => r.id);

    // A narrowing employeeId has to be one of them. Ignoring it instead would
    // answer a question nobody asked — the caller filtered to one person and
    // got the whole team back — and that is the shape of the bug this endpoint
    // already had once, where a check sat in an `else` and an explicit
    // employeeId walked past it.
    if (employeeId) {
      if (!reportIds.includes(employeeId)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
      where.employeeId = employeeId;
    } else {
      // An empty `in` matches nothing, which is the right answer for someone
      // with no direct reports.
      where.employeeId = { in: reportIds };
    }
  } else if (isHR) {
    if (employeeId) where.employeeId = employeeId;
  } else {
    // "Non-HR can only see their own" was in an `else if`, so an explicit
    // ?employeeId= bypassed it and exposed anyone's leave history — including
    // medical and compassionate reasons — to any signed-in user.
    if (!me) return NextResponse.json({ requests: [] });
    if (employeeId && employeeId !== me.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    where.employeeId = me.id;
  }

  if (status) where.status = status;
  if (leaveType) where.leaveType = leaveType;

  const rows = await db.leaveRequest.findMany({
    where,
    include: {
      employee: {
        // A select, not the whole row. `include: { employee: true }` returned
        // every scalar on it — home address, next of kin, phone, gender, cost
        // centre — to anyone who could read a leave request. HR could already
        // see those elsewhere; managers now reaching this endpoint cannot, and
        // a leave queue is not the place to hand them over.
        select: {
          id: true,
          employeeId: true,
          managerId: true,
          user: { select: { id: true, name: true, image: true } },
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Whether this viewer may decide each row, worked out here rather than left
  // to the client to infer. The client cannot see managerId relationships for
  // anyone but itself, and a button that appears on a row the server will
  // refuse is worse than no button.
  const requests = rows.map((r) => ({
    ...r,
    canDecide:
      r.status === "PENDING" && (isHR || (!!me && r.employee.managerId === me.id)),
  }));

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
        include: { user: { select: { id: true, name: true, email: true } } },
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
  const leaveType = data.leaveType;
  const policy = LEAVE_POLICIES[leaveType];

  // Maternity and paternity depend on the gender recorded on the employee
  // profile. Enforced here rather than only in the UI, since the request body
  // decides the type and a hidden dropdown option is not a control.
  const eligibility = checkGenderEligibility(leaveType, employee.gender);
  if (!eligibility.eligible) {
    return NextResponse.json({ error: eligibility.reason }, { status: 422 });
  }

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
            `${policy.label} becomes available on ${entitlement.eligibleFrom.toISOString().slice(0, 10)}, ${policy.waitingPeriod.value} ${policy.waitingPeriod.unit} after joining.`
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

      const created = await tx.leaveRequest.create({
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

      // Tell the manager in the app, inside the same transaction that books
      // the request.
      //
      // Applying used to create no Notification row for anyone, while the
      // DECISION route creates one for the employee — so the person being asked
      // to act was the only party with nothing in their bell, and a missed
      // email was the end of the trail. Written here rather than fired and
      // forgotten afterwards because a silently dropped write leaves the
      // request sitting in a queue nobody has been told about, which is the
      // failure this is meant to prevent.
      if (employee.manager?.user) {
        await tx.notification.create({
          data: {
            userId: employee.manager.user.id,
            title: "Leave request awaiting your approval",
            message: `${employee.user.name ?? "An employee"} requested ${days} day${days !== 1 ? "s" : ""} of ${policy.label.toLowerCase()} from ${fmtDate(data.startDate)} to ${fmtDate(data.endDate)}.`,
            type: "LEAVE",
            link: "/hr?tab=leave",
          },
        });
      }

      return created;
    });
  } catch (err) {
    if (err instanceof LeaveError) {
      return NextResponse.json({ error: err.message }, { status: 422 });
    }
    throw err;
  }

  // Notify direct manager + region manager (fire-and-forget)
  const leaveEmailPayload = {
    employeeName: employee.user.name ?? "Employee",
    leaveType: data.leaveType,
    startDate: fmtDate(data.startDate),
    endDate: fmtDate(data.endDate),
    days,
    reason: data.reason,
    leaveUrl: `${process.env.NEXTAUTH_URL ?? ""}/hr`,
  };

  // Email direct manager. The in-app notification is written inside the
  // transaction above; email is fire-and-forget because a mail provider being
  // down must not fail a leave application.
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

  void logActivity(session.user.id, "CREATE", "LeaveRequest", request.id, {
    route: "hr/leave",
    leaveType: request.leaveType,
    days: request.days,
  });

  return NextResponse.json({ request }, { status: 201 });
}
