import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { syncLeadFromInterests } from "@/lib/interest-sync";
import { accessibleInterest } from "@/lib/lead-access";
import type { LeadStage } from "@prisma/client";

const closeSchema = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("LOST"),
    lostReason: z.enum(["NO_RESPONSE", "FINANCIAL", "COMPETITOR", "ACADEMIC", "VISA", "PERSONAL", "OTHER"]),
    lostNotes: z.string().optional(),
  }),
  z.object({
    outcome: z.literal("DEFERRED"),
    deferredIntakeYear: z.number().int().min(2020).max(2035),
    deferredIntakeMonth: z.number().int().min(1).max(12),
    deferredReason: z.string().optional(),
    deferredFollowUpAt: z.string().datetime().optional(),
  }),
  z.object({
    outcome: z.literal("APPLICATION_REJECTED"),
    rejectionReason: z.string().optional(),
  }),
]);

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
    // holder close any student's interest.
    if (!(await accessibleInterest(id, userId, regionId, role as Role))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = closeSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }

    const interest = await db.institutionInterest.findUnique({ where: { id }, select: { leadId: true, stage: true, closedAt: true } });
    if (!interest) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (interest.closedAt) return NextResponse.json({ error: "Already closed" }, { status: 409 });

    const now = new Date();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = {
      stageBeforeClose: interest.stage,
      stage: parsed.data.outcome as LeadStage,
      closedAt: now,
    };
    if (parsed.data.outcome === "LOST") {
      updateData.lostReason = parsed.data.lostReason;
      updateData.lostDate = now;
      updateData.lostNotes = parsed.data.lostNotes;
    } else if (parsed.data.outcome === "DEFERRED") {
      updateData.deferredIntakeYear = parsed.data.deferredIntakeYear;
      updateData.deferredIntakeMonth = parsed.data.deferredIntakeMonth;
      updateData.deferredReason = parsed.data.deferredReason;
      updateData.deferredFollowUpAt = parsed.data.deferredFollowUpAt ? new Date(parsed.data.deferredFollowUpAt) : undefined;
      // Reopen at the deferred intake month, one month before target
      const reopen = new Date(Number(parsed.data.deferredIntakeYear), Number(parsed.data.deferredIntakeMonth) - 2, 1);
      updateData.deferredReopenAt = reopen;
    }

    const updated = await db.institutionInterest.update({ where: { id }, data: updateData });

    // Cancel any open engagements attached to this interest.
    await db.leadActivity.updateMany({
      where: { institutionInterestId: id, cancelledAt: null, completedAt: null, kind: "ENGAGEMENT" },
      data: { cancelledAt: now, cancelledReason: `Closed via ${parsed.data.outcome}` },
    });

    await db.leadActivity.create({
      data: {
        leadId: interest.leadId,
        institutionInterestId: id,
        userId,
        type: "STAGE_CHANGE",
        description: `Interest closed: ${parsed.data.outcome}`,
        kind: "SYSTEM",
      },
    });

    await syncLeadFromInterests(interest.leadId);
    return NextResponse.json(updated);
  } catch (err) {
    console.error("[POST /api/institution-interests/[id]/close]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
