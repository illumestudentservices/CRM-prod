import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { canAccessLead } from "@/lib/lead-access";
import { logActivity } from "@/lib/activity-logger";

/**
 * Scheduling and completing lead engagements.
 *
 * These are what satisfy the pipeline's universal rule, so this endpoint has to
 * exist alongside the gate — without a way to record engagements, every lead
 * would be permanently blocked at its current stage.
 */

const ENGAGEMENT_TYPES = [
  "COUNSELLING",
  "ELIGIBILITY_REVIEW",
  "OFFER_REVIEW",
  "ENROLMENT_CONFIRMATION",
  "POST_OFFER_SUPPORT",
  "CALL",
  "MEETING",
  "EMAIL",
  "WHATSAPP",
  "FOLLOW_UP",
  "OTHER",
] as const;

const createSchema = z
  .object({
    engagementType: z.enum(ENGAGEMENT_TYPES),
    description: z.string().min(1, "Describe the activity").max(500),
    /** Future work. Omit when logging something already done. */
    scheduledFor: z.string().datetime().optional(),
    /** Present when logging completed work; defaults to now if `completed`. */
    completed: z.boolean().optional(),
    outcome: z.string().max(2000).optional(),
  })
  .refine((d) => d.scheduledFor || d.completed, {
    message: "An activity must either be scheduled for a future date or marked completed",
  });

const updateSchema = z.object({
  activityId: z.string().min(1),
  action: z.enum(["COMPLETE", "CANCEL", "RESCHEDULE"]),
  outcome: z.string().max(2000).optional(),
  scheduledFor: z.string().datetime().optional(),
  cancelledReason: z.string().max(500).optional(),
});

async function authorise(req: NextRequest, id: string) {
  const session = await auth();
  if (!session?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const { role, id: userId, regionId } = session.user;
  if (!(await effectiveHasPermission(role as Role, "leads", "write"))) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  const lead = await db.lead.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, stage: true, regionId: true, assignedICRId: true, institutionId: true },
  });
  if (!lead) {
    return { error: NextResponse.json({ error: "Lead not found" }, { status: 404 }) };
  }
  if (!canAccessLead(lead, userId, regionId, role as Role)) {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { lead, userId, role: role as Role };
}

// ─── GET: list engagements ───────────────────────────────────────────────────

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await authorise(req, id);
  if ("error" in ctx) return ctx.error;

  const activities = await db.leadActivity.findMany({
    where: { leadId: id, kind: "ENGAGEMENT" },
    include: { user: { select: { id: true, name: true, image: true } } },
    orderBy: [{ completedAt: "desc" }, { scheduledFor: "asc" }],
  });
  return NextResponse.json({ activities });
}

// ─── POST: schedule or log an engagement ─────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await authorise(req, id);
  if ("error" in ctx) return ctx.error;
  const { lead, userId } = ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const d = parsed.data;

  if (d.scheduledFor && !d.completed && new Date(d.scheduledFor) <= new Date()) {
    return NextResponse.json(
      { error: "A scheduled activity must be in the future." },
      { status: 422 }
    );
  }

  const completedAt = d.completed ? new Date() : null;

  const activity = await db.leadActivity.create({
    data: {
      leadId: id,
      userId,
      kind: "ENGAGEMENT",
      engagementType: d.engagementType,
      type: d.engagementType,
      description: d.description,
      scheduledFor: d.scheduledFor ? new Date(d.scheduledFor) : null,
      completedAt,
      outcome: d.outcome ?? null,
      stageAtCreation: lead.stage,
      // Stamped only on completion — the gate asks where work was *finished*,
      // and an activity booked in one stage is often completed in the next.
      stageAtCompletion: completedAt ? lead.stage : null,
    },
    include: { user: { select: { id: true, name: true, image: true } } },
  });

  if (completedAt) await touchLeadActivity(id);

  void logActivity(userId, "CREATE", "LeadActivity", activity.id, {
    leadId: id,
    engagementType: d.engagementType,
    scheduled: d.scheduledFor ?? null,
    completed: !!completedAt,
  });

  return NextResponse.json({ activity }, { status: 201 });
}

// ─── PATCH: complete, cancel or reschedule ───────────────────────────────────

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await authorise(req, id);
  if ("error" in ctx) return ctx.error;
  const { lead, userId } = ctx;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Validation failed", details: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const { activityId, action, outcome, scheduledFor, cancelledReason } = parsed.data;

  const existing = await db.leadActivity.findFirst({
    where: { id: activityId, leadId: id, kind: "ENGAGEMENT" },
  });
  if (!existing) {
    return NextResponse.json({ error: "Activity not found" }, { status: 404 });
  }
  if (existing.cancelledAt) {
    return NextResponse.json({ error: "This activity was cancelled." }, { status: 422 });
  }

  if (action === "COMPLETE") {
    if (existing.completedAt) {
      return NextResponse.json({ error: "Already completed." }, { status: 422 });
    }
    const activity = await db.leadActivity.update({
      where: { id: activityId },
      data: {
        completedAt: new Date(),
        // Completion is attributed to the stage the lead is in *now*.
        stageAtCompletion: lead.stage,
        outcome: outcome ?? existing.outcome,
      },
    });
    await touchLeadActivity(id);
    void logActivity(userId, "UPDATE", "LeadActivity", activityId, { leadId: id, action });
    return NextResponse.json({ activity });
  }

  if (action === "RESCHEDULE") {
    if (!scheduledFor) {
      return NextResponse.json({ error: "A new date is required." }, { status: 422 });
    }
    if (new Date(scheduledFor) <= new Date()) {
      return NextResponse.json({ error: "The new date must be in the future." }, { status: 422 });
    }
    const activity = await db.leadActivity.update({
      where: { id: activityId },
      data: { scheduledFor: new Date(scheduledFor) },
    });
    void logActivity(userId, "UPDATE", "LeadActivity", activityId, { leadId: id, action, scheduledFor });
    return NextResponse.json({ activity });
  }

  const activity = await db.leadActivity.update({
    where: { id: activityId },
    data: { cancelledAt: new Date(), cancelledReason: cancelledReason ?? null },
  });
  void logActivity(userId, "UPDATE", "LeadActivity", activityId, { leadId: id, action });
  return NextResponse.json({ activity });
}

/**
 * Completing real work resets the inactivity clock and clears any reminder
 * already sent, so the next cycle can notify again. Without the clear, a lead
 * chased once would never be chased a second time.
 */
async function touchLeadActivity(leadId: string) {
  const now = new Date();
  // Spec §4 (Student Pipeline) — the first-response SLA closes on the FIRST
  // completed engagement, not just when the stage moves. This lets an ICR
  // book and complete a call while the record still sits in New Lead and
  // still stops the SLA clock. `firstContactAt IS NULL` in the update WHERE
  // means the second-and-later completions don't overwrite it.
  const current = await db.lead.findUnique({
    where: { id: leadId },
    select: { firstContactAt: true, createdAt: true },
  });
  if (!current) return;

  const shouldStampFirstContact = current.firstContactAt === null;
  const responseTimeMinutes = shouldStampFirstContact
    ? Math.max(0, Math.round((now.getTime() - new Date(current.createdAt).getTime()) / 60000))
    : undefined;

  await db.lead.update({
    where: { id: leadId },
    data: {
      lastContactedAt: now,
      inactivity14NotifiedAt: null,
      inactivity21NotifiedAt: null,
      ...(shouldStampFirstContact
        ? {
            firstContactAt: now,
            responseTimeMinutes,
          }
        : {}),
    },
  });
}
