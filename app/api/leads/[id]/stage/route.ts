import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import type { LeadStage } from "@prisma/client";
import { ALL_STAGES } from "@/lib/lead-pipeline";
import { sendLeadStageChangeEmail } from "@/lib/email";
import { effectiveHasPermission } from "@/lib/effective-permissions";

const stageSchema = z.object({
  stage: z.enum(ALL_STAGES as unknown as [LeadStage, ...LeadStage[]]),
  note: z.string().optional(),
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

    const lead = await db.lead.findFirst({
      where: { id, deletedAt: null },
      include: {
        assignedICR: { select: { id: true, name: true, email: true } },
      },
    });

    if (!lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 404 });
    }

    // Role-based access check
    if (role === "ICR" && lead.assignedICRId !== userId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
    if (role === "REGIONAL_MANAGER" && regionId && lead.regionId !== regionId) {
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

    const { stage: newStage, note } = parsed.data;
    const previousStage = lead.stage;

    if (newStage === previousStage) {
      return NextResponse.json(
        { error: "Lead is already in this stage" },
        { status: 400 }
      );
    }

    // Update lead in a transaction
    const [updatedLead, activity] = await db.$transaction([
      db.lead.update({
        where: { id },
        data: {
          stage: newStage,
          lastProgressedAt: new Date(),
        },
        include: {
          assignedICR: { select: { id: true, name: true, email: true } },
          institution: { select: { id: true, name: true } },
          region: { select: { id: true, name: true } },
        },
      }),
      db.leadActivity.create({
        data: {
          leadId: id,
          userId,
          type: "STAGE_CHANGE",
          description: note
            ? `Stage moved from ${previousStage} to ${newStage}. Note: ${note}`
            : `Stage moved from ${previousStage} to ${newStage}`,
          metadata: {
            from: previousStage,
            to: newStage,
            ...(note && { note }),
          },
        },
      }),
    ]);

    // Send notification to assigned ICR if they are not the one making the change
    if (updatedLead.assignedICRId && updatedLead.assignedICRId !== userId) {
      await db.notification.create({
        data: {
          userId: updatedLead.assignedICRId,
          title: "Lead stage updated",
          message: `"${updatedLead.fullName}" has been moved to ${newStage.replace(/_/g, " ")}`,
          type: "STAGE_CHANGE",
          link: `/students/${id}`,
        },
      });

      // Email notification (fire-and-forget)
      if (updatedLead.assignedICR?.email) {
        const changedByUser = await db.user.findUnique({
          where: { id: userId },
          select: { name: true },
        });
        sendLeadStageChangeEmail({
          to: updatedLead.assignedICR.email,
          icrName: updatedLead.assignedICR.name ?? "Team",
          leadName: updatedLead.fullName,
          previousStage,
          newStage,
          changedBy: changedByUser?.name ?? "A team member",
          note,
          leadUrl: `${process.env.NEXTAUTH_URL ?? ""}/students/${id}`,
        });
      }
    }

    // Audit log
    await db.auditLog.create({
      data: {
        userId,
        action: "STAGE_CHANGE",
        entity: "Lead",
        entityId: id,
        changes: { from: previousStage, to: newStage, ...(note && { note }) },
      },
    });

    return NextResponse.json({ data: updatedLead, activity });
  } catch (error) {
    console.error("[PATCH /api/leads/[id]/stage]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
