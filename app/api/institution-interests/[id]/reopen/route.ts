import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { syncLeadFromInterests } from "@/lib/interest-sync";

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId } = session.user;
    if (!(await effectiveHasPermission(role as Role, "leads", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    const { id } = await ctx.params;

    const interest = await db.institutionInterest.findUnique({
      where: { id },
      select: { leadId: true, institutionId: true, closedAt: true, stageBeforeClose: true },
    });
    if (!interest) return NextResponse.json({ error: "Not found" }, { status: 404 });
    if (!interest.closedAt) return NextResponse.json({ error: "Already open" }, { status: 409 });

    // Enforce the partial unique: only one OPEN interest per (student, institution).
    const conflict = await db.institutionInterest.findFirst({
      where: { leadId: interest.leadId, institutionId: interest.institutionId, closedAt: null, NOT: { id } },
      select: { id: true },
    });
    if (conflict) {
      return NextResponse.json(
        { error: "Another open interest exists for this student and institution.", conflictId: conflict.id },
        { status: 409 },
      );
    }

    const updated = await db.institutionInterest.update({
      where: { id },
      data: {
        closedAt: null,
        stage: interest.stageBeforeClose ?? "NEW_LEAD",
        stageEnteredAt: new Date(),
        lostReason: null,
        lostDate: null,
        lostNotes: null,
      },
    });

    await db.leadActivity.create({
      data: {
        leadId: interest.leadId,
        institutionInterestId: id,
        userId,
        type: "STAGE_CHANGE",
        description: "Interest reopened",
        kind: "SYSTEM",
      },
    });

    await syncLeadFromInterests(interest.leadId);
    return NextResponse.json(updated);
  } catch (err) {
    console.error("[POST /api/institution-interests/[id]/reopen]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
