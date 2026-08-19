import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { inRegion } from "@/lib/region-scope";
import { hasCapability } from "@/lib/granular-permissions";
import { PLAN_TRANSITIONS, canTransition, activatePlan } from "@/lib/plan-workflow";
import type { RecruitmentPlanStatus } from "@prisma/client";

const schema = z.object({
  toStatus: z.enum([
    "DRAFT", "SUBMITTED", "REGIONAL_MANAGER_REVIEW", "ACCOUNT_MANAGER_REVIEW",
    "INTERNAL_FINAL_REVIEW", "CLIENT_REVIEW", "APPROVED", "ACTIVE",
    "COMPLETED", "CLOSED", "RETURNED",
  ]),
  notes: z.string().optional(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId, regionId } = session.user;
    // Advancing a plan is either authoring (ICR submitting) or reviewing
    // (a manager moving it along), so accept `write` OR `approve`.
    //
    // Requiring `write` alone deadlocked the workflow: HQ_EXECUTIVE,
    // ACCOUNT_MANAGER and VP_GLOBAL_SALES hold `approve` but not `write`,
    // and PLAN_TRANSITIONS makes those three roles the owners of four of the
    // five approval steps. Every plan therefore stopped at
    // REGIONAL_MANAGER_REVIEW unless a SUPER_ADMIN pushed it through by hand.
    //
    // This is only the coarse module gate. canTransition() below is still the
    // authority on which role may perform which specific hop, so widening
    // here does not let anyone make a transition that isn't theirs.
    const canWrite = await effectiveHasPermission(role as Role, "recruitment_planning", "write");
    const canApprove = await effectiveHasPermission(role as Role, "recruitment_planning", "approve");
    if (!canWrite && !canApprove) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }

    const plan = await db.quarterlyRecruitmentPlan.findUnique({
      where: { id },
      // The owning ICR's region is the plan's region: a plan has no region
      // column of its own, which is the same join GET /plans scopes by.
      select: { status: true, icrId: true, icr: { select: { regionId: true } } },
    });
    if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });

    // ── Row scope ──────────────────────────────────────────────────────────
    //
    // canTransition() below decides which ROLE may make which hop. It says
    // nothing about WHICH plan, so until now any Regional Manager could advance
    // any plan in the organisation — while the GET on this same resource was
    // region-scoped, so the list they saw and the plans they could act on were
    // different sets.
    //
    // That is not a read-only discrepancy: reaching APPROVED runs activatePlan(),
    // which raises travel, schedules field operations and fires task templates.
    // A manager could commit budget and create work in a region that is not
    // theirs.
    //
    // A Regional Manager is confined to their own region and a manager with no
    // region matches nothing — see lib/region-scope.ts for why that is not "all
    // regions". An ICR may only move their own plan. SUPER_ADMIN is unscoped by
    // design, and the remaining chain roles (HQ_EXECUTIVE, ACCOUNT_MANAGER,
    // VP_GLOBAL_SALES) are global posts with no region to be confined to.
    if (role === "REGIONAL_MANAGER" && !inRegion({ regionId: plan.icr.regionId }, regionId)) {
      // 404, not 403: a 403 confirms the id names a real plan, which is enough
      // to enumerate other regions' plans by walking ids.
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    if (role === "ICR" && plan.icrId !== userId) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const check = canTransition(role as Role, plan.status, parsed.data.toStatus as RecruitmentPlanStatus);
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 409 });

    // The APPROVED hop is the one that commits budget and, via activatePlan()
    // below, creates real travel and work. recruitment_planning.approve_plan
    // was declared in the capability registry and read by nothing, so the
    // Security screen offered a switch that changed nothing. Its default is the
    // same set PLAN_TRANSITIONS.APPROVED already allows, so this withdraws
    // nothing today — it just makes the switch real.
    if (parsed.data.toStatus === "APPROVED" &&
        !(await hasCapability(role as Role, "recruitment_planning.approve_plan"))) {
      return NextResponse.json(
        { error: "Your role is not permitted to give final plan approval" },
        { status: 403 }
      );
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: any = { status: parsed.data.toStatus };
    const transition = PLAN_TRANSITIONS[parsed.data.toStatus as RecruitmentPlanStatus];
    if (transition.timestampField) patch[transition.timestampField] = new Date();
    // Record who reviewed, not just when. These columns existed and were never
    // written, so `accountReviewedAt` could be set with `accountManagerId` still
    // null — a budget approval trail that says a review happened but not by
    // whom. Re-stamped on each pass so that after a RETURNED round-trip the
    // reviewer shown is the one who actually cleared it.
    if (transition.reviewerField) patch[transition.reviewerField] = userId;
    if (parsed.data.notes) {
      if (parsed.data.toStatus === "REGIONAL_MANAGER_REVIEW" || parsed.data.toStatus === "RETURNED") patch.regionalReviewNotes = parsed.data.notes;
      else if (parsed.data.toStatus === "ACCOUNT_MANAGER_REVIEW") patch.accountReviewNotes = parsed.data.notes;
      else if (parsed.data.toStatus === "INTERNAL_FINAL_REVIEW") patch.internalFinalReviewNotes = parsed.data.notes;
      else if (parsed.data.toStatus === "CLIENT_REVIEW") patch.clientReviewNotes = parsed.data.notes;
    }

    const updated = await db.quarterlyRecruitmentPlan.update({ where: { id }, data: patch });

    if (parsed.data.toStatus === "APPROVED") {
      // Activation is a chain of side effects (raise travel, schedule field
      // ops, fire task templates). The status change above has already
      // committed, so letting a failure here throw would answer 500 while
      // leaving the plan stranded in APPROVED — approved on paper, with none
      // of the work created and no indication why.
      //
      // Report it instead. activatePlan is idempotent and re-checks for
      // APPROVED, so it can safely be retried by transitioning again.
      try {
        await activatePlan(id);
      } catch (activationErr) {
        console.error(`[transition] activation failed for plan ${id}`, activationErr);
        return NextResponse.json(
          {
            ...updated,
            warning:
              "Plan approved, but activation did not complete. Travel and field operations may not have been created. Retry the approval to finish activation.",
          },
          { status: 207 }
        );
      }
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[POST /api/recruitment-planning/plans/[id]/transition]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
