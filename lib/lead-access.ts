import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";

/**
 * Who may see and act on a lead.
 *
 * Extracted so the stage, activity and close routes all apply the same rule.
 * Previously each route carried its own copy, which is how the generic update
 * route ended up with no stage validation at all.
 */
export function canAccessLead(
  lead: { regionId: string | null; assignedICRId: string | null; institutionId: string | null },
  userId: string,
  regionId: string | null,
  role: Role,
  /**
   * Institutions this user is actually assigned to, via InstitutionUser.
   * Only consulted for INSTITUTION_CLIENT. Defaults to none so the check is
   * fail-closed: a caller that forgets to pass it denies rather than allows.
   */
  institutionIds: readonly string[] = []
): boolean {
  switch (role) {
    case "SUPER_ADMIN":
    case "HQ_EXECUTIVE":
    case "HQ_ANALYTICS":
      return true;
    case "REGIONAL_MANAGER":
      return !regionId || lead.regionId === regionId;
    case "ICR":
      return lead.assignedICRId === userId;
    case "INSTITUTION_CLIENT":
      // Must be a lead belonging to one of THIS client's institutions.
      // This previously read `return !!lead.institutionId`, which was true for
      // any lead attached to any institution — so one client could read every
      // other client's students by walking ids.
      return !!lead.institutionId && institutionIds.includes(lead.institutionId);
    default:
      return false;
  }
}

/**
 * Institution ids an INSTITUTION_CLIENT is assigned to. Returns [] for every
 * other role, so callers can pass the result unconditionally.
 */
export async function institutionIdsForUser(userId: string, role: Role): Promise<string[]> {
  if (role !== "INSTITUTION_CLIENT") return [];
  const rows = await db.institutionUser.findMany({
    where: { userId, assignmentStatus: "ACTIVE" },
    select: { institutionId: true },
  });
  return rows.map((r) => r.institutionId);
}

/**
 * Loads everything the stage gate needs in one round trip: the lead, its live
 * engagement activities, the active application, and the checklist.
 */
export async function loadLeadForGate(id: string) {
  return db.lead.findFirst({
    where: { id, deletedAt: null },
    include: {
      assignedICR: { select: { id: true, name: true, email: true } },
      institution: { select: { id: true, name: true } },
      activities: {
        where: { kind: "ENGAGEMENT", cancelledAt: null },
        orderBy: { createdAt: "desc" },
      },
      applications: { where: { isActive: true }, take: 1 },
      checklistItems: { select: { category: true } },
    },
  });
}
