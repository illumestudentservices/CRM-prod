import type { Role } from "@/lib/permissions";

/**
 * Who may see the WHOLE field-operations activity log.
 *
 * Field activity is personal by default: an ICR (and every other individual
 * contributor) sees only the activities they logged themselves. Only these
 * supervisor roles see everyone's — managers, Super Admin and HQ admins.
 *
 * This governs the shared activity LIST and its summary counts. The role-scoped
 * dashboard panel above the list already shows each role its own cut.
 */
export const FIELD_OPS_SUPERVISOR_ROLES: Role[] = [
  "SUPER_ADMIN",
  "HQ_EXECUTIVE",
  "HQ_ANALYTICS",
  "REGIONAL_MANAGER",
];

export function canSeeAllFieldOps(role: Role): boolean {
  return FIELD_OPS_SUPERVISOR_ROLES.includes(role);
}

/**
 * Prisma `where` fragment scoping activity visibility to what `role` may see:
 * `{}` (everything) for supervisors, `{ userId }` (own only) for everyone else.
 * `userId` is the person who logged the activity.
 */
export function activityVisibilityWhere(
  role: Role,
  userId: string
): { userId?: string } {
  return canSeeAllFieldOps(role) ? {} : { userId };
}
