import type { Role } from "@/lib/permissions";

/**
 * Offboarding requests — the mirror of lib/account-requests.ts.
 *
 * A manager raises a departure; IT reviews it and revokes access by hand.
 * Approval means "yes, this person is leaving", not "their access is gone" —
 * that stays a deliberate manual act, so `completedAt` is what records it.
 */

/**
 * Roles that may raise a departure.
 *
 * Hardcoded rather than read through effectiveHasPermission, which is
 * DB-overridable. Kept identical to REQUESTER_ROLES in lib/account-requests.ts:
 * whoever can ask for a login created should be able to ask for one closed, and
 * a permissions tweak in settings should not silently widen either.
 */
export const REQUESTER_ROLES = ["REGIONAL_MANAGER", "HR_MANAGER", "SUPER_ADMIN"] as const;

/** Roles that may approve or reject. */
export const REVIEWER_ROLES = ["SUPER_ADMIN"] as const;

export function canRequestOffboarding(role: string): boolean {
  return (REQUESTER_ROLES as readonly string[]).includes(role);
}

export function canReviewOffboardingRequest(role: string): boolean {
  return (REVIEWER_ROLES as readonly string[]).includes(role);
}

/**
 * Roles that may see every employee when choosing who is leaving.
 *
 * A REGIONAL_MANAGER is a permitted requester but is NOT here: they are scoped
 * to their own region (see `employeeScopeFor`). This matters because
 * GET /api/hr/employees is HR-only, so the picker needs its own narrow endpoint
 * rather than reusing the full staff list.
 */
export const FULL_ROSTER_ROLES = ["HR_MANAGER", "SUPER_ADMIN"] as const;

/**
 * Which employees a requester may raise a departure for.
 *
 * Returns a Prisma `EmployeeWhereInput` fragment. `null` means "nobody" — used
 * for a regional manager with no region set, where an unscoped query would
 * otherwise hand them the entire company.
 *
 * The POST route applies this again on the way in; filtering the picker alone
 * would leave the API open to a hand-crafted employeeId.
 */
export function employeeScopeFor(
  role: string,
  regionId: string | null | undefined
): Record<string, unknown> | null {
  if ((FULL_ROSTER_ROLES as readonly string[]).includes(role)) return {};
  if (role === "REGIONAL_MANAGER") {
    if (!regionId) return null;
    return { user: { regionId } };
  }
  return null;
}

/**
 * Requesters who may target a SUPER_ADMIN.
 *
 * The inverse of REQUESTABLE_ROLES excluding SUPER_ADMIN in
 * lib/account-requests.ts, and for the same reason: if a regional manager should
 * not be able to *request* the highest privilege in the system, they should not
 * be able to request its removal either. IT can still offboard an admin.
 */
export function canTargetRole(requesterRole: string, targetRole: string): boolean {
  if (targetRole !== "SUPER_ADMIN") return true;
  return requesterRole === "SUPER_ADMIN";
}

export const OFFBOARDING_REASONS = [
  "RESIGNATION",
  "END_OF_CONTRACT",
  "TERMINATION",
  "RETIREMENT",
  "REDUNDANCY",
  "OTHER",
] as const;

export type OffboardingReason = (typeof OFFBOARDING_REASONS)[number];

export const REASON_LABELS: Record<string, string> = {
  RESIGNATION: "Resignation",
  END_OF_CONTRACT: "End of contract",
  TERMINATION: "Termination",
  RETIREMENT: "Retirement",
  REDUNDANCY: "Redundancy",
  OTHER: "Other",
};

export const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending review",
  APPROVED: "Approved",
  REJECTED: "Declined",
};

export function reasonLabel(reason: string): string {
  return REASON_LABELS[reason] ?? reason.replace(/_/g, " ");
}

/**
 * Where departure notifications go.
 *
 * Falls back to ACCOUNT_REQUEST_INBOX before the hardcoded default so a business
 * that has already pointed account requests at a different address does not have
 * to set a second variable to keep the two flows together.
 */
export const OFFBOARDING_REQUEST_INBOX =
  process.env.OFFBOARDING_REQUEST_INBOX?.trim() ||
  process.env.ACCOUNT_REQUEST_INBOX?.trim() ||
  "it@illumestudentservices.ca";

/**
 * What IT still has to do by hand once a departure is approved.
 *
 * Shown in the UI and in the notification email. Deliberately a plain list and
 * not a stored checklist: the business asked for the request queue only, so this
 * is guidance rather than tracked state. If it ever needs ticking off, the
 * unused OnboardingItem model already carries an `isOffboarding` flag for it.
 */
export const REVOCATION_STEPS = [
  "Disable the portal login (Settings → Users → set inactive)",
  "Reset or remove Microsoft 365 / email access",
  "Collect company assets and mark them returned in the Assets tab",
  // Their live students, tasks and field work are now handed over in-app via
  // "Reassign workload", which is also what unblocks "Mark access revoked" —
  // so this is no longer something to remember, only something to do.
  "Reassign their live workload — the queue will not let you revoke access until you have",
  "Reassign anyone who reported to them to a new manager",
  "Set the employee's end date and mark the record inactive",
] as const;

/**
 * How many days of notice this departure gives, relative to now.
 *
 * Negative means the last working day has already passed — which is the case
 * worth flagging in the queue, because the person may still have a live login.
 */
export function daysUntil(lastWorkingDay: string | Date): number {
  const d = new Date(lastWorkingDay);
  const startOfDay = (x: Date) => Date.UTC(x.getUTCFullYear(), x.getUTCMonth(), x.getUTCDate());
  return Math.round((startOfDay(d) - startOfDay(new Date())) / 86_400_000);
}
