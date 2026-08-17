import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { assertNoNulBytes, ApiError } from "@/lib/api-validation";
import { TRANSITION_SECTIONS, canEditContent, sectionTitle } from "@/lib/icr-transition";

/**
 * Save the outgoing ICR's commentary for one section.
 *
 * Content only. Nothing here can change the report's status — that is the
 * status route's job — so saving a draft can never accidentally submit it.
 */

const SECTION_KEYS = TRANSITION_SECTIONS.map((s) => s.key) as [string, ...string[]];

const patchSchema = z.object({
  section: z.enum(SECTION_KEYS),
  narrative: z.string().max(50_000).optional().nullable(),
  data: z.record(z.string(), z.unknown()).optional().nullable(),
  /**
   * Marking complete is separate from writing text so an ICR can save a draft
   * without asserting the section is finished. Submission requires both.
   */
  completed: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const role = session.user.role as Role;
    if (!(await effectiveHasPermission(role, "icr_transition", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await ctx.params;

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    try {
      assertNoNulBytes(body);
    } catch (e) {
      if (e instanceof ApiError) return NextResponse.json({ error: e.message }, { status: e.status });
      throw e;
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "Validation failed", details: parsed.error.flatten() },
        { status: 422 }
      );
    }
    const d = parsed.data;

    const report = await db.transitionReport.findUnique({
      where: { id },
      select: { id: true, status: true, outgoingIcrId: true, regionalManagerId: true },
    });
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    // canEditContent covers all three rules at once: the report is not locked,
    // the caller is the outgoing ICR (or an admin), and the status is one the
    // ICR may still write in. A Regional Manager holds icr_transition:write for
    // assigning reports, and must not be able to rewrite the ICR's account of
    // the handover through this route.
    if (!canEditContent(report, session.user.id, role)) {
      return NextResponse.json(
        {
          error:
            report.status === "SUBMITTED_TO_RM" || report.status === "RESUBMITTED"
              ? "This report is with the Regional Manager and cannot be edited until it is returned."
              : "Only the outgoing ICR can edit this report.",
        },
        { status: 403 }
      );
    }

    const narrative = d.narrative?.trim() ?? null;

    // Completing a section with nothing written is a tick-box. The submission
    // gate rejects it later anyway; refusing here says so while the ICR is
    // still looking at the field.
    if (d.completed === true && !narrative) {
      return NextResponse.json(
        { error: `Write your handover notes for ${sectionTitle(d.section as never)} before marking it complete.` },
        { status: 422 }
      );
    }

    const updated = await db.transitionReportSection.update({
      where: { reportId_section: { reportId: id, section: d.section as never } },
      data: {
        ...(d.narrative !== undefined && { narrative }),
        ...(d.data !== undefined && { data: (d.data ?? undefined) as never }),
        ...(d.completed === true && { completedAt: new Date(), completedById: session.user.id }),
        ...(d.completed === false && { completedAt: null, completedById: null }),
      },
      select: { section: true, narrative: true, completedAt: true, updatedAt: true },
    });

    // Writing the first section is what actually starts the work, so the report
    // moves off ASSIGNED here rather than requiring a separate "start" click
    // that adds nothing.
    if (report.status === "ASSIGNED") {
      await db.$transaction([
        db.transitionReport.update({ where: { id }, data: { status: "IN_PROGRESS" } }),
        db.transitionWorkflowEvent.create({
          data: {
            reportId: id,
            fromStatus: "ASSIGNED",
            toStatus: "IN_PROGRESS",
            actedById: session.user.id,
            comments: "Report opened for completion.",
          },
        }),
      ]);
    }

    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error("[PATCH /api/transition-reports/[id]/sections]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
