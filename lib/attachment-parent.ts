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
}

const CONTEXTS: Record<AttachmentParentType, ParentContext> = {
  TASK: {
    label: "Task",
    resource: "tasks",
    exists: async (id) =>
      (await db.task.findFirst({ where: { id, deletedAt: null }, select: { id: true } })) !== null,
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
