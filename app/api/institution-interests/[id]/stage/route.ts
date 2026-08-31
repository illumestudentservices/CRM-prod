import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { syncLeadFromInterests } from "@/lib/interest-sync";
import { accessibleInterest } from "@/lib/lead-access";
import { canOverrideGate } from "@/lib/lead-gate";
import { evaluateInterestStageGate } from "@/lib/interest-gate";
import { CHECKLIST_TRIGGERS, resolveChecklist } from "@/lib/lead-checklists";
import { STAGE_LABELS, stageIndex } from "@/lib/lead-pipeline";
import type { LeadStage } from "@prisma/client";

/**
 * Moves one Institution Interest through the eight-stage pipeline.
 *
 * Spec page 3: "The eight-stage pipeline applies to the Institution Interest,
 * not directly to the master Student Profile." This route is therefore the
 * pipeline's real home, and until now it enforced nothing at all — no required
 * fields, no completed activities, no document checklist, and no limit on how
 * far a single request could jump. A brand-new student could be taken from New
 * Lead to Enrolled in one call, and `syncLeadFromInterests` then wrote that
 * stage onto the Student Profile, so the record read "Enrolled" while every
 * conversion figure disagreed.
 *
 * It now runs the same gate as the Student Profile route, against the merged
 * person + journey subject built in `lib/interest-gate.ts`, and generates the
 * stage's checklists — which previously only the Student Profile route did, so
 * advancing an interest the way the spec intends produced no document, visa,
 * pre-departure or accommodation list.
 */

const bodySchema = z.object({
  toStage: z.enum([
    "NEW_LEAD", "CONTACTED", "QUALIFIED", "APPLICATION_SUBMITTED",
    "AWAITING_DECISION", "OFFER_RECEIVED", "DEPOSIT_PAID", "ENROLLED",
  ]),
  reason: z.string().max(1000).optional(),
  /** Managers may force a blocked transition, with a reason on the record. */
  override: z.boolean().optional(),
  overrideReason: z.string().max(1000).optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId, regionId } = session.user;
    if (!(await effectiveHasPermission(role as Role, "leads", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;

    // Same row gate as the interest read path: without it leads:write let any
    // holder advance any student's interest through the pipeline.
    if (!(await accessibleInterest(id, userId, regionId, role as Role))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }
    const { toStage, reason, override, overrideReason } = parsed.data;

    // Everything the gate needs, in one read. The lead's own activities and
    // checklist items are included because they are recorded against the
    // person, not the journey — see `scopedToInterest`.
    const interest = await db.institutionInterest.findUnique({
      where: { id },
      include: {
        lead: {
          include: {
            activities: { where: { kind: "ENGAGEMENT", cancelledAt: null } },
            checklistItems: { select: { category: true, institutionInterestId: true } },
          },
        },
        applications: { where: { isActive: true }, take: 1 },
      },
    });
    if (!interest) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (interest.closedAt) {
      return NextResponse.json({ error: "Cannot change stage of a closed interest" }, { status: 409 });
    }

    const fromStage = interest.stage;
    if (toStage === fromStage) {
      return NextResponse.json({ error: "This interest is already in that stage" }, { status: 400 });
    }

    const fromIdx = stageIndex(fromStage);
    const toIdx = stageIndex(toStage as LeadStage);
    if (fromIdx === -1 || toIdx === -1) {
      return NextResponse.json({ error: "Cannot transition from or to a closed-outcome stage" }, { status: 400 });
    }

    // Spec §13: moving backwards requires a reason.
    const movingBackwards = toIdx < fromIdx;
    if (movingBackwards && !reason) {
      return NextResponse.json({ error: "Reason is required when moving backwards through the pipeline" }, { status: 422 });
    }

    // ── The gate ────────────────────────────────────────────────────────
    // Only forward moves are gated. A correction backwards already carries a
    // mandatory reason, and blocking it would strand an interest that was
    // advanced in error at a stage whose exit conditions it cannot meet.
    let overrodeGate = false;
    if (!movingBackwards) {
      const gate = evaluateInterestStageGate(
        interest.lead,
        interest,
        toStage as LeadStage,
        interest.lead.activities,
        {
          interestId: id,
          application: interest.applications[0] ?? null,
          checklist: interest.lead.checklistItems,
        }
      );

      if (!gate.canProgress) {
        const canOverride = await canOverrideGate(role as string);
        if (!override || !canOverride) {
          return NextResponse.json(
            {
              error: `Cannot move this interest to ${STAGE_LABELS[toStage as LeadStage]} yet.`,
              blockers: gate.blockers,
              canOverride,
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
    }

    // ── Apply, guarding against a double advance ────────────────────────
    // Two clicks could both read the same stage, both pass the gate and both
    // advance. Scoping the update to the stage we validated means the loser
    // changes nothing. Mirrors the Student Profile route.
    const now = new Date();
    const data: Record<string, unknown> = {
      stage: toStage,
      stageEnteredAt: now,
      lastProgressedAt: now,
      // A fresh stage restarts the inactivity clock.
      inactivity14NotifiedAt: null,
      inactivity21NotifiedAt: null,
    };

    if (toStage === "ENROLLED") {
      data.isConverted = true;
      data.convertedAt = now;
      // Eligibility only — commission calculation itself is not modelled yet.
      data.commissionEligible = true;
      if (!interest.enrolmentDate) data.enrolmentDate = now;
      // Spec §11 required task: "Close the Institution Interest." The column's
      // own contract in schema.prisma says it is set on LOST,
      // APPLICATION_REJECTED and ENROLLED; only the first two ever did.
      data.closedAt = now;
    }

    const applied = await db.institutionInterest.updateMany({
      where: { id, stage: fromStage, closedAt: null },
      data,
    });
    if (applied.count === 0) {
      return NextResponse.json(
        { error: "This interest was changed by someone else. Reload and try again." },
        { status: 409 }
      );
    }

    await db.leadActivity.create({
      data: {
        leadId: interest.leadId,
        institutionInterestId: id,
        userId,
        type: overrodeGate ? "STAGE_CHANGE_OVERRIDE" : "STAGE_CHANGE",
        description:
          `Interest stage: ${fromStage} -> ${toStage}` +
          (reason ? ` (${reason})` : "") +
          (overrodeGate ? ` [gate overridden: ${overrideReason}]` : ""),
        kind: "SYSTEM",
        stageAtCompletion: toStage,
      },
    });

    // ── Stage-entry workflows ───────────────────────────────────────────
    // Generated on entering a stage, so the list is already present by the time
    // the gate asks for it on the way out. `skipDuplicates` leans on the unique
    // constraint so a repeat advance cannot produce a second copy.
    //
    // NOTE: that constraint is `[leadId, category, label]`, which is per
    // STUDENT rather than per journey, so a second interest reaching Qualified
    // adds nothing new. The gate tolerates this — it asks only that the
    // checklist has been started — but making these lists genuinely
    // per-journey needs a migration and is deliberately out of scope here.
    const categories = CHECKLIST_TRIGGERS[toStage];
    if (categories?.length) {
      const rows = categories.flatMap((category) =>
        resolveChecklist(category, {
          destination: interest.lead.intendedDestination ?? interest.lead.preferredCountry,
          studyLevel: interest.studyLevel ?? interest.lead.studyLevel,
        }).map((item) => ({
          leadId: interest.leadId,
          institutionInterestId: id,
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

    // Enrolment closes the journey, so the mirror below would see no open
    // interest and leave the Student Profile behind. Promote it directly, the
    // same way the Student Profile route does.
    if (toStage === "ENROLLED") {
      await db.lead.update({
        where: { id: interest.leadId },
        data: {
          stage: "ENROLLED",
          isConverted: true,
          convertedAt: now,
          commissionEligible: true,
          ...(interest.lead.enrolmentDate ? {} : { enrolmentDate: now }),
        },
      });
    }

    // A deliberate correction backwards carries a mandatory reason, so it is
    // allowed to pull the mirrored Student Profile stage back with it. Every
    // other caller must not: see the note on `syncLeadFromInterests`.
    await syncLeadFromInterests(interest.leadId, { allowRegression: movingBackwards });

    const updated = await db.institutionInterest.findUniqueOrThrow({ where: { id } });
    return NextResponse.json(updated);
  } catch (err) {
    console.error("[POST /api/institution-interests/[id]/stage]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
