import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-logger";

/**
 * Leave in Lieu — the "earn" flow.
 *
 * Staff submit the extra hours they worked; a manager (or HR) approves, and the
 * day-equivalent is credited to their IN_LIEU leave balance for that year (see
 * the [id] route). Separate from /api/hr/leave because the input is "hours
 * worked on a day", not "a date range off" — the time off itself is booked as an
 * ordinary IN_LIEU leave request through /api/hr/leave.
 */

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

/** Standard working day. 40h week / 5 days = 8h/day. */
export const HOURS_PER_DAY = 8;

/** hours → day-equivalent, to 2 dp (e.g. 4h → 0.5d, 12h → 1.5d). */
function hoursToDays(hours: number): number {
  return Number((hours / HOURS_PER_DAY).toFixed(2));
}

const createSchema = z.object({
  employeeId: z.string().min(1),
  workDate: z.string().transform((v) => new Date(v)),
  hours: z.number().positive().max(24 * 14), // sanity cap (two weeks of hours)
  reason: z.string().optional(),
});

const fmtDate = (d: Date) =>
  d.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });

// ─── GET /api/hr/leave/in-lieu ───────────────────────────────────────────────
// ?scope=team → the viewer's direct reports (for approving); otherwise own rows
// (HR with ?employeeId= may read a specific person).

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const employeeId = searchParams.get("employeeId");
  const status = searchParams.get("status");
  const scope = searchParams.get("scope");
  const isHR = HR_ROLES.includes(session.user.role as Role);

  const me = await db.employee.findUnique({
    where: { userId: session.user.id },
    select: { id: true },
  });

  const where: Record<string, unknown> = {};

  if (scope === "team") {
    if (!me) return NextResponse.json({ requests: [] });
    const reports = await db.employee.findMany({ where: { managerId: me.id }, select: { id: true } });
    const reportIds = reports.map((r) => r.id);
    if (employeeId) {
      if (!reportIds.includes(employeeId)) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      where.employeeId = employeeId;
    } else {
      where.employeeId = { in: reportIds };
    }
  } else if (isHR) {
    if (employeeId) where.employeeId = employeeId;
  } else {
    if (!me) return NextResponse.json({ requests: [] });
    if (employeeId && employeeId !== me.id) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    where.employeeId = me.id;
  }

  if (status) where.status = status;

  const rows = await db.inLieuRequest.findMany({
    where,
    include: {
      employee: {
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

  const requests = rows.map((r) => ({
    ...r,
    canDecide: r.status === "PENDING" && (isHR || (!!me && r.employee.managerId === me.id)),
  }));

  return NextResponse.json({ requests });
}

// ─── POST /api/hr/leave/in-lieu ──────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
  }
  const data = parsed.data;

  const employee = await db.employee.findUnique({
    where: { id: data.employeeId },
    include: {
      user: { select: { id: true, name: true } },
      manager: { include: { user: { select: { id: true, name: true } } } },
    },
  });
  if (!employee) return NextResponse.json({ error: "Employee not found" }, { status: 404 });

  const isHR = HR_ROLES.includes(session.user.role as Role);
  const isSelf = employee.user.id === session.user.id;
  if (!isHR && !isSelf) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  if (Number.isNaN(data.workDate.getTime())) {
    return NextResponse.json({ error: "Invalid work date" }, { status: 422 });
  }

  const days = hoursToDays(data.hours);
  if (days <= 0) {
    return NextResponse.json({ error: "Hours must be greater than zero." }, { status: 422 });
  }
  const year = data.workDate.getUTCFullYear();

  const created = await db.$transaction(async (tx) => {
    const row = await tx.inLieuRequest.create({
      data: {
        employeeId: data.employeeId,
        workDate: data.workDate,
        hours: data.hours,
        days,
        reason: data.reason,
        year,
        status: "PENDING",
      },
    });

    // Tell the manager there's something to approve (same pattern as leave).
    if (employee.manager?.user) {
      await tx.notification.create({
        data: {
          userId: employee.manager.user.id,
          title: "In-lieu request awaiting your approval",
          message: `${employee.user.name ?? "An employee"} logged ${data.hours}h extra on ${fmtDate(data.workDate)} (${days} day${days !== 1 ? "s" : ""} in lieu).`,
          type: "LEAVE",
          link: "/hr?tab=leave",
        },
      });
    }

    return row;
  });

  void logActivity(session.user.id, "CREATE", "InLieuRequest", created.id, {
    route: "hr/leave/in-lieu",
    hours: data.hours,
    days,
  });

  return NextResponse.json({ request: created }, { status: 201 });
}
