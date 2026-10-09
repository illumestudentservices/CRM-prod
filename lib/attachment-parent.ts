import { db } from "@/lib/db";
import type { AttachmentParentType, Role } from "@prisma/client";
import { effectiveHasPermission } from "@/lib/effective-permissions";

/**
 * Polymorphic attachments — parent existence + access gate.
 *
 * Every attachment upload/download/list route funnels through this file so
 * the permission logic for "can this user attach to / read attachments on
 * this parent record" lives in one place. If the parent enum grows, this is
 * the one file that changes.
 *
 * Design rules:
 *
 *   1. Existence check first: an attachment can't point at a parent that
 *      doesn't exist (or has been soft-deleted). Refuses with 404 in the
 *      caller so an attacker can't enumerate IDs against a permission gate.
 *
 *   2. Two permission verbs — READ and WRITE:
 *      - READ  gates listing + download.
 *      - WRITE gates uploading and deleting other people's attachments.
 *      The caller can always delete an attachment they themselves uploaded.
 *
 *   3. Permission mapping mirrors the parent module's own permission
 *      matrix — e.g. attachments on a Task follow `tasks:*`, on an
 *      Activity follow `field_operations:*`, on a Client Issue follow
 *      `institutions:*`. This keeps attachments consistent with the rest
 *      of the module and prevents surprising bypasses.
 *
 *   4. Existence lookups deliberately skip `include: {}` — we only need
 *      the ID to prove the row exists.
 */

export interface ParentContext {
  /** Human label for error messages. */
  label: string;
  /** Permission resource string used by `effectiveHasPermission`. */
  resource:
    | "leads"
    | "sources"
    | "institutions"
    | "events"
    | "reports"
    | "analytics"
    | "executive_dashboard"
    | "erp"
    | "erp_hr"
    | "users"
    | "settings"
    | "announcements"
    | "knowledge_base"
    | "whatsapp"
    | "markets"
    | "stakeholders"
    | "activities"
    | "travel"
    | "risk_compliance"
    | "knowledge"
    | "tasks"
    | "recruitment_network"
    | "recruitment_planning"
    | "market_intelligence"
    | "field_operations";
  /** Function that returns true when the parent row exists (and isn't
      soft-deleted). Runs before any permission check so the response for
      "not found" and "not permitted" don't diverge. */
  exists: (parentId: string) => Promise<boolean>;
  /**
   * Optional gate on the SPECIFIC ROW, applied on top of the module
   * permission.
   *
   * ★ WHY THIS WAS ADDED (2026-10-09).
   *
   * `resource` + read/write answers "may this ROLE touch this module", and
   * every role that can open the Tasks page holds `tasks:read`. Nothing asked
   * whether the caller had anything to do with THIS record. Measured against
   * the live code, an ordinary EMPLOYEE could list, download, upload to and
   * delete the attachments on ANY task in the company, given its id — all four
   * returned 200.
   *
   * A task can carry a performance note, a contract or a student's paperwork,
   * so module-level permission is the wrong granularity for it. Where a parent
   * type has an owner, it says so here. Returning undefined keeps the previous
   * behaviour, which is correct for the parent types that are genuinely
   * shared, like a recruitment event.
   */
  canAccessRow?: (
    parentId: string,
    actor: { userId: string; role: Role }
  ) => Promise<boolean>;
}

const CONTEXTS: Record<AttachmentParentType, ParentContext> = {
  TASK: {
    label: "Task",
    resource: "tasks",
    exists: async (id) =>
      (await db.task.findFirst({ where: { id, deletedAt: null }, select: { id: true } })) !== null,
    /**
     * The people a task belongs to: whoever it is assigned to, whoever raised
     * it, and the assignee's line manager.
     *
     * The first two mirror what GET /api/tasks already returns to an ordinary
     * caller, so the files follow the task rather than being visible more
     * widely than the task itself. The manager is included because they are
     * the only person who may assign the task in the first place, and a brief
     * they cannot read is not a brief.
     *
     * `tasks:approve` is the existing org-wide escalation — the same
     * permission that lets GET /api/tasks?scope=all see every task, held by
     * SUPER_ADMIN only unless Settings → Security says otherwise.
     */
    canAccessRow: async (id, actor) => {
      if (await effectiveHasPermission(actor.role, "tasks", "approve")) return true;

      const me = await db.employee.findFirst({
        where: { userId: actor.userId },
        select: { id: true },
      });
      if (!me) return false;

      const task = await db.task.findFirst({
        where: { id, deletedAt: null },
        select: {
          assigneeId: true,
          createdById: true,
          assignee: { select: { managerId: true } },
        },
      });
      if (!task) return false;

      return (
        task.assigneeId === me.id ||
        task.createdById === me.id ||
        task.assignee?.managerId === me.id
      );
    },
  },
  ACTIVITY: {
    label: "Field Operation",
    resource: "field_operations",
    exists: async (id) =>
      (await db.activity.findFirst({ where: { id, deletedAt: null }, select: { id: true } })) !== null,
  },
  CLIENT_ISSUE: {
    label: "Client Issue",
    resource: "institutions",
    exists: async (id) =>
      (await db.clientIssue.findUnique({ where: { id }, select: { id: true } })) !== null,
  },
  RECRUITMENT_EVENT: {
    label: "Recruitment Event",
    resource: "events",
    exists: async (id) =>
      (await db.event.findFirst({ where: { id, deletedAt: null }, select: { id: true } })) !== null,
  },
  MARKETING_CAMPAIGN: {
    label: "Marketing Campaign",
    resource: "recruitment_network",
    exists: async (id) =>
      (await db.campaign.findFirst({ where: { id, deletedAt: null }, select: { id: true } })) !== null,
  },
  RECRUITMENT_PARTNER: {
    label: "Recruitment Partner",
    resource: "recruitment_network",
    exists: async (id) =>
      (await db.recruitmentPartner.findFirst({
        where: { id, deletedAt: null },
        select: { id: true },
      })) !== null,
  },
  MARKET_UPDATE_SUGGESTION: {
    label: "Market Update Suggestion",
    resource: "market_intelligence",
    exists: async (id) =>
      (await db.marketUpdateSuggestion.findUnique({ where: { id }, select: { id: true } })) !== null,
  },
  RECRUITMENT_PLAN: {
    label: "Recruitment Plan",
    resource: "recruitment_planning",
    exists: async (id) =>
      (await db.quarterlyRecruitmentPlan.findUnique({ where: { id }, select: { id: true } })) !== null,
  },
  VARIATION_REQUEST: {
    label: "Variation Request",
    resource: "recruitment_planning",
    exists: async (id) =>
      (await db.variationRequest.findUnique({ where: { id }, select: { id: true } })) !== null,
  },
  MONTHLY_REPORT: {
    label: "Monthly Report",
    resource: "reports",
    exists: async (id) =>
      (await db.monthlyReport.findFirst({ where: { id, deletedAt: null }, select: { id: true } })) !== null,
  },
  ICR_MONTHLY_REPORT: {
    // §7 of the ICR report template — "Snapshots": up to five photos from
    // events, school visits or partner meetings during the period.
    label: "ICR Monthly Report",
    resource: "reports",
    exists: async (id) =>
      (await db.icrMonthlyReport.findFirst({ where: { id, deletedAt: null }, select: { id: true } })) !== null,
  },
  ENGAGEMENT_LOG: {
    label: "Engagement Log entry",
    resource: "institutions",
    exists: async (id) =>
      (await db.engagementLog.findUnique({ where: { id }, select: { id: true } })) !== null,
  },
  LEAD_NOTE: {
    label: "Lead Note",
    resource: "leads",
    exists: async (id) =>
      (await db.leadNote.findUnique({ where: { id }, select: { id: true } })) !== null,
  },
  LEAD: {
    label: "Lead",
    resource: "leads",
    exists: async (id) =>
      (await db.lead.findFirst({ where: { id, deletedAt: null }, select: { id: true } })) !== null,
  },
  INSTITUTION_INTEREST: {
    label: "Institution Interest",
    resource: "leads",
    exists: async (id) =>
      (await db.institutionInterest.findUnique({ where: { id }, select: { id: true } })) !== null,
  },
  RISK_REGISTER: {
    label: "Risk Register entry",
    resource: "risk_compliance",
    exists: async (id) =>
      (await db.riskRegister.findUnique({ where: { id }, select: { id: true } })) !== null,
  },
  COMPLIANCE_ITEM: {
    label: "Compliance Item",
    resource: "risk_compliance",
    exists: async (id) =>
      (await db.complianceItem.findUnique({ where: { id }, select: { id: true } })) !== null,
  },
  ACCOUNT_INTERVENTION: {
    label: "Account Intervention",
    resource: "institutions",
    exists: async (id) =>
      (await db.accountIntervention.findUnique({ where: { id }, select: { id: true } })) !== null,
  },
  QUARTERLY_BUSINESS_REVIEW: {
    label: "QBR",
    resource: "reports",
    exists: async (id) =>
      (await db.quarterlyBusinessReview.findUnique({ where: { id }, select: { id: true } })) !== null,
  },
};

export function attachmentContext(parentType: AttachmentParentType): ParentContext {
  return CONTEXTS[parentType];
}

export async function canReadParent(
  role: Role,
  parentType: AttachmentParentType
): Promise<boolean> {
  const ctx = CONTEXTS[parentType];
  return effectiveHasPermission(role, ctx.resource, "read");
}

export async function canWriteParent(
  role: Role,
  parentType: AttachmentParentType
): Promise<boolean> {
  const ctx = CONTEXTS[parentType];
  return effectiveHasPermission(role, ctx.resource, "write");
}

/**
 * The row-level half of the gate, for parent types that define one.
 *
 * True when the type has no `canAccessRow` — the module permission was the
 * whole answer for those, and still is. Every attachment route calls this
 * after its canRead/canWrite check; a route that skipped it would silently
 * reopen the hole the hook was added to close, which is why it is a named
 * function rather than four inline lookups.
 */
export async function canAccessParentRow(
  parentType: AttachmentParentType,
  parentId: string,
  actor: { userId: string; role: Role }
): Promise<boolean> {
  const ctx = CONTEXTS[parentType];
  if (!ctx.canAccessRow) return true;
  return ctx.canAccessRow(parentId, actor);
}
