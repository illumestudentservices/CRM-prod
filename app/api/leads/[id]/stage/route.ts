import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import type { LeadStage } from "@prisma/client";
import { ALL_STAGES, STAGE_LABELS, CLOSED_STAGES } from "@/lib/lead-pipeline";
import { evaluateStageGate, canOverrideGate } from "@/lib/lead-gate";
import { canAccessLead, loadLeadForGate } from "@/lib/lead-access";
import { CHECKLIST_TRIGGERS, resolveChecklist } from "@/lib/lead-checklists";
import { sendLeadStageChangeEmail } from "@/lib/email";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { displayName } from "@/lib/person-name";

/**
 * The only route that may change a lead's pipeline stage.
 *
 * The generic lead update endpoint deliberately refuses `stage`; if it didn't,
 * every rule enforced here could be sidestepped with a different URL.
 */

const stageSchema = z.object({
  stage: z.enum(ALL_STAGES as unknown as [LeadStage, ...LeadStage[]]),
  note: z.string().max(1000).optional(),
  /** Managers may force a blocked transition, with a reason on the record. */
  override: z.boolean().optional(),
  overrideReason: z.string().max(1000).optional(),
});

// ─── PATCH /api/leads/[id]/stage ─────────────────────────────────────────────

export async function PATCH(
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
    const lead = await loadLeadForGate(id);
    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }
    if (!canAccessLead(lead, userId, regionId, role as Role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const parsed = stageSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 422 }
      );
    }

    const { stage: newStage, note, override, overrideReason } = parsed.data;
    const previousStage = lead.stage;

    if (newStage === previousStage) {
      return NextResponse.json({ error: "Lead is already in this stage" }, { status: 400 });
    }

    // Closed outcomes carry mandatory reasons of their own and are recorded
    // through the close endpoint, which captures them.
    if ((CLOSED_STAGES as readonly string[]).includes(newStage)) {
      return NextResponse.json(
        {
          error: `Use POST /api/leads/${id}/close to record a ${STAGE_LABELS[newStage]} outcome — it captures the required reason.`,
        },
        { status: 400 }
      );
    }

    // ── The gate ────────────────────────────────────────────────────────
    const gate = evaluateStageGate(lead, newStage, lead.activities, {
      application: lead.applications[0] ?? null,
      checklist: lead.checklistItems,
    });

    let overrodeGate = false;
    if (!gate.canProgress) {
      // Roles are hardcoded rather than read through effectiveHasPermission,
      // which is DB-overridable — a permissions tweak in settings should not be
      // able to hand out the power to bypass pipeline rules.
      if (!override || !canOverrideGate(role as string)) {
        return NextResponse.json(
          {
            error: `Cannot move to ${STAGE_LABELS[newStage]} yet.`,
            blockers: gate.blockers,
            canOverride: canOverrideGate(role as string),
          },
          { status: 422 }
        );
      }
      if (!overrideReason || overrideReason.trim().length < 10) {
        return NextResponse.json(
          {
            error: "An override needs a written reason of at least 10 characters.",
            blockers: gate.blockers,
            canOverride: true,
          },
          { status: 422 }
        );
      }
      overrodeGate = true;
    }

    // ── Stage automation ────────────────────────────────────────────────
    const now = new Date();
    const stageData: Record<string, unknown> = {
      stage: newStage,
      lastProgressedAt: now,
      // Resets the window the gate measures completed work against.
      stageEnteredAt: now,
      // A fresh stage means the inactivity clock starts again.
      inactivity14NotifiedAt: null,
      inactivity21NotifiedAt: null,
    };

    // Leaving New Lead closes the response-time SLA.
    if (previousStage === "NEW_LEAD" && !lead.firstContactAt) {
      stageData.firstContactAt = now;
      stageData.responseTimeMinutes = Math.max(
        0,
        Math.round((now.getTime() - new Date(lead.createdAt).getTime()) / 60000)
      );
    }

    if (newStage === "ENROLLED") {
      stageData.isConverted = true;
      stageData.convertedAt = now;
      // Eligibility only — commission calculation itself is not modelled yet.
      stageData.commissionEligible = true;
      if (!lead.enrolmentDate) stageData.enrolmentDate = now;
    }

    // ── Apply, guarding against a double advance ────────────────────────
    // Two clicks (or two users) could both read the same stage, both pass the
    // gate, and both advance. Scoping the update to the stage we validated
    // means the loser changes nothing.
    const result = await db.lead.updateMany({
      where: { id, stage: previousStage },
      data: stageData,
    });
    if (result.count === 0) {
      return NextResponse.json(
        { error: "This lead was moved by someone else. Reload and try again." },
        { status: 409 }
      );
    }

    // Checklists are generated on *entering* a stage, so the document list is
    // already there by the time the gate asks for it on the way out.
    // createMany + skipDuplicates leans on the unique constraint, so a repeat
    // advance cannot produce a second copy.
    const categories = CHECKLIST_TRIGGERS[newStage];
    if (categories?.length) {
      const rows = categories.flatMap((category) =>
        resolveChecklist(category, {
          destination: lead.intendedDestination ?? lead.preferredCountry,
          studyLevel: lead.studyLevel,
        }).map((item) => ({
          leadId: id,
          category,
          label: item.label,
          isRequired: item.isRequired,
          order: item.order,
        }))
      );
      if (rows.length) {
        await db.leadChecklistItem.createMany({ data: rows, skipDuplicates: true });
      }
    }

    const updatedLead = await db.lead.findUniqueOrThrow({
      where: { id },
      include: {
        assignedICR: { select: { id: true, name: true, email: true } },
        institution: { select: { id: true, name: true } },
        region: { select: { id: true, name: true } },
      },
    });

    await db.leadActivity.create({
      data: {
        leadId: id,
        userId,
        kind: "SYSTEM",
        type: overrodeGate ? "STAGE_CHANGE_OVERRIDE" : "STAGE_CHANGE",
        description: overrodeGate
          ? `Stage moved from ${STAGE_LABELS[previousStage]} to ${STAGE_LABELS[newStage]} by override. Reason: ${overrideReason}`
          : `Stage moved from ${STAGE_LABELS[previousStage]} to ${STAGE_LABELS[newStage]}${note ? `. Note: ${note}` : ""}`,
        stageAtCreation: previousStage,
        metadata: {
          from: previousStage,
          to: newStage,
          ...(note && { note }),
          ...(overrodeGate && {
            override: true,
            overrideReason,
            blockers: gate.blockers.map((b) => b.message),
          }),
        },
      },
    });

    if (updatedLead.assignedICRId && updatedLead.assignedICRId !== userId) {
      await db.notification.create({
        data: {
          userId: updatedLead.assignedICRId,
          title: "Lead stage updated",
          message: `"${displayName(updatedLead)}" moved to ${STAGE_LABELS[newStage]}`,
          type: "STAGE_CHANGE",
          link: `/students/${id}`,
        },
      });

      if (updatedLead.assignedICR?.email) {
        const changedByUser = await db.user.findUnique({
          where: { id: userId },
          select: { name: true },
        });
        sendLeadStageChangeEmail({
          to: updatedLead.assignedICR.email,
          icrName: updatedLead.assignedICR.name ?? "Team",
          leadName: displayName(updatedLead),
          previousStage: STAGE_LABELS[previousStage],
          newStage: STAGE_LABELS[newStage],
          changedBy: changedByUser?.name ?? "A team member",
          note,
          leadUrl: `${process.env.NEXTAUTH_URL ?? ""}/students/${id}`,
        });
      }
    }

    await db.auditLog.create({
      data: {
        userId,
        action: overrodeGate ? "STAGE_CHANGE_OVERRIDE" : "STAGE_CHANGE",
        entity: "Lead",
        entityId: id,
        changes: {
          from: previousStage,
          to: newStage,
          ...(note && { note }),
          ...(overrodeGate && {
            overrideReason,
            bypassedBlockers: gate.blockers.map((b) => b.message),
          }),
        },
      },
    });

    // Spec Tasks §10 — workflow automation. When a lead reaches a significant
    // stage (Application Submitted / Offer Received / Deposit Paid / Enrolled),
    // fire task templates whose triggerEvent matches "LEAD_STAGE_<newStage>".
    // Best-effort — a template misconfig never blocks the stage change.
    try {
      const { fireEventTriggers } = await import("@/lib/task-workflow");
      const creator = await db.employee.findFirst({
        where: { userId },
        select: { id: true },
      });
      if (creator) {
        await fireEventTriggers(`LEAD_STAGE_${newStage}`, {
          createdById: creator.id,
          assigneeId: creator.id,
          parentType: "STUDENT",
          parentId: id,
        });
      }
    } catch (triggerErr) {
      console.error("[lead stage trigger] failed to fire task templates", triggerErr);
    }

    return NextResponse.json({ data: updatedLead, overrode: overrodeGate });
  } catch (error) {
    console.error("[PATCH /api/leads/[id]/stage]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── GET: what is blocking progress right now ────────────────────────────────

/**
 * Lets the UI show the blocker list without attempting the move. Evaluated per
 * request because the "future activity" test changes as time passes — a lead
 * that could progress this morning may not this afternoon, so this can never
 * be cached or precomputed into a column.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { role, id: userId, regionId } = session.user;

  const { id } = await params;
  const lead = await loadLeadForGate(id);
  if (!lead) return NextResponse.json({ error: "Lead not found" }, { status: 404 });
  if (!canAccessLead(lead, userId, regionId, role as Role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const target = req.nextUrl.searchParams.get("target") as LeadStage | null;
  const candidates = target ? [target] : ALL_STAGES;

  const gates = candidates
    .filter((s) => s !== lead.stage && !(CLOSED_STAGES as readonly string[]).includes(s))
    .map((s) => ({
      stage: s,
      ...evaluateStageGate(lead, s, lead.activities, {
        application: lead.applications[0] ?? null,
        checklist: lead.checklistItems,
      }),
    }));

  return NextResponse.json({
    stage: lead.stage,
    stageEnteredAt: lead.stageEnteredAt,
    canOverride: canOverrideGate(role as string),
    gates,
  });
}
