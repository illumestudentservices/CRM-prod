/**
 * Leave entitlement policy and accrual maths.
 *
 * Entitlement is *computed* from the employee's date of joining rather than
 * stored. That choice matters: the previous design wrote a fixed allocation row
 * at hire for the hire year only, so every balance silently vanished on 1
 * January and nobody could book leave until HR recreated the rows by hand.
 * Deriving it means there is nothing to expire, no scheduled job to miss, and
 * pro-rating for mid-year joiners falls out for free.
 *
 * LeaveBalance still exists, but only to record what has been *consumed*
 * (usedDays / pendingDays) and any manual HR adjustment.
 *
 * All arithmetic is UTC. Local-time date maths shifts day boundaries for
 * anyone west of UTC and would move which days count as weekend.
 */

export type LeaveTypeKey =
  | "ANNUAL"
  | "SICK"
  | "MATERNITY"
  | "PATERNITY"
  | "UNPAID"
  | "COMP_OFF";

export interface LeavePolicy {
  leaveType: LeaveTypeKey;
  label: string;
  /** Whether a balance is enforced when applying. */
  tracksBalance: boolean;
  /** Waiting period from date of joining before any entitlement exists. */
  waitingPeriodMonths: number;
  /** Days credited each accrual period. null = not accrued, use fixedAnnualDays. */
  accrualDays: number | null;
  /** Accrual falls on the joining-date anniversary each month. */
  accrualFrequency: "MONTHLY" | null;
  /** Flat annual entitlement for types that aren't accrued. */
  fixedAnnualDays: number | null;
  /** Ceiling on accrued balance. null = uncapped. */
  maxBalance: number | null;
  /** Balance returns to zero at the end of the calendar year. */
  resetYearly: boolean;
  carryForward: boolean;
  encash: boolean;
  /** Shown in the UI so staff can see the rule rather than just a number. */
  summary: string;
}

/**
 * Vacation / paid leave, per the configured policy:
 * effective after 3 months from joining, 1.75 days credited monthly on the
 * joining date, reset yearly on 31 December, no carry-forward, no encashment,
 * maximum balance 21 days. 1.75 x 12 = 21, so a full year exactly reaches
 * the cap.
 *
 * The remaining types keep their previous flat allocation until their policies
 * are supplied — they are marked so the UI can say as much rather than implying
 * a rule that doesn't exist.
 */
export const LEAVE_POLICIES: Record<LeaveTypeKey, LeavePolicy> = {
  ANNUAL: {
    leaveType: "ANNUAL",
    label: "Vacation / Paid Leave",
    tracksBalance: true,
    waitingPeriodMonths: 3,
    accrualDays: 1.75,
    accrualFrequency: "MONTHLY",
    fixedAnnualDays: null,
    maxBalance: 21,
    resetYearly: true,
    carryForward: false,
    encash: false,
    summary:
      "1.75 days credited monthly on your joining date, starting 3 months after you join. Caps at 21 days and resets on 31 December. Unused days are not carried forward or encashed.",
  },
  SICK: {
    leaveType: "SICK",
    label: "Sick Leave",
    tracksBalance: true,
    waitingPeriodMonths: 0,
    accrualDays: null,
    accrualFrequency: null,
    fixedAnnualDays: 10,
    maxBalance: null,
    resetYearly: true,
    carryForward: false,
    encash: false,
    summary: "10 days per calendar year. Policy not yet configured.",
  },
  MATERNITY: {
    leaveType: "MATERNITY",
    label: "Maternity Leave",
    tracksBalance: true,
    waitingPeriodMonths: 0,
    accrualDays: null,
    accrualFrequency: null,
    fixedAnnualDays: 90,
    maxBalance: null,
    resetYearly: true,
    carryForward: false,
    encash: false,
    summary: "90 days. Policy not yet configured.",
  },
  PATERNITY: {
    leaveType: "PATERNITY",
    label: "Paternity Leave",
    tracksBalance: true,
    waitingPeriodMonths: 0,
    accrualDays: null,
    accrualFrequency: null,
    fixedAnnualDays: 5,
    maxBalance: null,
    resetYearly: true,
    carryForward: false,
    encash: false,
    summary: "5 days. Policy not yet configured.",
  },
  UNPAID: {
    leaveType: "UNPAID",
    label: "Unpaid Leave",
    tracksBalance: false,
    waitingPeriodMonths: 0,
    accrualDays: null,
    accrualFrequency: null,
    fixedAnnualDays: null,
    maxBalance: null,
    resetYearly: false,
    carryForward: false,
    encash: false,
    summary: "No balance is deducted. Subject to approval.",
  },
  COMP_OFF: {
    leaveType: "COMP_OFF",
    label: "Compensatory Off",
    tracksBalance: true,
    waitingPeriodMonths: 0,
    accrualDays: null,
    accrualFrequency: null,
    fixedAnnualDays: 0,
    maxBalance: null,
    resetYearly: true,
    carryForward: false,
    encash: false,
    summary: "Granted by HR against approved overtime. Policy not yet configured.",
  },
};

// ─── Date helpers (UTC) ──────────────────────────────────────────────────────

/**
 * Adds whole months, clamping the day to the target month's length so a
 * 31 January joining date accrues on 28/29 February rather than rolling into
 * March.
 */
export function addMonthsUTC(base: Date, months: number): Date {
  const targetDom = base.getUTCDate();
  const d = new Date(
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1)
  );
  const daysInTarget = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
  ).getUTCDate();
  d.setUTCDate(Math.min(targetDom, daysInTarget));
  return d;
}

/** Midnight UTC on the same calendar day, so comparisons ignore time of day. */
export function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

// ─── Accrual ─────────────────────────────────────────────────────────────────

export interface AccrualResult {
  /** Entitlement earned so far this year, after the cap. */
  accruedDays: number;
  /** Credits received so far in the current reset window. */
  creditsToDate: number;
  /** When entitlement first begins (joining date + waiting period). */
  eligibleFrom: Date;
  /** Next accrual date, or null if capped or not yet eligible. */
  nextAccrualOn: Date | null;
  /** True while the waiting period is still running. */
  inWaitingPeriod: boolean;
}

/**
 * Entitlement earned as of a given date.
 *
 * The first credit lands on the waiting-period anniversary itself — joining
 * 15 March with a 3-month wait means the first 1.75 days arrive on 15 June,
 * not 15 July.
 *
 * With resetYearly, only credits falling inside the current calendar year
 * count, which is what makes a mid-year joiner correctly pro-rated.
 */
export function computeAccrual(
  policy: LeavePolicy,
  joiningDate: Date,
  asOf: Date = new Date()
): AccrualResult {
  const doj = startOfDayUTC(joiningDate);
  const today = startOfDayUTC(asOf);
  const eligibleFrom = addMonthsUTC(doj, policy.waitingPeriodMonths);

  // Non-accrual types: flat grant, available once the waiting period passes.
  if (policy.accrualDays === null || policy.accrualFrequency === null) {
    const inWaiting = today < eligibleFrom;
    return {
      accruedDays: inWaiting ? 0 : policy.fixedAnnualDays ?? 0,
      creditsToDate: 0,
      eligibleFrom,
      nextAccrualOn: null,
      inWaitingPeriod: inWaiting,
    };
  }

  if (today < eligibleFrom) {
    return {
      accruedDays: 0,
      creditsToDate: 0,
      eligibleFrom,
      nextAccrualOn: eligibleFrom,
      inWaitingPeriod: true,
    };
  }

  // Credits only count from the start of the current reset window.
  const windowStart = policy.resetYearly
    ? new Date(Date.UTC(today.getUTCFullYear(), 0, 1))
    : doj;

  let credits = 0;
  let nextAccrualOn: Date | null = null;

  for (let i = 0; i < 2400; i++) {
    const creditDate = addMonthsUTC(doj, policy.waitingPeriodMonths + i);
    if (creditDate > today) {
      nextAccrualOn = creditDate;
      break;
    }
    if (creditDate >= windowStart) credits++;
  }

  const raw = credits * policy.accrualDays;
  const accruedDays =
    policy.maxBalance !== null ? Math.min(raw, policy.maxBalance) : raw;

  // Once capped there is nothing further to credit this window.
  if (policy.maxBalance !== null && raw >= policy.maxBalance) {
    nextAccrualOn = null;
  }

  return {
    accruedDays: Math.round(accruedDays * 100) / 100,
    creditsToDate: credits,
    eligibleFrom,
    nextAccrualOn,
    inWaitingPeriod: false,
  };
}

export interface LeaveEntitlement extends AccrualResult {
  leaveType: LeaveTypeKey;
  policy: LeavePolicy;
  usedDays: number;
  pendingDays: number;
  /** Accrued + manual adjustment, i.e. the total the employee may draw on. */
  entitlementDays: number;
  /** What can still be booked right now. */
  availableDays: number;
}

/** Combines computed accrual with what's already been consumed. */
export function computeEntitlement(
  leaveType: LeaveTypeKey,
  joiningDate: Date,
  consumed: { usedDays: number; pendingDays: number; adjustmentDays?: number },
  asOf: Date = new Date()
): LeaveEntitlement {
  const policy = LEAVE_POLICIES[leaveType];
  const accrual = computeAccrual(policy, joiningDate, asOf);
  const adjustment = consumed.adjustmentDays ?? 0;
  const entitlementDays = Math.round((accrual.accruedDays + adjustment) * 100) / 100;
  const availableDays =
    Math.round((entitlementDays - consumed.usedDays - consumed.pendingDays) * 100) / 100;

  return {
    ...accrual,
    leaveType,
    policy,
    usedDays: consumed.usedDays,
    pendingDays: consumed.pendingDays,
    entitlementDays,
    availableDays,
  };
}
