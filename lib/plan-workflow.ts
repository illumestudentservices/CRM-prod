import { db } from "./db";
import type { RecruitmentPlanStatus, Role } from "@prisma/client";

/// Spec §3 — approval workflow state machine for Quarterly Recruitment Plans.
/// Each transition has an allowed set of roles and an allowed set of prior
/// states. Anything outside the map throws.

type Transition = {
  from: RecruitmentPlanStatus[];
  allowedRoles: Role[];
  timestampField?:
    | "regionalReviewedAt"
    | "accountReviewedAt"
    | "internalFinalReviewedAt"
    | "clientReviewedAt"
    | "approvedAt"
    | "activatedAt"
    | "completedAt"
    | "closedAt";
};

export const PLAN_TRANSITIONS: Record<RecruitmentPlanStatus, Transition> = {
  DRAFT: { from: ["RETURNED"], allowedRoles: ["ICR", "SUPER_ADMIN"] },
  SUBMITTED: { from: ["DRAFT", "RETURNED"], allowedRoles: ["ICR", "SUPER_ADMIN"] },
  REGIONAL_MANAGER_REVIEW: {
    from: ["SUBMITTED", "RETURNED"],
    allowedRoles: ["REGIONAL_MANAGER", "SUPER_ADMIN"],
    timestampField: "regionalReviewedAt",
  },
  ACCOUNT_MANAGER_REVIEW: {
    from: ["REGIONAL_MANAGER_REVIEW"],
    allowedRoles: ["HQ_EXECUTIVE", "SUPER_ADMIN"],
    timestampField: "accountReviewedAt",
  },
  INTERNAL_FINAL_REVIEW: {
    from: ["ACCOUNT_MANAGER_REVIEW"],
    allowedRoles: ["HQ_EXECUTIVE", "SUPER_ADMIN"],
    timestampField: "internalFinalReviewedAt",
  },
  CLIENT_REVIEW: {
    from: ["INTERNAL_FINAL_REVIEW"],
    allowedRoles: ["HQ_EXECUTIVE", "SUPER_ADMIN"],
    timestampField: "clientReviewedAt",
  },
  APPROVED: {
    from: ["INTERNAL_FINAL_REVIEW", "CLIENT_REVIEW"],
    allowedRoles: ["HQ_EXECUTIVE", "SUPER_ADMIN"],
    timestampField: "approvedAt",
  },
  ACTIVE: { from: ["APPROVED"], allowedRoles: ["SUPER_ADMIN", "HQ_EXECUTIVE"], timestampField: "activatedAt" },
  COMPLETED: { from: ["ACTIVE"], allowedRoles: ["SUPER_ADMIN", "REGIONAL_MANAGER", "HQ_EXECUTIVE"], timestampField: "completedAt" },
  CLOSED: { from: ["COMPLETED"], allowedRoles: ["SUPER_ADMIN"], timestampField: "closedAt" },
  RETURNED: {
    from: ["REGIONAL_MANAGER_REVIEW", "ACCOUNT_MANAGER_REVIEW", "INTERNAL_FINAL_REVIEW", "CLIENT_REVIEW"],
    allowedRoles: ["REGIONAL_MANAGER", "HQ_EXECUTIVE", "SUPER_ADMIN"],
  },
};

export function canTransition(role: Role, from: RecruitmentPlanStatus, to: RecruitmentPlanStatus): { ok: boolean; reason?: string } {
  const transition = PLAN_TRANSITIONS[to];
  if (!transition) return { ok: false, reason: `Unknown target status: ${to}` };
  if (!transition.from.includes(from)) return { ok: false, reason: `Cannot go from ${from} to ${to}` };
  if (!transition.allowedRoles.includes(role)) return { ok: false, reason: `Role ${role} not allowed to make this transition` };
  return { ok: true };
}

/// Spec §7 — when a plan becomes APPROVED, generate PlannedFieldActivity
/// placeholders for each activity type. This gives the Field Operations
/// module something to schedule against.
export async function activatePlan(planId: string): Promise<void> {
  const plan = await db.quarterlyRecruitmentPlan.findUnique({
    where: { id: planId },
    include: { plannedFieldActivities: true, plannedTravel: true },
  });
  if (!plan || plan.status !== "APPROVED") return;

  // Materialise Travel records from planned travel entries
  for (const pt of plan.plannedTravel) {
    if (pt.activatedTravelRequestId) continue;
    const tr = await db.travelRequest.create({
      data: {
        employeeId: plan.icrId,
        destination: pt.destination,
        purpose: pt.purpose,
        departDate: pt.plannedStart,
        returnDate: pt.plannedEnd,
        estimatedCost: pt.estimatedCost ?? undefined,
        status: "APPROVED",
        approvedById: plan.icrId,
        approvedAt: new Date(),
      },
    });
    await db.plannedTravel.update({
      where: { id: pt.id },
      data: { activatedAt: new Date(), activatedTravelRequestId: tr.id },
    });
  }

  await db.quarterlyRecruitmentPlan.update({
    where: { id: planId },
    data: { status: "ACTIVE", activatedAt: new Date() },
  });
}
