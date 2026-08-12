import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditOrigin } from "@/lib/activity-logger";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { canAccessLead, institutionIdsForUser } from "@/lib/lead-access";
import { STAGE_LABELS } from "@/lib/lead-pipeline";

/**
 * Closing a lead: Lost, Deferred, or Application Rejected.
 *
 * Separate from the stage route because each outcome carries mandatory fields
 * that only make sense for that outcome — putting them behind a generic stage
 * change would mean either accepting a close with no reason, or bolting
 * outcome-specific validation onto a route that shouldn't know about it.
 *
 * Reachable from any stage, per the spec.
 */

/** How far before the intake a deferred lead comes back to be worked. */
const DEFERRED_REOPEN_LEAD_DAYS = 90;

const lostSchema = z.object({
  outcome: z.literal("LOST"),
  lostReason: z.enum([
    "NO_RESPONSE",
    "FINANCIAL",
    "COMPETITOR",
    "ACADEMIC",
    "VISA",
    "PERSONAL",
    "OTHER",
  ]),
  lostDate: z.string().datetime(),
  // The spec lists Notes as mandatory, not optional.
  notes: z.string().min(1, "Notes are required").max(2000),
});

const deferredSchema = z.object({
  outcome: z.literal("DEFERRED"),
  deferredIntakeYear: z.number().int().min(2020).max(2040),
  deferredIntakeMonth: z.number().int().min(1).max(12),
  reason: z.string().min(1, "A reason is required").max(2000),
  followUpDate: z.string().datetime(),
});

const rejectedSchema = z.object({
  outcome: z.literal("APPLICATION_REJECTED"),
  institutionId: z.string().min(1, "Institution is required"),
  reason: z.string().min(1, "A reason is required").max(2000),
  notes: z.string().min(1, "Notes are required").max(2000),
});

const closeSchema = z.discriminatedUnion("outcome", [
  lostSchema,
  deferredSchema,
  rejectedSchema,
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { role, id: userId, regionId } = session.user;

    if (!(await effectiveHasPermission(role as Role, "leads", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const lead = await db.lead.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        stage: true,
        firstName: true, lastName: true,
        regionId: true,
        assignedICRId: true,
        institutionId: true,
      },
    });
    if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    if (!canAccessLead(lead, userId, regionId, role as Role, await institutionIdsForUser(userId, role as Role))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = closeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 422 }
      );
    }
    const data = parsed.data;

    if (lead.stage === data.outcome) {
      return NextResponse.json({ error: "Lead is already in this state" }, { status: 400 });
    }

    const now = new Date();
    const update: Record<string, unknown> = {
      stage: data.outcome,
      stageEnteredAt: now,
      lastProgressedAt: now,
      // The stage they were closed from. Closed outcomes overwrite `stage`, so
      // without this "where do we lose students" becomes unanswerable.
      stageBeforeClose: lead.stage,
      // A closed lead should not be chased.
      inactivity14NotifiedAt: now,
      inactivity21NotifiedAt: now,
    };

    let description: string;

    if (data.outcome === "LOST") {
      update.lostReason = data.lostReason;
      update.lostDate = new Date(data.lostDate);
      update.lostNotes = data.notes;
      description = `Marked Lost (${data.lostReason.replace(/_/g, " ").toLowerCase()}) from ${STAGE_LABELS[lead.stage]}. ${data.notes}`;
    } else if (data.outcome === "DEFERRED") {
      const intakeStart = new Date(Date.UTC(data.deferredIntakeYear, data.deferredIntakeMonth - 1, 1));
      update.deferredIntakeYear = data.deferredIntakeYear;
      update.deferredIntakeMonth = data.deferredIntakeMonth;
      update.deferredReason = data.reason;
      update.deferredFollowUpAt = new Date(data.followUpDate);
      // Stored rather than recomputed later, so the reopen date is inspectable
      // and stays put if the constant is ever tuned.
      update.deferredReopenAt = new Date(
        intakeStart.getTime() - DEFERRED_REOPEN_LEAD_DAYS * 86_400_000
      );
      description = `Deferred to ${data.deferredIntakeMonth}/${data.deferredIntakeYear} from ${STAGE_LABELS[lead.stage]}. ${data.reason}`;
    } else {
      update.institutionId = data.institutionId;
      description = `Application rejected from ${STAGE_LABELS[lead.stage]}. ${data.reason}`;
    }

    const [, cancelled] = await db.$transaction([
      db.lead.update({ where: { id }, data: update }),
      // Open future work on a closed lead would keep surfacing in task lists
      // and triggering reminders for someone who is no longer being worked.
      db.leadActivity.updateMany({
        where: { leadId: id, kind: "ENGAGEMENT", completedAt: null, cancelledAt: null },
        data: { cancelledAt: now, cancelledReason: `Lead closed as ${STAGE_LABELS[data.outcome]}` },
      }),
      db.leadActivity.create({
        data: {
          leadId: id,
          userId,
          kind: "SYSTEM",
          type: "LEAD_CLOSED",
          description,
          stageAtCreation: lead.stage,
          metadata: { from: lead.stage, to: data.outcome, ...data },
        },
      }),
      db.auditLog.create({
        data: {
          userId,
          action: "LEAD_CLOSED",
          entity: "Lead",
          entityId: id,
          changes: { from: lead.stage, to: data.outcome, ...data },
        
          ...(await auditOrigin()),
        },
      }),
    ]);

    // Application Rejected is explicitly not the end of the road — the spec
    // asks that the ICR be prompted toward an alternative application rather
    // than the record simply closing.
    const prompt =
      data.outcome === "APPLICATION_REJECTED"
        ? {
            action: "CREATE_ALTERNATIVE_APPLICATION",
            message:
              "Consider an alternative institution for this student rather than closing the record.",
          }
        : data.outcome === "DEFERRED"
          ? {
              action: "SCHEDULED_REOPEN",
              message: `This lead will reopen automatically on ${(update.deferredReopenAt as Date).toISOString().slice(0, 10)}, ahead of the ${data.deferredIntakeMonth}/${data.deferredIntakeYear} intake.`,
            }
          : null;

    const updated = await db.lead.findUniqueOrThrow({
      where: { id },
      include: {
        assignedICR: { select: { id: true, name: true } },
        institution: { select: { id: true, name: true } },
      },
    });

    return NextResponse.json({
      data: updated,
      cancelledActivities: cancelled.count,
      prompt,
    });
  } catch (error) {
    console.error("[POST /api/leads/[id]/close]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── DELETE: reopen a closed lead ────────────────────────────────────────────

/**
 * Restores a closed lead to the stage it was closed from. Because the gate only
 * counts activity completed since `stageEnteredAt`, a reopened lead correctly
 * needs fresh work rather than inheriting whatever satisfied it last time.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { role, id: userId, regionId } = session.user;

  if (!(await effectiveHasPermission(role as Role, "leads", "write"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const lead = await db.lead.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      stage: true,
      stageBeforeClose: true,
      regionId: true,
      assignedICRId: true,
      institutionId: true,
    },
  });
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (!canAccessLead(lead, userId, regionId, role as Role, await institutionIdsForUser(userId, role as Role))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (!["LOST", "DEFERRED", "APPLICATION_REJECTED"].includes(lead.stage)) {
    return NextResponse.json({ error: "This lead is not closed." }, { status: 400 });
  }

  // Leads closed before stageBeforeClose existed have nothing recorded; the
  // start of the pipeline is the honest fallback.
  const restoreTo =
    lead.stageBeforeClose && lead.stageBeforeClose !== "ENROLLED"
      ? lead.stageBeforeClose
      : "NEW_LEAD";
  const now = new Date();

  await db.$transaction([
    db.lead.update({
      where: { id },
      data: {
        stage: restoreTo,
        stageEnteredAt: now,
        lastProgressedAt: now,
        stageBeforeClose: null,
        inactivity14NotifiedAt: null,
        inactivity21NotifiedAt: null,
      },
    }),
    db.leadActivity.create({
      data: {
        leadId: id,
        userId,
        kind: "SYSTEM",
        type: "LEAD_REOPENED",
        description: `Reopened from ${STAGE_LABELS[lead.stage]} back to ${STAGE_LABELS[restoreTo]}`,
        stageAtCreation: lead.stage,
        metadata: { from: lead.stage, to: restoreTo },
      },
    }),
    db.auditLog.create({
      data: {
        userId,
        action: "LEAD_REOPENED",
        entity: "Lead",
        entityId: id,
        changes: { from: lead.stage, to: restoreTo },
      
        ...(await auditOrigin()),
      },
    }),
  ]);

  return NextResponse.json({ stage: restoreTo });
}
