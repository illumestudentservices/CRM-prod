import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { regionScopeVia } from "@/lib/region-scope";

/**
 * Object-level scope for a QuarterlyRecruitmentPlan and everything hanging off
 * it (budget items, planned travel/activities/events, variation requests,
 * transitions).
 *
 * `recruitment_planning:read`/`:write` is a MODULE grant. The list route
 * (app/api/recruitment-planning/plans/route.ts) narrows what a user actually
 * sees — an ICR to their own plans, a Regional Manager to their region's ICRs —
 * but the `plans/[id]` route and its child routes applied only the module check
 * and then fetched by id, so any holder could read OR tamper with a plan from
 * another region simply by changing the id in the URL. This is the single
 * definition of that scope, shared by the list and every by-id route.
 *
 * `in: []` semantics: a Regional Manager with no region gets `{ icr: { regionId:
 * <nothing matches> } }` via regionScope, i.e. no plans — not every plan.
 */
export function planScopeWhere(role: Role, userId: string, regionId: string | null) {
  switch (role) {
    case "ICR":
      return { icrId: userId };
    case "REGIONAL_MANAGER":
      return regionScopeVia("icr", regionId);
    default:
      // SUPER_ADMIN / HQ roles / VP / account managers — org-wide by design,
      // exactly as the list route serves them.
      return {};
  }
}

/**
 * True iff the plan exists AND is within this user's scope. Callers answer a
 * false with 404 (not 403) so a by-id route never confirms a plan exists to
 * someone not entitled to see it — a plan outside scope is indistinguishable
 * from a missing one.
 */
export async function planInScope(
  planId: string,
  role: Role,
  userId: string,
  regionId: string | null
): Promise<boolean> {
  const match = await db.quarterlyRecruitmentPlan.findFirst({
    where: { id: planId, ...planScopeWhere(role, userId, regionId) },
    select: { id: true },
  });
  return match !== null;
}
