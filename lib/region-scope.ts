/**
 * What does a Regional Manager without a region see?
 *
 * Nothing. This file exists so that answer is given once.
 *
 * It used to be spelled out at nine call sites in two different ways:
 *
 *     regionId ? { regionId } : {}                 // six routes
 *     { regionId: regionId ?? "__no_region__" }    // two routes
 *
 * Those are opposites. `{}` is not "no access", it is "no filter" — Prisma
 * returns every row in the table. Measured on the mirror, a Regional Manager
 * with `regionId` NULL saw all 54 students across every region, all monthly
 * reports, and analytics figures numerically identical to a SUPER_ADMIN's.
 *
 * The state is reachable rather than theoretical: `regionId` is nullable on
 * User and the users PATCH schema has it as `.nullable().optional()`, so
 * promoting someone to Regional Manager without picking a region produces it.
 * That is a plausible mistake to make while setting up accounts, and its
 * consequence was silent — the screens look right, they are just showing the
 * whole organisation.
 *
 * Failing closed makes the same mistake loud: the manager sees an empty screen,
 * someone assigns them a region, and it is fixed. Failing open makes it
 * invisible until it is a data-protection question.
 *
 * The roles that are *meant* to see everything (SUPER_ADMIN, HQ_*) must be
 * matched by their own `case` before reaching this helper — never by falling
 * through to it.
 */

/**
 * A region id that cannot match any row.
 *
 * Deliberately not a UUID: it must never collide with a real `regions.id`, and
 * it should be obvious in a query log that the filter was intentional rather
 * than a corrupted value.
 */
export const NO_REGION = "__no_region__";

/**
 * Region filter for a model with its own `regionId` column.
 *
 *     where: { ...regionScope(regionId), deletedAt: null }
 */
export function regionScope(regionId: string | null | undefined): { regionId: string } {
  return { regionId: regionId ?? NO_REGION };
}

/**
 * Region filter for a model that reaches the region through a relation, e.g.
 * an InstitutionInterest scoped by its Lead, or a plan scoped by its ICR.
 *
 *     where: regionScopeVia("lead", regionId)   // { lead: { regionId: ... } }
 */
export function regionScopeVia<K extends string>(
  relation: K,
  regionId: string | null | undefined
): Record<K, { regionId: string }> {
  return { [relation]: regionScope(regionId) } as Record<K, { regionId: string }>;
}

/**
 * Boolean form, for checking a row already loaded.
 *
 * A manager with no region matches nothing, so this returns false rather than
 * the `!regionId || ...` short-circuit it replaces — that read "no region means
 * every region", which is how a regionless manager could open any student by id.
 */
export function inRegion(
  row: { regionId: string | null },
  regionId: string | null | undefined
): boolean {
  return !!regionId && row.regionId === regionId;
}
