import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { canReview, isLocked } from "@/lib/icr-transition";

/**
 * Bulk student pipeline reassignment (spec §16).
 *
 * The spec's list of what must be preserved — profile, interest, stage,
 * activities, tasks, documents, attribution, ownership history — is really one
 * instruction: change the owner and touch nothing else. So this updates
 * `assignedICRId` on InstitutionInterest rows and does no more. It creates no
 * student records ("Do not create new student records during reassignment"),
 * moves no stages, and rewrites no history.
 *
 * GET  — who is still assigned to the outgoing ICR, so the RM can choose.
 * POST — reassign all of them, or a named subset ("allow individual
 *        exceptions").
 */

const postSchema = z.object({
  toUserId: z.string().min(1, "Choose who the students should move to"),
  /** Omit to move everything in scope; supply ids to move only those. */
  interestIds: z.array(z.string().min(1)).optional(),
});

async function loadReport(id: string) {
  return db.transitionReport.findUnique({
    where: { id },
    select: {
      id: true, status: true, outgoingIcrId: true, regionalManagerId: true,
      institutionId: true, incomingIcrId: true,
    },
  });
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const role = session.user.role as Role;
    if (!(await effectiveHasPermission(role, "icr_transition", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const report = await loadReport(id);
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    // Scoped to the assignment (§7), not to everything the ICR touches.
    const interests = await db.institutionInterest.findMany({
      where: {
        institutionId: report.institutionId,
        assignedICRId: report.outgoingIcrId,
        closedAt: null,
      },
      select: {
        id: true, stage: true, intakeYear: true, intakeMonth: true,
        lead: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { stage: "asc" },
    });

    return NextResponse.json({
      data: { interests, suggestedOwnerId: report.incomingIcrId },
    });
  } catch (err) {
    console.error("[GET reassign]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const role = session.user.role as Role;
    if (!(await effectiveHasPermission(role, "icr_transition", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const report = await loadReport(id);
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    if (isLocked(report.status)) {
      return NextResponse.json(
        { error: "This report is final; students can no longer be reassigned through it." },
        { status: 409 }
      );
    }

    // Spec §16 puts Bulk Reassign in the RM's hands. canReview also blocks the
    // outgoing ICR from running it on their own report, which matters here
    // because reassigning your own pipeline is how you clear the finalisation
    // gate without anyone reviewing the handover.
    if (!canReview(report, session.user.id, role)) {
      return NextResponse.json(
        { error: "Only the assigned Regional Manager can reassign this pipeline." },
        { status: 403 }
      );
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = postSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Validation failed" },
        { status: 422 }
      );
    }
    const { toUserId, interestIds } = parsed.data;

    if (toUserId === report.outgoingIcrId) {
      return NextResponse.json(
        { error: "That is the outgoing ICR. Choose a different owner." },
        { status: 422 }
      );
    }

    const target = await db.user.findFirst({
      where: { id: toUserId, deletedAt: null, isActive: true },
      select: { id: true, name: true, email: true, role: true },
    });
    if (!target) {
      return NextResponse.json({ error: "That person was not found." }, { status: 422 });
    }
    // Handing a student pipeline to someone with no entitlement to leads would
    // orphan it more quietly than leaving it where it is.
    if (!(await effectiveHasPermission(target.role as Role, "leads", "read"))) {
      return NextResponse.json(
        { error: `${target.name ?? target.email} cannot be given student records.` },
        { status: 422 }
      );
    }

    const scope = {
      institutionId: report.institutionId,
      assignedICRId: report.outgoingIcrId,
      closedAt: null,
      ...(interestIds?.length ? { id: { in: interestIds } } : {}),
    };

    const moving = await db.institutionInterest.findMany({
      where: scope, select: { id: true },
    });
    if (moving.length === 0) {
      return NextResponse.json(
        { error: "There is nothing left to reassign." },
        { status: 409 }
      );
    }

    // The whole operation: one column, on rows already scoped to this
    // assignment. Nothing else is written, which is what preserves stage,
    // activities, tasks, documents and attribution.
    const result = await db.institutionInterest.updateMany({
      where: scope,
      data: { assignedICRId: toUserId },
    });

    // Ownership history lives in the audit trail, not in a column overwritten
    // by the next reassignment.
    await db.auditLog.create({
      data: {
        userId: session.user.id,
        action: "UPDATE",
        entity: "TransitionReport",
        entityId: id,
        changes: {
          reassigned: result.count,
          from: report.outgoingIcrId,
          to: toUserId,
          institutionId: report.institutionId,
          interestIds: moving.map((m) => m.id),
        },
      },
    }).catch((e) => console.error("[reassign audit]", e));

    const remaining = await db.institutionInterest.count({
      where: {
        institutionId: report.institutionId,
        assignedICRId: report.outgoingIcrId,
        closedAt: null,
      },
    });

    return NextResponse.json({
      data: {
        reassigned: result.count,
        remaining,
        to: target.name ?? target.email,
      },
    });
  } catch (err) {
    console.error("[POST reassign]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
