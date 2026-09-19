import { db } from "@/lib/db";
import { RECEIVING_ROLES } from "@/lib/workload-reassignment";

/**
 * Who a picker may offer as the owner of a record.
 *
 * Every one of these dropdowns used to run its own `db.user.findMany({ role:
 * "ICR" })`. That predicate is wrong twice over:
 *
 *  1. Production has ZERO users with role ICR — it runs on HQ_EXECUTIVE,
 *     REGIONAL_MANAGER and SUPER_ADMIN. So the list came back empty and the
 *     pickers were dead: "Assign ICR" opened an empty popover with a
 *     permanently disabled confirm button, and `lead-form.tsx` hides the
 *     "Assigned ICR" field entirely when the list is empty, so the field did
 *     not exist at all. The mirror HAS ICR users, which is why this looked
 *     fine in every test.
 *  2. Ownership is not a role. A lead already assigned to an HQ_EXECUTIVE
 *     could not be represented by a list that only contains ICRs, so an edit
 *     form would silently render "unassigned" over a record that is assigned.
 *
 * `account-health-card.tsx` and `client-issues-panel.tsx` already carry
 * comments about their pickers sitting "empty with only its placeholder" —
 * this is the same bug, third time.
 *
 * The two predicates below are deliberately DIFFERENT. Do not merge them.
 */

export type AssignableUser = {
  id: string;
  name: string | null;
  image: string | null;
};

const SELECT = { id: true, name: true, image: true } as const;

/**
 * Builds the `where` for an owner picker.
 *
 * `alsoInclude` is for edit forms: the record's CURRENT owner is always
 * offered, even if they have since been deactivated or their role no longer
 * qualifies. Without it the form cannot render its own value, which is how a
 * populated field comes to look empty. Those ids bypass `isActive` for exactly
 * that reason — but never `deletedAt`, since a deleted user should be moved on
 * via the reassignment flow, not silently re-offered.
 */
function ownerWhere(
  qualifies: object,
  alsoInclude: readonly (string | null | undefined)[]
) {
  const current = [...new Set(alsoInclude.filter((v): v is string => !!v))];
  return {
    deletedAt: null,
    // Applied ABOVE the union, so `alsoInclude` cannot reintroduce an external
    // client contact. Nothing validates the role behind Event.assignedICRId
    // (app/api/events/route.ts:176 writes whatever id it is given), so a client
    // could in principle already be recorded as an owner — offering them back
    // would let a wrong value be re-confirmed rather than corrected.
    role: { not: "INSTITUTION_CLIENT" as const },
    OR: [
      { isActive: true, ...qualifies },
      ...(current.length ? [{ id: { in: current } }] : []),
    ],
  };
}

/**
 * Users who may OWN A LEAD.
 *
 * Narrower than "internal staff" because of a trap in `canAccessLead`
 * (lib/lead-access.ts): its switch returns false in `default:`, so
 * ADMISSIONS_SUPPORT, ACCOUNT_MANAGER and VP_GLOBAL_SALES cannot open a lead
 * even though ADMISSIONS_SUPPORT holds `leads:write` in PERMISSION_MATRIX.
 * Assigning a lead to one of them produces a record its own owner gets a 403
 * on — invisible to them, recoverable only by a SUPER_ADMIN.
 *
 * So this must NOT be derived from "has leads:write". `RECEIVING_ROLES` is
 * already the vetted intersection (the offboarding reassignment flow uses it)
 * and every role in it passes `canAccessLead`.
 */
export function leadOwnerOptions(
  alsoInclude: readonly (string | null | undefined)[] = []
): Promise<AssignableUser[]> {
  return db.user.findMany({
    where: ownerWhere({ role: { in: [...RECEIVING_ROLES] } }, alsoInclude),
    select: SELECT,
    orderBy: { name: "asc" },
  });
}

/**
 * Users who may OWN AN EVENT.
 *
 * Wider than lead ownership: nothing scopes event reads by `assignedICRId`, so
 * there is no equivalent of the `canAccessLead` trap and no reason to keep an
 * HQ Executive from running an event.
 *
 * Matches `/api/institutions/owner-options` — which `participation-panel.tsx`
 * already calls for the per-institution "Consultant" picker ON THE EVENT DETAIL
 * PAGE. Using anything else here would leave two dropdowns on one screen
 * disagreeing about who exists, which is the state this fixes.
 *
 * Any active internal user qualifies; the INSTITUTION_CLIENT exclusion is
 * applied for both predicates in `ownerWhere`.
 */
export function eventOwnerOptions(
  alsoInclude: readonly (string | null | undefined)[] = []
): Promise<AssignableUser[]> {
  return db.user.findMany({
    where: ownerWhere({}, alsoInclude),
    select: SELECT,
    orderBy: { name: "asc" },
  });
}
