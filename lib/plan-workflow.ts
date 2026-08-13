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
  /**
   * Which column records WHO performed this step.
   *
   * The timestamps above were being written while these stayed permanently
   * null, so a plan could show that it had been through Account Manager Review
   * without recording who reviewed it — useless for a budget approval trail.
   */
  reviewerField?: "regionalManagerId" | "accountManagerId" | "vpReviewerId";
};

export const PLAN_TRANSITIONS: Record<RecruitmentPlanStatus, Transition> = {
  DRAFT: { from: ["RETURNED"], allowedRoles: ["ICR", "SUPER_ADMIN"] },
  SUBMITTED: { from: ["DRAFT", "RETURNED"], allowedRoles: ["ICR", "SUPER_ADMIN"] },
  REGIONAL_MANAGER_REVIEW: {
    from: ["SUBMITTED", "RETURNED"],
    allowedRoles: ["REGIONAL_MANAGER", "SUPER_ADMIN"],
    timestampField: "regionalReviewedAt",
    reviewerField: "regionalManagerId",
  },
  /**
   * Spec §3: "Account Manager: client alignment and budget review".
   *
   * This step used to permit HQ_EXECUTIVE and NOT ACCOUNT_MANAGER, so the step
   * named after the role could not be performed by it. The role's own
   * definition in the Role enum says it "approves plans before client
   * submission" — it was created for this and never wired in.
   *
   * HQ_EXECUTIVE is deliberately NOT here. It holds every step below, so
   * leaving it here let one HQ Executive take a plan from Account Manager
   * Review all the way to APPROVED alone — a quarterly budget signed off
   * end-to-end by a single person. Requiring an ACCOUNT_MANAGER here and a
   * VP/HQ below means two people are always involved.
   */
  ACCOUNT_MANAGER_REVIEW: {
    from: ["REGIONAL_MANAGER_REVIEW"],
    allowedRoles: ["ACCOUNT_MANAGER", "SUPER_ADMIN"],
    timestampField: "accountReviewedAt",
    reviewerField: "accountManagerId",
  },
  /**
   * Spec §3: "VP Global Sales: notified and included in internal final
   * review". HQ_EXECUTIVE stays alongside the VP precisely because the spec
   * says *included in* rather than *sole approver* — this is the internal
   * senior review, not a single-owner gate.
   */
  INTERNAL_FINAL_REVIEW: {
    from: ["ACCOUNT_MANAGER_REVIEW"],
    allowedRoles: ["VP_GLOBAL_SALES", "HQ_EXECUTIVE", "SUPER_ADMIN"],
    timestampField: "internalFinalReviewedAt",
    reviewerField: "vpReviewerId",
  },
  CLIENT_REVIEW: {
    from: ["INTERNAL_FINAL_REVIEW"],
    allowedRoles: ["VP_GLOBAL_SALES", "HQ_EXECUTIVE", "SUPER_ADMIN"],
    timestampField: "clientReviewedAt",
  },
  APPROVED: {
    from: ["INTERNAL_FINAL_REVIEW", "CLIENT_REVIEW"],
    allowedRoles: ["VP_GLOBAL_SALES", "HQ_EXECUTIVE", "SUPER_ADMIN"],
    timestampField: "approvedAt",
  },
  ACTIVE: {
    from: ["APPROVED"],
    allowedRoles: ["VP_GLOBAL_SALES", "HQ_EXECUTIVE", "SUPER_ADMIN"],
    timestampField: "activatedAt",
  },
  COMPLETED: {
    from: ["ACTIVE"],
    allowedRoles: ["REGIONAL_MANAGER", "VP_GLOBAL_SALES", "HQ_EXECUTIVE", "SUPER_ADMIN"],
    timestampField: "completedAt",
  },
  CLOSED: { from: ["COMPLETED"], allowedRoles: ["SUPER_ADMIN"], timestampField: "closedAt" },
  /**
   * Every role that can advance a plan must also be able to send it back.
   * ACCOUNT_MANAGER and VP_GLOBAL_SALES are listed here for that reason: a
   * reviewer who can only push forward is not a reviewer, and omitting them
   * would have turned this fix into a one-way ratchet.
   */
  RETURNED: {
    from: ["REGIONAL_MANAGER_REVIEW", "ACCOUNT_MANAGER_REVIEW", "INTERNAL_FINAL_REVIEW", "CLIENT_REVIEW"],
    allowedRoles: [
      "REGIONAL_MANAGER",
      "ACCOUNT_MANAGER",
      "VP_GLOBAL_SALES",
      "HQ_EXECUTIVE",
      "SUPER_ADMIN",
    ],
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
    include: {
      plannedFieldActivities: true,
      plannedTravel: true,
      icr: { select: { id: true } },
    },
  });
  if (!plan || plan.status !== "APPROVED") return;

  // TravelRequest.employeeId references Employee, not User — the same trap
  // already noted for Task.createdById further down. Passing plan.icrId (a
  // User id) violated travel_requests_employeeId_fkey, so approving any plan
  // that had planned travel threw a 500 and left the plan stranded in
  // APPROVED: never ACTIVE, no travel raised, no field ops scheduled.
  //
  // Resolved once here. An ICR with no Employee row can't own a travel
  // request, so their travel is skipped rather than crashing the activation —
  // the rest of the plan still activates.
  const icrEmployee = await db.employee.findFirst({
    where: { userId: plan.icrId },
    select: { id: true },
  });

  if (icrEmployee) {
    // Materialise Travel records from planned travel entries
    for (const pt of plan.plannedTravel) {
      if (pt.activatedTravelRequestId) continue;
      const tr = await db.travelRequest.create({
        data: {
          employeeId: icrEmployee.id,
          destination: pt.destination,
          purpose: pt.purpose,
          departDate: pt.plannedStart,
          returnDate: pt.plannedEnd,
          estimatedCost: pt.estimatedCost ?? undefined,
          status: "APPROVED",
          // approvedById references User, which plan.icrId already is.
          approvedById: plan.icrId,
          approvedAt: new Date(),
        },
      });
      await db.plannedTravel.update({
        where: { id: pt.id },
        data: { activatedAt: new Date(), activatedTravelRequestId: tr.id },
      });
    }
  } else if (plan.plannedTravel.length > 0) {
    console.warn(
      `[activatePlan] plan ${planId}: ICR ${plan.icrId} has no Employee row; ` +
      `${plan.plannedTravel.length} planned travel item(s) not materialised`
    );
  }

  // Spec §7 (Recruitment Planning) — materialise a PLANNED Field Operation
  // stub for each PlannedFieldActivity that hasn't produced one yet. This is
  // the promised auto-scheduling: Field Ops now has one row per planned
  // activity, ready for the ICR to schedule against.
  const quarterStart = new Date(plan.year, (plan.quarter - 1) * 3, 1);
  for (const pfa of plan.plannedFieldActivities) {
    if (pfa.activatedAt) continue;
    try {
      await db.activity.create({
        data: {
          type: mapPlannedTypeToActivityType(pfa.activityType),
          status: "PLANNED",
          planAlignment: "WITHIN_APPROVED_PLAN",
          title: `Planned: ${pfa.activityType} (Q${plan.quarter} ${plan.year})`,
          description: pfa.notes ?? undefined,
          date: quarterStart,
          userId: plan.icrId,
          institutionId: plan.institutionId,
          marketId: plan.marketId,
        },
      });
      await db.plannedFieldActivity.update({
        where: { id: pfa.id },
        data: { activatedAt: new Date() },
      });
    } catch (err) {
      console.error("[activatePlan] failed to materialise planned activity", pfa.id, err);
    }
  }

  // Spec Tasks §10 — fire task templates on plan activation ("Submit Plan",
  // "Update Budget", "Upload Client Approval", "Prepare Materials" etc.).
  // Task.createdById references Employee (not User), so resolve the ICR's
  // employee row before firing.
  try {
    const icrEmployee = await db.employee.findFirst({
      where: { userId: plan.icrId },
      select: { id: true },
    });
    if (icrEmployee) {
      const { fireEventTriggers } = await import("./task-workflow");
      await fireEventTriggers("RECRUITMENT_PLAN_ACTIVATED", {
        createdById: icrEmployee.id,
        assigneeId: icrEmployee.id,
        parentType: "RECRUITMENT_PLAN",
        parentId: plan.id,
      });
    }
  } catch (err) {
    console.error("[activatePlan] fireEventTriggers failed", err);
  }

  await db.quarterlyRecruitmentPlan.update({
    where: { id: planId },
    data: { status: "ACTIVE", activatedAt: new Date() },
  });
}

/// PlannedFieldActivity stores `activityType` as a free-text string per the
/// deferred enum-conversion note in migration 015. Map whatever the plan
/// contains onto a real ActivityType enum value, falling back to OTHER.
function mapPlannedTypeToActivityType(input: string): import("@prisma/client").ActivityType {
  const normalised = input.toUpperCase().replace(/\s+/g, "_");
  const known: Record<string, import("@prisma/client").ActivityType> = {
    SCHOOL_VISIT: "SCHOOL_VISIT",
    AGENT_MEETING: "AGENT_MEETING",
    AGENT_TRAINING: "AGENT_TRAINING",
    SCHOOL_PRESENTATION: "SCHOOL_PRESENTATION",
    CLIENT_MEETING: "CLIENT_MEETING",
    PARTNER_MEETING: "PARTNER_MEETING",
    MARKET_RESEARCH: "MARKET_RESEARCH",
    STUDENT_FOLLOW_UP_SESSION: "STUDENT_FOLLOW_UP_SESSION",
    EVENT_PREPARATION: "EVENT_PREPARATION",
    EVENT_FOLLOW_UP: "EVENT_FOLLOW_UP",
    REPORT_SUBMISSION: "REPORT_SUBMISSION",
    DELEGATION_SUPPORT: "DELEGATION_SUPPORT",
    INTERNAL_REVIEW: "INTERNAL_REVIEW",
    // Common plan spellings that don't map 1:1 to ActivityType (which
    // deliberately omits event-attendance types per spec §4).
    WEBINAR: "AGENT_TRAINING",
    COUNSELLOR_TRAINING: "AGENT_TRAINING",
    STUDENT_PRESENTATION: "STUDENT_FOLLOW_UP_SESSION",
  };
  return known[normalised] ?? "OTHER";
}
