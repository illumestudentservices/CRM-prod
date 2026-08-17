import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import {
  TRANSITION_STATUSES, canMove, canEditContent, canReview,
  canSubmit, canFinalise, isLocked, type FinalisationFacts,
} from "@/lib/icr-transition";

/**
 * Move a Transition Report through its workflow (spec §5, §26, §27, §33).
 *
 * Every status change goes through this one route so the state machine, the
 * "who may act" rules and the completeness gates are applied identically. The
 * alternative — a submit route, an accept route, a finalise route — is how the
 * lead stage checks ended up disagreeing with each other.
 */

const bodySchema = z.object({
  to: z.enum(TRANSITION_STATUSES),
  comments: z.string().max(5000).optional().nullable(),
});

/**
 * Ask the owning modules what is still attached to the outgoing ICR.
 *
 * Spec §33 blocks finalisation while operational loose ends have no owner, and
 * §36 forbids Transition from storing that data itself — so it is counted live
 * here, scoped to the assignment (§7: this institution, not the whole person).
 */
async function gatherFacts(report: {
  id: string;
  outgoingIcrId: string;
  institutionId: string;
}): Promise<FinalisationFacts> {
  // Task.assigneeId references employees.id, NOT users.id. Counting against
  // the user id silently returns 0 and would let a report finalise with every
  // task still open.
  const employee = await db.employee.findUnique({
    where: { userId: report.outgoingIcrId },
    select: { id: true },
  });

  const [interests, tasks, risks] = await Promise.all([
    // Active interests in THIS institution still pointing at the outgoing ICR.
    db.institutionInterest.count({
      where: {
        institutionId: report.institutionId,
        assignedICRId: report.outgoingIcrId,
        closedAt: null,
      },
    }),
    employee
      ? db.task.count({
          where: {
            assigneeId: employee.id,
            status: { notIn: ["COMPLETED", "DONE", "CANCELLED"] },
            priority: { in: ["HIGH", "URGENT"] },
          },
        })
      : Promise.resolve(0),
    // RiskRegister.impact is an Int, not an enum. 4+ on the 1-5 scale is what
    // the register treats as high or critical.
    db.riskRegister.count({
      where: {
        ownerId: report.outgoingIcrId,
        status: { in: ["OPEN", "ESCALATED"] },
        impact: { gte: 4 },
      },
    }),
  ]);

  return {
    unownedInterests: interests,
    unownedCriticalTasks: tasks,
    unownedCriticalRisks: risks,
    // Forecasting is not built yet. Reporting this as unresolved would block
    // every finalisation on a module that does not exist, so it is false until
    // Forecasting lands and can answer for itself.
    forecastResponsibilityUnresolved: false,
  };
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const role = session.user.role as Role;
    if (!(await effectiveHasPermission(role, "icr_transition", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const parsed = bodySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Validation failed" },
        { status: 422 }
      );
    }
    const { to, comments } = parsed.data;

    const report = await db.transitionReport.findUnique({
      where: { id },
      select: {
        id: true, status: true, outgoingIcrId: true, regionalManagerId: true,
        institutionId: true, declarationConfirmedAt: true,
        sections: { select: { section: true, narrative: true, completedAt: true } },
      },
    });
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    if (isLocked(report.status)) {
      return NextResponse.json(
        { error: "This report is final and can no longer be changed." },
        { status: 409 }
      );
    }

    if (!canMove(report.status, to)) {
      return NextResponse.json(
        { error: `A report cannot move from ${report.status} to ${to}.` },
        { status: 409 }
      );
    }

    // ── Who may make THIS move ────────────────────────────────────────────
    const icrMoves = ["IN_PROGRESS", "SUBMITTED_TO_RM", "RESUBMITTED"];
    const rmMoves = ["AMENDMENTS_REQUIRED", "ACCEPTED_BY_RM", "FINAL"];

    if (icrMoves.includes(to)) {
      if (!canEditContent(report, session.user.id, role)) {
        return NextResponse.json(
          { error: "Only the outgoing ICR can progress their own report." },
          { status: 403 }
        );
      }
    } else if (rmMoves.includes(to)) {
      if (!canReview(report, session.user.id, role)) {
        return NextResponse.json(
          { error: "Only the assigned Regional Manager can review this report." },
          { status: 403 }
        );
      }
    }

    // ── Gates ─────────────────────────────────────────────────────────────
    if (to === "SUBMITTED_TO_RM" || to === "RESUBMITTED") {
      const gate = canSubmit(report.sections, report.declarationConfirmedAt);
      if (!gate.ok) {
        return NextResponse.json(
          { error: "This report is not ready to submit.", reasons: gate.errors, warnings: gate.warnings },
          { status: 422 }
        );
      }
    }

    if (to === "AMENDMENTS_REQUIRED" && !comments?.trim()) {
      // Returning work without saying why makes the round trip useless.
      return NextResponse.json(
        { error: "Explain what needs to change before returning the report." },
        { status: 422 }
      );
    }

    let snapshot: unknown = undefined;
    if (to === "FINAL") {
      const facts = await gatherFacts(report);
      const gate = canFinalise(report.status, report.sections, report.declarationConfirmedAt, facts);
      if (!gate.ok) {
        return NextResponse.json(
          { error: "This report cannot be finalised yet.", reasons: gate.errors, warnings: gate.warnings },
          { status: 422 }
        );
      }
      // Spec §37: freeze what the linked records look like now, because they
      // keep moving afterwards.
      snapshot = await buildSnapshot(report.institutionId, report.outgoingIcrId);
    }

    const now = new Date();
    const updated = await db.$transaction(async (tx) => {
      const r = await tx.transitionReport.update({
        where: { id },
        data: {
          status: to,
          ...(to === "SUBMITTED_TO_RM" || to === "RESUBMITTED" ? { submittedAt: now } : {}),
          ...(to === "ACCEPTED_BY_RM" ? { acceptedAt: now } : {}),
          ...(to === "FINAL" ? { finalisedAt: now, snapshot: snapshot as never, snapshotAt: now } : {}),
          ...(to === "ARCHIVED" ? { archivedAt: now } : {}),
        },
        select: { id: true, status: true, finalisedAt: true },
      });
      await tx.transitionWorkflowEvent.create({
        data: {
          reportId: id,
          fromStatus: report.status,
          toStatus: to,
          actedById: session.user.id,
          comments: comments?.trim() || null,
        },
      });
      return r;
    });

    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error("[POST /api/transition-reports/[id]/status]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * The historical snapshot required by spec §37.
 *
 * Stores figures, not whole records: the live rows remain openable, and this
 * exists so the report still reads "Offer Received" after the student enrols.
 */
async function buildSnapshot(institutionId: string, icrId: string) {
  const [interests, tasks, risks, institution] = await Promise.all([
    db.institutionInterest.findMany({
      where: { institutionId, closedAt: null },
      select: {
        id: true, stage: true, assignedICRId: true,
        lead: { select: { id: true, firstName: true, lastName: true, stage: true } },
      },
    }),
    db.employee.findUnique({ where: { userId: icrId }, select: { id: true } }).then((e) =>
      e
        ? db.task.findMany({
            where: { assigneeId: e.id, status: { notIn: ["COMPLETED", "DONE", "CANCELLED"] } },
            select: { id: true, title: true, status: true, priority: true, dueDate: true },
          })
        : []
    ),
    db.riskRegister.findMany({
      where: { ownerId: icrId, status: { in: ["OPEN", "ESCALATED"] } },
      select: { id: true, title: true, status: true, impact: true },
    }),
    db.institution.findUnique({
      where: { id: institutionId },
      select: { id: true, name: true, accountHealth: true, renewalDate: true },
    }),
  ]);

  return {
    capturedAt: new Date().toISOString(),
    institution,
    pipeline: interests,
    tasks,
    risks,
    counts: {
      activeInterests: interests.length,
      openTasks: tasks.length,
      openRisks: risks.length,
    },
  };
}
