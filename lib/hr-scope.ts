import type { Prisma } from "@prisma/client";

/**
 * Who counts as staff.
 *
 * An Employee row and its User row carry separate `isActive` flags and the User
 * additionally has `deletedAt`. Nothing kept them in step, so disabling a user
 * left their employee record untouched and HR carried on listing them: at one
 * point every one of the seven "employees" on the HR dashboard belonged to a
 * disabled demo account, while the three real staff appeared nowhere.
 *
 * Defined once and imported everywhere an employee list or count is produced,
 * because a filter copied into eight call sites is a filter that will be
 * updated in seven of them.
 */

/** Employees whose account still exists — deleted users are never staff. */
export const EMPLOYEE_USER_LIVE: Prisma.EmployeeWhereInput = {
  user: { deletedAt: null },
};

/**
 * Employees who currently work here: their own record is active and their
 * account has not been deleted.
 *
 * A user may be deactivated while remaining an employee — suspended, on
 * extended leave — so `user.isActive` is deliberately NOT part of this. Only
 * deletion removes someone from the headcount.
 */
export const ACTIVE_EMPLOYEE: Prisma.EmployeeWhereInput = {
  isActive: true,
  user: { deletedAt: null },
};

/**
 * Merges the live-account rule into a caller's own filter.
 *
 * `where.user` may be a relation filter or a `null`/`is`/`isNot` shorthand, so
 * it is only spread when it is a plain object.
 */
export function scopeToLiveEmployees(
  where: Prisma.EmployeeWhereInput = {}
): Prisma.EmployeeWhereInput {
  const existing =
    where.user && typeof where.user === "object" ? (where.user as Prisma.UserWhereInput) : {};
  return { ...where, user: { ...existing, deletedAt: null } };
}
