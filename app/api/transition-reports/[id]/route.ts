import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import {
  TRANSITION_SECTIONS, canEditContent, canReview, canSubmit, isLocked,
} from "@/lib/icr-transition";

/**
 * One Transition Report, with the live CRM context each section needs.
 *
 * Spec §3 is the rule this route exists to honour: "Retrieve existing CRM
 * information → Present it within the Transition Report → Ask the outgoing ICR
 * to comment." So the pipeline, tasks and risks below are read from their
 * owning modules on every request rather than copied into the report.
 *
 * Once the report is Final the stored snapshot is returned instead. That is the
 * whole point of §37 — a student who was at Offer Received on the handover date
 * must still read Offer Received here after they enrol.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const role = session.user.role as Role;
    if (!(await effectiveHasPermission(role, "icr_transition", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;
    const report = await db.transitionReport.findUnique({
      where: { id },
      include: {
        institution: { select: { id: true, name: true, country: true, accountHealth: true } },
        outgoingIcr: { select: { id: true, name: true, email: true } },
        incomingIcr: { select: { id: true, name: true, email: true } },
        regionalManager: { select: { id: true, name: true } },
        region: { select: { id: true, name: true } },
        markets: { select: { market: { select: { id: true, name: true } } } },
        sections: { orderBy: { section: "asc" } },
        events: {
          orderBy: { createdAt: "desc" },
          include: { actedBy: { select: { id: true, name: true } } },
        },
      },
    });
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    // Row-level entitlement. The list endpoint scopes its query; a direct id
    // fetch has to check the same thing or the scope is decorative.
    const isParticipant =
      report.outgoingIcrId === session.user.id ||
      report.incomingIcrId === session.user.id ||
      report.regionalManagerId === session.user.id ||
      report.clientRelationsDirectorId === session.user.id ||
      report.vpGlobalSalesId === session.user.id;
    const seesEverything = role === "SUPER_ADMIN" || role === "HQ_EXECUTIVE";
    const readsFinalOnly =
      (role === "VP_GLOBAL_SALES" || role === "ACCOUNT_MANAGER") &&
      (report.status === "FINAL" || report.status === "ARCHIVED");

    if (!seesEverything && !isParticipant && !readsFinalOnly) {
      // 404 rather than 403: confirming a report exists for an ICR and an
      // institution is itself information about who is leaving.
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    const gate = canSubmit(report.sections, report.declarationConfirmedAt);

    // Final reports read from the frozen snapshot; live ones read the CRM.
    const context = report.snapshot
      ? { source: "snapshot" as const, capturedAt: report.snapshotAt, ...(report.snapshot as object) }
      : { source: "live" as const, ...(await liveContext(report.institutionId, report.outgoingIcrId)) };

    return NextResponse.json({
      data: {
        ...report,
        sections: TRANSITION_SECTIONS.map((def) => {
          const row = report.sections.find((s) => s.section === def.key);
          return {
            key: def.key,
            title: def.title,
            spec: def.spec,
            required: def.requiredForSubmission,
            narrative: row?.narrative ?? null,
            data: row?.data ?? null,
            completedAt: row?.completedAt ?? null,
          };
        }),
        context,
        permissions: {
          canEdit: canEditContent(report, session.user.id, role),
          canReview: canReview(report, session.user.id, role),
          locked: isLocked(report.status),
        },
        readiness: gate,
      },
    });
  } catch (err) {
    console.error("[GET /api/transition-reports/[id]]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/** Live figures from the owning modules, scoped to this assignment (§7). */
async function liveContext(institutionId: string, icrId: string) {
  const employee = await db.employee.findUnique({
    where: { userId: icrId },
    select: { id: true },
  });

  const [pipeline, tasks, risks, events] = await Promise.all([
    db.institutionInterest.findMany({
      where: { institutionId, closedAt: null },
      select: {
        id: true, stage: true, assignedICRId: true, intakeYear: true, intakeMonth: true,
        lead: { select: { id: true, firstName: true, lastName: true, stage: true } },
      },
      orderBy: { stage: "asc" },
    }),
    employee
      ? db.task.findMany({
          where: { assigneeId: employee.id, status: { notIn: ["COMPLETED", "DONE", "CANCELLED"] } },
          select: { id: true, title: true, status: true, priority: true, dueDate: true },
          orderBy: { dueDate: "asc" },
        })
      : [],
    db.riskRegister.findMany({
      where: { ownerId: icrId, status: { in: ["OPEN", "ESCALATED"] } },
      select: { id: true, title: true, status: true, impact: true, likelihood: true },
    }),
    db.event.findMany({
      where: { deletedAt: null, date: { gte: new Date(Date.now() - 180 * 864e5) } },
      select: { id: true, name: true, type: true, status: true, date: true },
      take: 20,
      orderBy: { date: "desc" },
    }),
  ]);

  return {
    pipeline,
    tasks,
    risks,
    events,
    counts: {
      activeInterests: pipeline.length,
      stillOwnedByOutgoing: pipeline.filter((p) => p.assignedICRId === icrId).length,
      openTasks: tasks.length,
      openRisks: risks.length,
    },
  };
}
