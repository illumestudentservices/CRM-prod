import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
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
    const { role } = session.user;
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

    const plan = await db.quarterlyRecruitmentPlan.findUnique({ where: { id }, select: { status: true } });
    if (!plan) return NextResponse.json({ error: "Not found" }, { status: 404 });

    const check = canTransition(role as Role, plan.status, parsed.data.toStatus as RecruitmentPlanStatus);
    if (!check.ok) return NextResponse.json({ error: check.reason }, { status: 409 });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const patch: any = { status: parsed.data.toStatus };
    const transition = PLAN_TRANSITIONS[parsed.data.toStatus as RecruitmentPlanStatus];
    if (transition.timestampField) patch[transition.timestampField] = new Date();
    if (parsed.data.notes) {
      if (parsed.data.toStatus === "REGIONAL_MANAGER_REVIEW" || parsed.data.toStatus === "RETURNED") patch.regionalReviewNotes = parsed.data.notes;
      else if (parsed.data.toStatus === "ACCOUNT_MANAGER_REVIEW") patch.accountReviewNotes = parsed.data.notes;
      else if (parsed.data.toStatus === "INTERNAL_FINAL_REVIEW") patch.internalFinalReviewNotes = parsed.data.notes;
      else if (parsed.data.toStatus === "CLIENT_REVIEW") patch.clientReviewNotes = parsed.data.notes;
    }

    const updated = await db.quarterlyRecruitmentPlan.update({ where: { id }, data: patch });

    if (parsed.data.toStatus === "APPROVED") {
      await activatePlan(id);
    }

    return NextResponse.json(updated);
  } catch (err) {
    console.error("[POST /api/recruitment-planning/plans/[id]/transition]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
