import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { syncLeadFromInterests } from "@/lib/interest-sync";
import { accessibleInterest } from "@/lib/lead-access";
import type { LeadStage } from "@prisma/client";

const bodySchema = z.object({
  toStage: z.enum([
    "NEW_LEAD", "CONTACTED", "QUALIFIED", "APPLICATION_SUBMITTED",
    "AWAITING_DECISION", "OFFER_RECEIVED", "DEPOSIT_PAID", "ENROLLED",
  ]),
  reason: z.string().optional(),
});

const PIPELINE_ORDER: LeadStage[] = [
  "NEW_LEAD", "CONTACTED", "QUALIFIED", "APPLICATION_SUBMITTED",
  "AWAITING_DECISION", "OFFER_RECEIVED", "DEPOSIT_PAID", "ENROLLED",
];

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

    const interest = await db.institutionInterest.findUnique({ where: { id }, select: { leadId: true, stage: true, closedAt: true } });
    if (!interest) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (interest.closedAt) return NextResponse.json({ error: "Cannot change stage of a closed interest" }, { status: 409 });

    const fromIdx = PIPELINE_ORDER.indexOf(interest.stage);
    const toIdx = PIPELINE_ORDER.indexOf(parsed.data.toStage);
    if (fromIdx === -1 || toIdx === -1) {
      return NextResponse.json({ error: "Cannot transition from or to a closed-outcome stage" }, { status: 400 });
    }

    // Spec §13: moving backwards requires a reason.
    if (toIdx < fromIdx && !parsed.data.reason) {
      return NextResponse.json({ error: "Reason is required when moving backwards through the pipeline" }, { status: 422 });
    }

    const updated = await db.institutionInterest.update({
      where: { id },
      data: {
        stage: parsed.data.toStage,
        stageEnteredAt: new Date(),
        lastProgressedAt: new Date(),
      },
    });

    await db.leadActivity.create({
      data: {
        leadId: interest.leadId,
        institutionInterestId: id,
        userId,
        type: "STAGE_CHANGE",
        description: `Interest stage: ${interest.stage} -> ${parsed.data.toStage}${parsed.data.reason ? ` (${parsed.data.reason})` : ""}`,
        kind: "SYSTEM",
        stageAtCompletion: parsed.data.toStage,
      },
    });

    await syncLeadFromInterests(interest.leadId);
    return NextResponse.json(updated);
  } catch (err) {
    console.error("[POST /api/institution-interests/[id]/stage]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
