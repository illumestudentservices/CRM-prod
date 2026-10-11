import { db } from "@/lib/db";
import type { AttachmentParentType, Role } from "@prisma/client";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { canSeeTask } from "@/lib/task-visibility";

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
  /**
   * Optional: READ access granted by owning the row, without the module
   * permission.
   *
   * ★ OPT-IN, AND ONLY OPT-IN.
   *
   * `resource` answers "may this role work with this module", and it is
   * checked BEFORE canAccessRow — so for EMPLOYEE_DOCUMENT, whose resource is
   * erp_hr, an ordinary employee was refused at the module gate and the
   * ownership rule below it never ran. They could not read their own
   * contract.
   *
   * The fix is NOT to let canAccessRow override the module check generally:
   * it returns true for every parent type that does not define one, so that
   * would quietly delete the gate for the shared types. Each type that wants
   * ownership to be sufficient says so here, for reads only. Writing still
   * needs the module permission.
   */
  ownerCanRead?: (
    parentId: string,
    actor: { userId: string; role: Role }
  ) => Promise<boolean>;
  /** As ownerCanRead, for uploading. Opt-in, per type. */
  ownerCanWrite?: (
    parentId: string,
    actor: { userId: string; role: Role }
  ) => Promise<boolean>;
  /**
   * Optional: a filter on the INDIVIDUAL FILE, applied after the row gate.
   *
   * ★ WHY A THIRD LAYER.
   *
   * `resource` asks about the module, `canAccessRow` about the record. Both
   * are about reaching the same place, and for a staff record two people
   * legitimately reach it — the employee and the line manager who acts as
   * their HR. What differs is which files each may see once there: the
   * employee's own uploads are not the manager's business.
   *
   * Without this the only choices are "manager sees nothing on the record" or
   * "manager sees the doctor's note", and neither is right.
   */
  canSeeAttachment?: (
    attachment: { uploadedById: string | null },
    parentId: string,
    actor: { userId: string; role: Role }
  ) => Promise<boolean>;
}

/**
 * What this actor is to the employee whose record it is.
 *
 * ★ THERE IS NO HR FUNCTION AT ILLUME. THE LINE MANAGER IS IT.
 *
 * So a manager has to be able to put a contract on their report's record —
 * and must NOT be able to read what that person filed there themselves. The
 * two directions are different, which is why this returns a relation rather
 * than a boolean: "may they touch this record" and "may they see this file"
 * have different answers for the same person.
 */
export type EmployeeRecordRelation = "self" | "manager" | "admin" | "none";

export async function employeeRecordRelation(
  employeeId: string,
  actor: { userId: string; role: Role },
): Promise<EmployeeRecordRelation> {
  const employee = await db.employee.findFirst({
    where: { id: employeeId },
    select: { id: true, userId: true, managerId: true },
  });
  if (!employee) return "none";

  if (employee.userId === actor.userId) return "self";

  if (employee.managerId) {
    const actorEmployee = await db.employee.findFirst({
      where: { userId: actor.userId },
      select: { id: true },
    });
    if (actorEmployee && actorEmployee.id === employee.managerId) return "manager";
  }

  /**
   * ★ erp_hr:WRITE, NOT :read.
   *
   * read is held by HQ_EXECUTIVE — eight people, including two Client
   * Relations directors and the Marketing Director. Keying "admin" off it
   * meant all eight could read every employee's private uploads: the file
   * somebody put on their own record precisely because it was theirs.
   *
   * write is held by SUPER_ADMIN and HR_MANAGER — the people who maintain
   * staff records, which is the job that needs to see what is on one. It
   * stays a permission rather than a role list, so it can be moved in
   * Settings -> Security without a deploy.
   */
  if (await effectiveHasPermission(actor.role, "erp_hr", "write")) return "admin";

  return "none";
}

const CONTEXTS: Record<AttachmentParentType, ParentContext> = {
  /**
   * One person's own staff record. The tightest rule in this registry.
   *
   * ★ EXCLUSIVE TO THE PERSON AND HR. NOT THE LINE MANAGER.
   *
   * What goes on a staff record is a contract, a passport scan, a visa, a
   * medical note, a disciplinary letter. `erp_hr` already answers "may this
   * role work with HR records at all" — SUPER_ADMIN and HR_MANAGER, with
   * HQ_EXECUTIVE read-only — and that is the right gate for an administrator.
   *
   * What it does NOT do is let somebody read their own file, so the owner is
   * added here by employee id.
   *
   * A manager is deliberately absent. They can be added later if the business
   * asks; it cannot be taken back once somebody has read a colleague's visa.
   * The same reasoning removed a manager clause from TASK below, hours after
   * it was added.
   */
  EMPLOYEE_DOCUMENT: {
    label: "Employee record",
    resource: "erp_hr",
    exists: async (id) =>
      (await db.employee.findFirst({
        where: { id, user: { deletedAt: null } },
        select: { id: true },
      })) !== null,
    canAccessRow: async (id, actor) =>
      (await employeeRecordRelation(id, actor)) !== "none",
    /** The person, their manager, or an administrator. */
    ownerCanRead: async (id, actor) =>
      (await employeeRecordRelation(id, actor)) !== "none",
    /** Same three may add a file. Who can then READ it is the next rule. */
    ownerCanWrite: async (id, actor) =>
      (await employeeRecordRelation(id, actor)) !== "none",
    /**
     * ★ THE PRIVACY RULE, AND IT IS NOT SYMMETRIC.
     *
     *   the employee   sees everything on their own record — what they filed
     *                  and what their manager filed for them
     *   their manager  sees ONLY what they uploaded themselves
     *   an admin       sees everything
     *
     * A manager acting as HR needs to put a contract on the record and see it
     * again. They have no business reading what the person chose to keep
     * there — a doctor's note, a grievance, a passport scan. Row-level access
     * cannot express that, because both parties legitimately reach the same
     * record; the split is per FILE, by who uploaded it.
     */
    canSeeAttachment: async (att, parentId, actor) => {
      const rel = await employeeRecordRelation(parentId, actor);
      if (rel === "self" || rel === "admin") return true;
      if (rel === "manager") return att.uploadedById === actor.userId;
      return false;
    },
  },

  TASK: {
    label: "Task",
    resource: "tasks",
    exists: async (id) =>
      (await db.task.findFirst({ where: { id, deletedAt: null }, select: { id: true } })) !== null,
    /**
     * Exactly the people who can see the task: the assignee and whoever
     * allocated it. Nothing else — the files cannot be visible more widely
     * than the task they hang off, so this delegates to the one rule in
     * lib/task-visibility.ts rather than restating it.
     *
     * Two clauses were removed on 2026-10-09, hours after being added: a
     * `tasks:approve` escape hatch, and the assignee's line manager. The
     * manager clause looked harmless — they are the only person who may
     * allocate the task — but a manager who did NOT allocate it has no claim
     * on it, and leaving the clause in would have made the attachment gate
     * quietly wider than the task list above it.
     */
    canAccessRow: async (id, actor) => canSeeTask(actor.userId, id),
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

/**
 * May this actor READ this parent's attachments — by module permission, or by
 * owning the row where the type allows that.
 *
 * Read routes call this instead of canReadParent so the owner clause cannot
 * be forgotten in one of them.
 */
/**
 * May this actor UPLOAD to this parent — by module permission, or by their
 * relationship to the row where the type allows it.
 */
export async function mayWriteParentRow(
  parentType: AttachmentParentType,
  parentId: string,
  actor: { userId: string; role: Role }
): Promise<boolean> {
  if (await canWriteParent(actor.role, parentType)) return true;
  const ctx = CONTEXTS[parentType];
  if (!ctx.ownerCanWrite) return false;
  return ctx.ownerCanWrite(parentId, actor);
}

/**
 * May this actor see this ONE file?
 *
 * Types without a `canSeeAttachment` return true — reaching the record was
 * always the whole answer for them, and still is.
 */
export async function maySeeAttachment(
  parentType: AttachmentParentType,
  parentId: string,
  attachment: { uploadedById: string | null },
  actor: { userId: string; role: Role }
): Promise<boolean> {
  const ctx = CONTEXTS[parentType];
  if (!ctx.canSeeAttachment) return true;
  return ctx.canSeeAttachment(attachment, parentId, actor);
}

export async function mayReadParentRow(
  parentType: AttachmentParentType,
  parentId: string,
  actor: { userId: string; role: Role }
): Promise<boolean> {
  if (await canReadParent(actor.role, parentType)) return true;
  const ctx = CONTEXTS[parentType];
  if (!ctx.ownerCanRead) return false;
  return ctx.ownerCanRead(parentId, actor);
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
