import { db } from "./db";
import type { TaskParentType, TaskCategory, TaskPriority, Prisma } from "@prisma/client";

/// Spec §1 Tasks — every task must have a parent record unless it's PERSONAL.
/// This helper is called by every task-writing route to enforce that invariant.
export function requiresParent(category: TaskCategory): boolean {
  return category !== "PERSONAL" && category !== "INTERNAL";
}

/// Given a parentType + parentId, verify the parent row exists. Returns null
/// if the parent is valid, or an error message.
export async function validateTaskParent(
  parentType: TaskParentType | null | undefined,
  parentId: string | null | undefined,
): Promise<string | null> {
  if (!parentType || !parentId) return "parentType and parentId are both required";

  switch (parentType) {
    case "STUDENT": {
      const r = await db.lead.findFirst({ where: { id: parentId, deletedAt: null }, select: { id: true } });
      return r ? null : "Student not found";
    }
    case "INSTITUTION_INTEREST": {
      const r = await db.institutionInterest.findUnique({ where: { id: parentId }, select: { id: true } });
      return r ? null : "Institution Interest not found";
    }
    case "INSTITUTION": {
      const r = await db.institution.findFirst({ where: { id: parentId, deletedAt: null }, select: { id: true } });
      return r ? null : "Institution not found";
    }
    case "RECRUITMENT_PARTNER": {
      const r = await db.recruitmentPartner.findFirst({ where: { id: parentId, deletedAt: null }, select: { id: true } });
      return r ? null : "Recruitment Partner not found";
    }
    case "RECRUITMENT_EVENT": {
      const r = await db.event.findFirst({ where: { id: parentId, deletedAt: null }, select: { id: true } });
      return r ? null : "Recruitment Event not found";
    }
    case "MARKETING_CAMPAIGN": {
      const r = await db.campaign.findFirst({ where: { id: parentId, deletedAt: null }, select: { id: true } });
      return r ? null : "Campaign not found";
    }
    case "FIELD_OPERATION": {
      const r = await db.activity.findFirst({ where: { id: parentId, deletedAt: null }, select: { id: true } });
      return r ? null : "Field Operation not found";
    }
    case "MARKET": {
      const r = await db.market.findFirst({ where: { id: parentId, deletedAt: null }, select: { id: true } });
      return r ? null : "Market not found";
    }
    case "MONTHLY_REPORT": {
      const r = await db.monthlyReport.findFirst({ where: { id: parentId, deletedAt: null }, select: { id: true } });
      return r ? null : "Monthly Report not found";
    }
    case "RECRUITMENT_PLAN": {
      const r = await db.quarterlyRecruitmentPlan.findUnique({ where: { id: parentId }, select: { id: true } });
      return r ? null : "Recruitment Plan not found";
    }
    case "VARIATION_REQUEST": {
      const r = await db.variationRequest.findUnique({ where: { id: parentId }, select: { id: true } });
      return r ? null : "Variation Request not found";
    }
    case "TRAVEL_RECORD": {
      const r = await db.travelRequest.findUnique({ where: { id: parentId }, select: { id: true } });
      return r ? null : "Travel Record not found";
    }
    case "CLIENT_ISSUE": {
      // Spec §9 (Clients) — CLIENT_ISSUE now points at the new ClientIssue
      // model (created in migration 019). The pre-migration path used
      // RiskRegister as a stand-in.
      const r = await db.clientIssue.findUnique({ where: { id: parentId }, select: { id: true } });
      return r ? null : "Client Issue not found";
    }
    default:
      return "Unknown parent type";
  }
}

/// Spec §16 — template firing. Called by the event bus (or manually via API)
/// to create N task instances from one template. Each item can specify an
/// offsetDays relative to a base date (defaults to now).
export interface TemplateItemSpec {
  title: string;
  description?: string;
  offsetDays?: number;
  priority?: TaskPriority;
}

export async function fireTaskTemplate(
  templateId: string,
  opts: {
    assigneeId?: string;
    createdById: string;
    parentType?: TaskParentType;
    parentId?: string;
    baseDate?: Date;
  },
): Promise<{ createdCount: number; taskIds: string[] }> {
  const template = await db.taskTemplate.findUnique({ where: { id: templateId } });
  if (!template || !template.isActive) return { createdCount: 0, taskIds: [] };

  const items = template.itemsJson as unknown as TemplateItemSpec[];
  if (!Array.isArray(items)) return { createdCount: 0, taskIds: [] };

  const base = opts.baseDate ?? new Date();
  const taskIds: string[] = [];

  for (const item of items) {
    const dueDate = new Date(base);
    if (item.offsetDays !== undefined) dueDate.setDate(dueDate.getDate() + item.offsetDays);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = {
      title: item.title,
      description: item.description,
      assigneeId: opts.assigneeId,
      createdById: opts.createdById,
      priority: item.priority ?? "MEDIUM",
      status: "NOT_STARTED",
      dueDate,
      category: template.category,
      recurrence: template.recurrence,
      templateId: template.id,
      parentType: opts.parentType ?? template.parentType,
      parentId: opts.parentId,
    };
    const t = await db.task.create({ data });
    taskIds.push(t.id);
  }

  return { createdCount: taskIds.length, taskIds };
}

/// Fires all templates matching a given triggerEvent. Called by the event bus
/// when significant business events happen.
export async function fireEventTriggers(
  triggerEvent: string,
  opts: { createdById: string; parentType?: TaskParentType; parentId?: string; assigneeId?: string },
): Promise<{ firedTemplates: number; createdTasks: number }> {
  const templates = await db.taskTemplate.findMany({ where: { triggerEvent, isActive: true } });
  let createdTasks = 0;
  for (const t of templates) {
    const r = await fireTaskTemplate(t.id, opts);
    createdTasks += r.createdCount;
  }
  return { firedTemplates: templates.length, createdTasks };
}
