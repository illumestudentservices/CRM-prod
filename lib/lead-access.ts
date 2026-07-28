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
  role: Role
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
      return !!lead.institutionId;
    default:
      return false;
  }
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
