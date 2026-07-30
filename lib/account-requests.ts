import type { Role } from "@/lib/permissions";

/**
 * New-account requests.
 *
 * Managers raise a request; IT reviews it and creates the account by hand. The
 * request is deliberately not wired to create a User — that was the business's
 * choice, so approval here means "yes, go ahead", not "it exists now".
 */

/**
 * Roles that may raise a request.
 *
 * Hardcoded rather than read through effectiveHasPermission, which is
 * DB-overridable: who can ask IT to create a login is a security question, and
 * a permissions tweak in settings should not silently widen it.
 */
export const REQUESTER_ROLES = ["REGIONAL_MANAGER", "HR_MANAGER", "SUPER_ADMIN"] as const;

/** Roles that may approve or reject. */
export const REVIEWER_ROLES = ["SUPER_ADMIN"] as const;

export function canRequestAccount(role: string): boolean {
  return (REQUESTER_ROLES as readonly string[]).includes(role);
}

export function canReviewAccountRequest(role: string): boolean {
  return (REVIEWER_ROLES as readonly string[]).includes(role);
}

/**
 * Where request notifications go.
 *
 * Env-overridable so the address can change without a deploy, but defaulted to
 * the address the business asked for rather than left undefined — an unset
 * variable would otherwise mean requests are silently raised and never seen.
 */
export const ACCOUNT_REQUEST_INBOX =
  process.env.ACCOUNT_REQUEST_INBOX?.trim() || "it@illumestudentservices.ca";

/**
 * Roles a manager may request.
 *
 * SUPER_ADMIN is excluded on purpose: a regional manager should not be able to
 * request the highest privilege in the system, even with review, because it
 * normalises the ask. IT can still create one directly.
 */
export const REQUESTABLE_ROLES = [
  "EMPLOYEE",
  "ICR",
  "REGIONAL_MANAGER",
  "HR_MANAGER",
  "HQ_ANALYTICS",
  "HQ_EXECUTIVE",
  "INSTITUTION_CLIENT",
] as const satisfies readonly Role[];

export const ROLE_LABELS: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  HQ_EXECUTIVE: "HQ Executive",
  HQ_ANALYTICS: "HQ Analytics",
  REGIONAL_MANAGER: "Regional Manager",
  ICR: "ICR",
  INSTITUTION_CLIENT: "Institution Client",
  HR_MANAGER: "HR Manager",
  EMPLOYEE: "Employee",
};

export const EMPLOYMENT_TYPE_LABELS: Record<string, string> = {
  FULL_TIME: "Full-time",
  PART_TIME: "Part-time",
  CONTRACT: "Contract",
  INTERN: "Intern",
};

export const STATUS_LABELS: Record<string, string> = {
  PENDING: "Pending review",
  APPROVED: "Approved",
  REJECTED: "Rejected",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? role.replace(/_/g, " ");
}
