/**
 * Leave carry-over — a controlled exception to VACATION_PAID's standard
 * "resets 31 December, not carried forward" rule.
 *
 * Introduced for the SEA region (Nov 2026): reps may move up to a capped number
 * of their UNUSED `fromYear` paid-leave days forward so they can book an
 * early-holiday paid leave in `toYear` within a Jan–Feb window.
 *
 *   GRANT  (run once, now):  for each eligible rep, carried = min(cap, unused
 *          fromYear paid leave). Move it: fromYear balance adjustment -= carried,
 *          toYear balance adjustment += carried. Net liability unchanged. One
 *          LeaveCarryover row per (employee, type, fromYear, toYear) — idempotent.
 *
 *   EXPIRE (run daily; acts only after `bookingDeadline`): credit the days that
 *          were actually booked inside the window (bookedDays) and ERASE the rest
 *          from the toYear balance. "Use it or lose it."
 *
 * All amounts are paid leave (VACATION_PAID). Each rep's REGIONAL policy is used
 * so a region that overrides the paid-leave numbers is respected.
 */
import { db } from "@/lib/db";
import { computeEntitlement, type LeaveTypeKey } from "@/lib/leave-policy";
import { policiesForRegion } from "@/lib/leave-policy-resolver";
import type { LeaveType } from "@prisma/client";

const CARRYOVER_TYPE: LeaveTypeKey & LeaveType = "VACATION_PAID";

/** Two decimals — leave days are quarter/half-day granular, never binary-float noise. */
const round2 = (n: number) => Math.round(n * 100) / 100;

/** A calendar date at UTC midnight, so it never drifts across a timezone. */
const utcDate = (y: number, mZeroBased: number, d: number) =>
  new Date(Date.UTC(y, mZeroBased, d));

/** Last day of February in `year` (handles leap years). */
const endOfFeb = (year: number) => utcDate(year, 2, 0); // day 0 of March = last of Feb

export interface CarryoverWindow {
  fromYear: number;
  toYear: number;
  windowStart: Date;
  windowEnd: Date;
  bookingDeadline: Date;
}

/**
 * The booking window these carried days may be spent in, and the book-by date.
 * Default: book an early-holiday paid leave in Jan–Feb of `toYear`, book-by the
 * `fromYear` year-end.
 */
export function carryoverWindow(fromYear: number, toYear = fromYear + 1): CarryoverWindow {
  return {
    fromYear,
    toYear,
    windowStart: utcDate(toYear, 0, 1), // 1 Jan toYear
    windowEnd: endOfFeb(toYear), // last day of Feb toYear
    bookingDeadline: utcDate(fromYear, 11, 31), // 31 Dec fromYear
  };
}

export interface GrantRow {
  employeeId: string;
  name: string | null;
  email: string;
  role: string;
  /** Unused paid leave in `fromYear` (regional policy), before the cap. */
  unusedFromYear: number;
  /** Days actually carried = min(cap, unusedFromYear). */
  carried: number;
  /** Set when nothing was carried (and why), or when the row already existed. */
  skipped?: "nothing-to-carry" | "already-granted";
}

export interface GrantSummary {
  regionId: string;
  regionName: string;
  window: CarryoverWindow;
  capDays: number;
  asOf: string;
  dryRun: boolean;
  rows: GrantRow[];
  granted: number; // rows that carried > 0 and were applied
  totalDaysCarried: number;
}

/**
 * Grant the carry-over to every eligible rep in a region.
 *
 * Eligible = an ACTIVE employee whose ACTIVE, non-deleted user sits in the
 * region. Each rep carries `min(capDays, unused fromYear paid leave)`, where
 * "unused" is measured at the fromYear year-end (so the full year's monthly
 * accrual is counted) under the rep's regional policy.
 */
export async function grantRegionCarryover(opts: {
  regionId: string;
  fromYear: number;
  toYear?: number;
  capDays: number;
  grantedBy?: string;
  dryRun?: boolean;
}): Promise<GrantSummary> {
  const { regionId, fromYear, capDays, grantedBy = "carryover-grant", dryRun = false } = opts;
  const window = carryoverWindow(fromYear, opts.toYear);
  const { toYear } = window;

  const region = await db.region.findUnique({ where: { id: regionId }, select: { name: true } });
  if (!region) throw new Error(`Region ${regionId} not found`);

  const policies = await policiesForRegion(regionId);
  // Measure unused fromYear leave at that year's end, so every complete month of
  // monthly accrual is already credited — "5 of the YEAR 2026", not "5 of what
  // has accrued by today".
  const asOf = utcDate(fromYear, 11, 31);

  const employees = await db.employee.findMany({
    where: { isActive: true, user: { regionId, isActive: true, deletedAt: null } },
    select: {
      id: true,
      startDate: true,
      user: { select: { name: true, email: true, role: true } },
      leaveBalances: {
        where: { leaveType: CARRYOVER_TYPE, year: { in: [fromYear, toYear] } },
        select: { year: true, usedDays: true, pendingDays: true, adjustmentDays: true },
      },
      leaveCarryovers: {
        where: { leaveType: CARRYOVER_TYPE, fromYear, toYear },
        select: { id: true },
      },
    },
    orderBy: { user: { name: "asc" } },
  });

  const rows: GrantRow[] = [];
  let granted = 0;
  let totalDaysCarried = 0;

  for (const emp of employees) {
    const base: GrantRow = {
      employeeId: emp.id,
      name: emp.user.name,
      email: emp.user.email,
      role: emp.user.role,
      unusedFromYear: 0,
      carried: 0,
    };

    if (emp.leaveCarryovers.length > 0) {
      rows.push({ ...base, skipped: "already-granted" });
      continue;
    }

    const fromRow = emp.leaveBalances.find((b) => b.year === fromYear);
    const ent = computeEntitlement(
      CARRYOVER_TYPE,
      emp.startDate,
      {
        usedDays: fromRow?.usedDays ?? 0,
        pendingDays: fromRow?.pendingDays ?? 0,
        adjustmentDays: fromRow?.adjustmentDays ?? 0,
      },
      asOf,
      policies[CARRYOVER_TYPE]
    );
    const unused = round2(ent.availableDays);
    const carried = round2(Math.min(capDays, Math.max(0, unused)));
    base.unusedFromYear = unused;
    base.carried = carried;

    if (carried <= 0) {
      rows.push({ ...base, skipped: "nothing-to-carry" });
      continue;
    }

    if (!dryRun) {
      await db.$transaction(async (tx) => {
        // Remove the carried days from the fromYear balance (they leave the year).
        await tx.leaveBalance.upsert({
          where: { employeeId_leaveType_year: { employeeId: emp.id, leaveType: CARRYOVER_TYPE, year: fromYear } },
          create: { employeeId: emp.id, leaveType: CARRYOVER_TYPE, year: fromYear, adjustmentDays: -carried },
          update: { adjustmentDays: { decrement: carried } },
        });
        // Add them to the toYear balance so the early holiday can be booked.
        await tx.leaveBalance.upsert({
          where: { employeeId_leaveType_year: { employeeId: emp.id, leaveType: CARRYOVER_TYPE, year: toYear } },
          create: { employeeId: emp.id, leaveType: CARRYOVER_TYPE, year: toYear, adjustmentDays: carried },
          update: { adjustmentDays: { increment: carried } },
        });
        // Record the grant. The unique (employee, type, fromYear, toYear) makes a
        // concurrent/repeat run fail here rather than double-apply the balances.
        await tx.leaveCarryover.create({
          data: {
            employeeId: emp.id,
            leaveType: CARRYOVER_TYPE,
            fromYear,
            toYear,
            days: carried,
            windowStart: window.windowStart,
            windowEnd: window.windowEnd,
            bookingDeadline: window.bookingDeadline,
            grantedBy,
          },
        });
      });
    }

    granted++;
    totalDaysCarried = round2(totalDaysCarried + carried);
    rows.push(base);
  }

  return {
    regionId,
    regionName: region.name,
    window,
    capDays,
    asOf: asOf.toISOString().slice(0, 10),
    dryRun,
    rows,
    granted,
    totalDaysCarried,
  };
}

export interface ExpireRow {
  carryoverId: string;
  employeeId: string;
  name: string | null;
  email: string;
  days: number;
  booked: number;
  erased: number;
}

export interface ExpireSummary {
  asOf: string;
  dryRun: boolean;
  processed: number;
  totalErased: number;
  rows: ExpireRow[];
}

/**
 * Expire carry-overs whose booking deadline has passed: keep what was booked in
 * the window, erase the rest from the toYear balance.
 *
 * Runs daily and is a no-op until a deadline passes; already-EXPIRED rows are
 * skipped, so a repeat run never erases twice.
 */
export async function expireCarryovers(opts?: {
  asOf?: Date;
  dryRun?: boolean;
}): Promise<ExpireSummary> {
  const asOf = opts?.asOf ?? new Date();
  const dryRun = opts?.dryRun ?? false;

  const due = await db.leaveCarryover.findMany({
    where: { status: "ACTIVE", bookingDeadline: { lt: asOf } },
    select: {
      id: true,
      employeeId: true,
      leaveType: true,
      toYear: true,
      days: true,
      windowStart: true,
      windowEnd: true,
      employee: { select: { user: { select: { name: true, email: true } } } },
    },
    orderBy: { bookingDeadline: "asc" },
  });

  const rows: ExpireRow[] = [];
  let totalErased = 0;

  for (const c of due) {
    // What was actually booked inside the window — any paid-leave request that is
    // still live (pending or approved) and starts in [windowStart, windowEnd].
    // Capped at what was carried: extra days came from their own toYear accrual.
    const agg = await db.leaveRequest.aggregate({
      _sum: { days: true },
      where: {
        employeeId: c.employeeId,
        leaveType: c.leaveType,
        status: { in: ["PENDING", "APPROVED"] },
        startDate: { gte: c.windowStart, lte: c.windowEnd },
      },
    });
    const booked = round2(Math.min(c.days, Math.max(0, agg._sum.days ?? 0)));
    const erased = round2(Math.max(0, c.days - booked));

    if (!dryRun) {
      await db.$transaction(async (tx) => {
        if (erased > 0) {
          // Pull the unbooked carry-over back out of the toYear balance. Only the
          // adjustment is touched; booked days live in used/pending and stay.
          await tx.leaveBalance.updateMany({
            where: { employeeId: c.employeeId, leaveType: c.leaveType, year: c.toYear },
            data: { adjustmentDays: { decrement: erased } },
          });
        }
        await tx.leaveCarryover.update({
          where: { id: c.id },
          data: { status: "EXPIRED", bookedDays: booked, expiredAt: asOf },
        });
      });
    }

    totalErased = round2(totalErased + erased);
    rows.push({
      carryoverId: c.id,
      employeeId: c.employeeId,
      name: c.employee.user.name,
      email: c.employee.user.email,
      days: c.days,
      booked,
      erased,
    });
  }

  return {
    asOf: asOf.toISOString().slice(0, 10),
    dryRun,
    processed: rows.length,
    totalErased,
    rows,
  };
}
