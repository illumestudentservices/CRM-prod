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
 *
 * The four policies below are transcribed from the configuration screens
 * supplied by the business on 2026-07-29.
 */

export type LeaveTypeKey = "VACATION_PAID" | "SICK" | "MATERNITY" | "PATERNITY";

export type Gender = "MALE" | "FEMALE" | "OTHER";

/** Two shapes of accrual, because the four policies genuinely use both. */
export type Accrual =
  /** Credited every month on the joining-date anniversary. */
  | { mode: "MONTHLY_ON_JOINING"; days: number }
  /**
   * Credited once a year on a fixed calendar date. `prorateFirstPeriod`
   * reflects the "Prorate accrual: start of policy" setting — someone who
   * becomes eligible in August gets the portion of the year that remains,
   * not a full year's grant.
   */
  | {
      mode: "YEARLY_ON_DATE";
      days: number;
      month: number;
      day: number;
      prorateFirstPeriod: boolean;
    };

export interface LeavePolicy {
  leaveType: LeaveTypeKey;
  label: string;
  /** Whether a balance is enforced when applying. */
  tracksBalance: boolean;
  /** Waiting period from date of joining before any entitlement exists. */
  waitingPeriod: { value: number; unit: "days" | "months" };
  accrual: Accrual;
  /** Ceiling on accrued balance. null = uncapped. */
  maxBalance: number | null;
  /** Balance returns to zero at the end of the calendar year. */
  resetYearly: boolean;
  carryForward: boolean;
  encash: boolean;
  /**
   * Genders eligible to request this type. null = everyone.
   *
   * OTHER is eligible for both parental types by decision of the business:
   * nobody should be shut out of parental leave by their gender marker, and
   * every request still goes through HR approval.
   */
  eligibleGenders: readonly Gender[] | null;
  /** Shown in the UI so staff can see the rule rather than just a number. */
  summary: string;
}

export const LEAVE_POLICIES: Record<LeaveTypeKey, LeavePolicy> = {
  // Effective after 3 months from joining; 1.75 days credited monthly on the
  // joining date; reset yearly on 31 December; max balance 21.
  // 1.75 x 12 = 21, so a full year reaches the cap exactly.
  VACATION_PAID: {
    leaveType: "VACATION_PAID",
    label: "Vacation (Paid)",
    tracksBalance: true,
    waitingPeriod: { value: 3, unit: "months" },
    accrual: { mode: "MONTHLY_ON_JOINING", days: 1.75 },
    maxBalance: 21,
    resetYearly: true,
    carryForward: false,
    encash: false,
    eligibleGenders: null,
    summary:
      "1.75 days credited monthly on your joining date, starting 3 months after you join. Caps at 21 days and resets on 31 December. Unused days are not carried forward or encashed.",
  },

  // Effective after 5 days from joining; 5 days credited yearly on 1 January,
  // prorated from the start of the policy; reset yearly on 31 December.
  SICK: {
    leaveType: "SICK",
    label: "Sick Leave",
    tracksBalance: true,
    waitingPeriod: { value: 5, unit: "days" },
    accrual: { mode: "YEARLY_ON_DATE", days: 5, month: 1, day: 1, prorateFirstPeriod: true },
    maxBalance: null,
    resetYearly: true,
    carryForward: false,
    encash: false,
    eligibleGenders: null,
    summary:
      "5 days credited on 1 January each year, available 5 days after you join. Your first year is prorated for the months remaining. Resets on 31 December; not carried forward or encashed.",
  },

  // Effective after 1 month from joining; 22 days credited yearly on 1 January.
  // No proration — the configuration screen has no prorate rule, and a
  // maternity entitlement that shrank because of a joining date would be a
  // real policy change rather than a rounding detail.
  MATERNITY: {
    leaveType: "MATERNITY",
    label: "Maternity Leave",
    tracksBalance: true,
    waitingPeriod: { value: 1, unit: "months" },
    accrual: { mode: "YEARLY_ON_DATE", days: 22, month: 1, day: 1, prorateFirstPeriod: false },
    maxBalance: null,
    resetYearly: true,
    carryForward: false,
    encash: false,
    eligibleGenders: ["FEMALE", "OTHER"],
    summary:
      "22 days per calendar year, available 1 month after you join. Not prorated. Resets on 31 December; not carried forward or encashed.",
  },

  // Effective after 1 month from joining; 10 days credited yearly on
  // 1 January, prorated from the start of the policy.
  PATERNITY: {
    leaveType: "PATERNITY",
    label: "Paternity Leave",
    tracksBalance: true,
    waitingPeriod: { value: 1, unit: "months" },
    accrual: { mode: "YEARLY_ON_DATE", days: 10, month: 1, day: 1, prorateFirstPeriod: true },
    maxBalance: null,
    resetYearly: true,
    carryForward: false,
    encash: false,
    eligibleGenders: ["MALE", "OTHER"],
    summary:
      "10 days credited on 1 January each year, available 1 month after you join. Your first year is prorated for the months remaining. Resets on 31 December; not carried forward or encashed.",
  },
};

export const LEAVE_TYPES = Object.keys(LEAVE_POLICIES) as LeaveTypeKey[];

/**
 * Display labels and colours, derived from the policies above.
 *
 * Every HR screen used to keep its own `Record<string, string>` of these. When
 * the four types replaced the old six, those local copies silently kept the
 * dead keys: TypeScript cannot check a string-keyed record, so the leave form
 * went on offering ANNUAL, UNPAID and COMP_OFF while omitting VACATION_PAID
 * entirely — nobody could book vacation. Deriving them here means a policy
 * change cannot leave a screen behind.
 */
export const LEAVE_TYPE_LABELS: Record<LeaveTypeKey, string> = Object.fromEntries(
  LEAVE_TYPES.map((t) => [t, LEAVE_POLICIES[t].label])
) as Record<LeaveTypeKey, string>;

export const LEAVE_TYPE_COLORS: Record<LeaveTypeKey, string> = {
  VACATION_PAID: "#0EA5E9",
  SICK: "#EF4444",
  MATERNITY: "#EC4899",
  PATERNITY: "#8B5CF6",
};

export const LEAVE_TYPE_BADGE_CLASSES: Record<LeaveTypeKey, string> = {
  VACATION_PAID: "bg-sky-100 text-sky-700",
  SICK: "bg-red-100 text-red-700",
  MATERNITY: "bg-pink-100 text-pink-700",
  PATERNITY: "bg-violet-100 text-violet-700",
};

/** Tolerates historical values still sitting in old rows or JSON payloads. */
export function leaveTypeLabel(type: string): string {
  return (LEAVE_TYPE_LABELS as Record<string, string>)[type] ?? type.replace(/_/g, " ");
}

/** The type a fresh request form should start on. */
export const DEFAULT_LEAVE_TYPE: LeaveTypeKey = "VACATION_PAID";

// ─── Gender eligibility ──────────────────────────────────────────────────────

export interface EligibilityResult {
  eligible: boolean;
  /** Why not, phrased for the person reading it. */
  reason?: string;
}

/**
 * Whether an employee may request a leave type.
 *
 * A missing gender blocks the parental types, by decision of the business.
 * Failing closed is the deliberate choice: the alternative lets anyone request
 * either type for as long as HR has not filled the field in, which makes the
 * rule decorative.
 */
export function checkGenderEligibility(
  leaveType: LeaveTypeKey,
  gender: Gender | null | undefined
): EligibilityResult {
  const allowed = LEAVE_POLICIES[leaveType].eligibleGenders;
  if (!allowed) return { eligible: true };

  if (!gender) {
    return {
      eligible: false,
      reason: `${LEAVE_POLICIES[leaveType].label} depends on the gender recorded on the employee profile, which is not set. Ask HR to add it.`,
    };
  }
  if (!allowed.includes(gender)) {
    return {
      eligible: false,
      reason: `${LEAVE_POLICIES[leaveType].label} is not available for the gender recorded on this profile.`,
    };
  }
  return { eligible: true };
}

/** The types this employee can actually request. */
export function leaveTypesForGender(gender: Gender | null | undefined): LeaveTypeKey[] {
  return LEAVE_TYPES.filter((t) => checkGenderEligibility(t, gender).eligible);
}

// ─── Date helpers (UTC) ──────────────────────────────────────────────────────

/**
 * Adds whole months, clamping the day to the target month's length so a
 * 31 January joining date accrues on 28/29 February rather than rolling into
 * March.
 */
export function addMonthsUTC(base: Date, months: number): Date {
  const targetDom = base.getUTCDate();
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
  const daysInTarget = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)
  ).getUTCDate();
  d.setUTCDate(Math.min(targetDom, daysInTarget));
  return d;
}

export function addDaysUTC(base: Date, days: number): Date {
  const d = new Date(base.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

/** Midnight UTC on the same calendar day, so comparisons ignore time of day. */
export function startOfDayUTC(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** The date entitlement first becomes available. */
export function eligibleFromDate(policy: LeavePolicy, joiningDate: Date): Date {
  const doj = startOfDayUTC(joiningDate);
  return policy.waitingPeriod.unit === "days"
    ? addDaysUTC(doj, policy.waitingPeriod.value)
    : addMonthsUTC(doj, policy.waitingPeriod.value);
}

/**
 * Half-day granularity. Prorating 5 days across 5 of 12 months gives 2.083...,
 * which is not a number anyone wants to see on a leave balance.
 */
function roundToHalfDay(n: number): number {
  return Math.round(n * 2) / 2;
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
  /** True when the current year's grant was reduced for a mid-year start. */
  prorated: boolean;
}

export function computeAccrual(
  policy: LeavePolicy,
  joiningDate: Date,
  asOf: Date = new Date()
): AccrualResult {
  const doj = startOfDayUTC(joiningDate);
  const today = startOfDayUTC(asOf);
  const eligibleFrom = eligibleFromDate(policy, joiningDate);

  if (today < eligibleFrom) {
    return {
      accruedDays: 0,
      creditsToDate: 0,
      eligibleFrom,
      nextAccrualOn: eligibleFrom,
      inWaitingPeriod: true,
      prorated: false,
    };
  }

  if (policy.accrual.mode === "MONTHLY_ON_JOINING") {
    const { days } = policy.accrual;
    // Credits only count from the start of the current reset window, which is
    // what makes a mid-year joiner correctly pro-rated without extra maths.
    const windowStart = policy.resetYearly
      ? new Date(Date.UTC(today.getUTCFullYear(), 0, 1))
      : doj;

    let credits = 0;
    let nextAccrualOn: Date | null = null;
    const waitMonths =
      policy.waitingPeriod.unit === "months" ? policy.waitingPeriod.value : 0;

    for (let i = 0; i < 2400; i++) {
      const creditDate = addMonthsUTC(doj, waitMonths + i);
      if (creditDate > today) {
        nextAccrualOn = creditDate;
        break;
      }
      if (creditDate >= windowStart) credits++;
    }

    const raw = credits * days;
    const accrued = policy.maxBalance !== null ? Math.min(raw, policy.maxBalance) : raw;
    return {
      accruedDays: Number(accrued.toFixed(2)),
      creditsToDate: credits,
      eligibleFrom,
      nextAccrualOn:
        policy.maxBalance !== null && raw >= policy.maxBalance ? null : nextAccrualOn,
      inWaitingPeriod: false,
      prorated: false,
    };
  }

  // YEARLY_ON_DATE — the grant lands on a fixed calendar date.
  const { days, month, day, prorateFirstPeriod } = policy.accrual;
  const year = today.getUTCFullYear();
  const thisYearsCredit = new Date(Date.UTC(year, month - 1, day));
  const nextCredit = new Date(Date.UTC(year + 1, month - 1, day));

  // The first partial period is the year eligibility begins in, when the fixed
  // credit date has already passed by the time they qualify.
  const isFirstPeriod =
    eligibleFrom.getUTCFullYear() === year && eligibleFrom > thisYearsCredit;

  let accrued = days;
  let prorated = false;
  if (isFirstPeriod && prorateFirstPeriod) {
    // Whole months remaining in the year from the month eligibility starts,
    // inclusive — becoming eligible in August leaves Aug-Dec, so 5 of 12.
    const monthsRemaining = 12 - eligibleFrom.getUTCMonth();
    accrued = roundToHalfDay((days * monthsRemaining) / 12);
    prorated = true;
  }

  const capped = policy.maxBalance !== null ? Math.min(accrued, policy.maxBalance) : accrued;
  return {
    accruedDays: Number(capped.toFixed(2)),
    creditsToDate: 1,
    eligibleFrom,
    nextAccrualOn: nextCredit,
    inWaitingPeriod: false,
    prorated,
  };
}

// ─── Entitlement ─────────────────────────────────────────────────────────────

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

  const entitlementDays = accrual.accruedDays + (consumed.adjustmentDays ?? 0);

  return {
    ...accrual,
    leaveType,
    policy,
    usedDays: consumed.usedDays,
    pendingDays: consumed.pendingDays,
    entitlementDays: Number(entitlementDays.toFixed(2)),
    // Pending requests are held against the balance so two overlapping
    // requests cannot both be approved into an overdraft.
    availableDays: Number(
      Math.max(0, entitlementDays - consumed.usedDays - consumed.pendingDays).toFixed(2)
    ),
  };
}
