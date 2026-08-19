import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditOrigin } from "@/lib/activity-logger";
import type { Role } from "@/lib/permissions";
import { ACTIVE_EMPLOYEE } from "@/lib/hr-scope";
import {
  LEAVE_POLICIES,
  computeEntitlement,
  leaveTypesForGender,
  type LeaveTypeKey,
} from "@/lib/leave-policy";

const HR_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN"];

// ─── GET /api/hr/leave/balances ────────────────────────────────────────────────

/**
 * Entitlement is derived from each employee's joining date and the policy, not
 * read from a stored allocation. Consumption rows are joined in where they
 * exist; an employee with no row simply has nothing used yet.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isHR = HR_ROLES.includes(session.user.role as Role);
  const year = parseInt(
    new URL(req.url).searchParams.get("year") ?? String(new Date().getUTCFullYear())
  );

  // Non-HR users may only see their own figures.
  const ownEmployee = isHR
    ? null
    : await db.employee.findUnique({
        where: { userId: session.user.id },
        select: { id: true },
      });
  if (!isHR && !ownEmployee) return NextResponse.json({ balances: [] });

  const employees = await db.employee.findMany({
    where: {
      ...ACTIVE_EMPLOYEE,
      ...(ownEmployee ? { id: ownEmployee.id } : {}),
    },
    select: {
      id: true,
      startDate: true,
      // Decides which parental types this employee is entitled to at all.
      gender: true,
      user: { select: { id: true, name: true, image: true } },
      department: { select: { name: true } },
      leaveBalances: { where: { year } },
    },
    orderBy: { user: { name: "asc" } },
  });

  // As-of matters: for the current year quote today's accrual, but for a past
  // year quote what had accrued by its end rather than a figure frozen at "now".
  const nowYear = new Date().getUTCFullYear();
  const asOf =
    year < nowYear ? new Date(Date.UTC(year, 11, 31)) : new Date();

  // Per employee, not a shared list: this used to map over every leave type,
  // so the response carried Maternity AND Paternity for the same person and the
  // screens built on it offered both. POST /api/hr/leave calls
  // checkGenderEligibility and refuses the mismatched one, so the employee was
  // being offered a choice the server would always reject.
  const balances = employees.flatMap((emp) =>
    leaveTypesForGender(emp.gender).map((leaveType) => {
      const row = emp.leaveBalances.find((b) => b.leaveType === leaveType);
      const e = computeEntitlement(
        leaveType,
        emp.startDate,
        {
          usedDays: row?.usedDays ?? 0,
          pendingDays: row?.pendingDays ?? 0,
          adjustmentDays: row?.adjustmentDays ?? 0,
        },
        asOf
      );
      return {
        id: row?.id ?? `${emp.id}:${leaveType}:${year}`,
        employeeId: emp.id,
        leaveType,
        year,
        // Named to match what the UI already expects
        totalDays: e.entitlementDays,
        usedDays: e.usedDays,
        pendingDays: e.pendingDays,
        adjustmentDays: row?.adjustmentDays ?? 0,
        availableDays: e.availableDays,
        accruedDays: e.accruedDays,
        inWaitingPeriod: e.inWaitingPeriod,
        eligibleFrom: e.eligibleFrom,
        nextAccrualOn: e.nextAccrualOn,
        tracksBalance: e.policy.tracksBalance,
        policySummary: e.policy.summary,
        employee: {
          id: emp.id,
          startDate: emp.startDate,
          user: emp.user,
          department: emp.department,
        },
      };
    })
  );

  return NextResponse.json({ balances, policies: LEAVE_POLICIES });
}

// ─── PATCH /api/hr/leave/balances ─────────────────────────────────────────────

const updateSchema = z.object({
  employeeId: z.string().min(1),
  leaveType: z.enum(["VACATION_PAID", "SICK", "MATERNITY", "PATERNITY"]),
  year: z.number().int(),
  /** Days granted (positive) or docked (negative) on top of computed entitlement. */
  adjustmentDays: z.number().min(-365).max(365),
  reason: z.string().min(1, "Reason is required"),
});

/**
 * HR can no longer overwrite the entitlement outright — that would be silently
 * undone the next time accrual is recomputed. Instead they record an adjustment
 * that sits on top of the policy figure, which stays visible and auditable.
 */
export async function PATCH(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isHR = HR_ROLES.includes(session.user.role as Role);
  if (!isHR) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let body: unknown;
  try { body = await req.json(); } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
  }

  const { employeeId, leaveType, year, adjustmentDays, reason } = parsed.data;

  const balance = await db.leaveBalance.upsert({
    where: { employeeId_leaveType_year: { employeeId, leaveType, year } },
    update: { adjustmentDays },
    create: {
      employeeId,
      leaveType,
      year,
      totalDays: 0,
      adjustmentDays,
      usedDays: 0,
      pendingDays: 0,
    },
  });

  await db.auditLog.create({
    data: {
      userId: session.user.id,
      action: "UPDATE",
      entity: "LEAVE_BALANCE",
      entityId: balance.id,
      changes: { leaveType, year, adjustmentDays, reason },
    
      ...(await auditOrigin()),
    },
  });

  return NextResponse.json({ balance });
}
