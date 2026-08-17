import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import {
  FORECAST_STATUSES, canMove, canEditIcrValues, canAdvanceAsRm, canAccept,
  canSubmit, isLocked, pipelineMaturity,
} from "@/lib/forecasting";
import { computePipeline, maturityInput } from "@/lib/forecast-pipeline";

/**
 * Move a forecast through its workflow (spec §11–§18).
 *
 * One route for every transition so the state machine, the "who may act" rules
 * and the submission gate are applied identically. Separate submit/review/accept
 * routes are how three copies of a rule end up disagreeing.
 */

const bodySchema = z.object({
  to: z.enum(FORECAST_STATUSES),
  comments: z.string().max(5000).optional().nullable(),
});

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const role = session.user.role as Role;
    if (!(await effectiveHasPermission(role, "forecasting", "read"))) {
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

    const forecast = await db.forecast.findUnique({
      where: { id },
      select: {
        id: true, status: true, icrId: true, regionalManagerId: true,
        institutionId: true, intakeYear: true, intakeMonth: true,
        confidenceScore: true, rationale: true,
        segments: {
          select: {
            segment: true,
            icrApplications: true, icrDeposits: true, icrEnrolments: true,
            rmApplications: true, rmDeposits: true, rmEnrolments: true,
          },
        },
      },
    });
    if (!forecast) return NextResponse.json({ error: "Forecast not found" }, { status: 404 });

    if (isLocked(forecast.status)) {
      return NextResponse.json(
        { error: "This forecast has been accepted and can no longer be changed." },
        { status: 409 }
      );
    }
    if (!canMove(forecast.status, to)) {
      return NextResponse.json(
        { error: `A forecast cannot move from ${forecast.status} to ${to}.` },
        { status: 409 }
      );
    }

    // ── Who may make THIS move ────────────────────────────────────────────
    const icrMoves = ["SUBMITTED_TO_RM"];
    const rmMoves = ["RETURNED_TO_ICR", "RM_REVIEWED", "REGIONAL_SUBMITTED"];
    const vpMoves = ["ACCEPTED", "RETURNED_TO_RM"];

    if (icrMoves.includes(to)) {
      if (!canEditIcrValues(forecast, session.user.id, role)) {
        return NextResponse.json(
          { error: "Only the ICR who owns this forecast can submit it." },
          { status: 403 }
        );
      }
    } else if (rmMoves.includes(to)) {
      if (!canAdvanceAsRm(forecast, session.user.id, role)) {
        return NextResponse.json(
          { error: "Only the Regional Manager can review this forecast." },
          { status: 403 }
        );
      }
    } else if (vpMoves.includes(to)) {
      if (!canAccept(forecast, session.user.id, role)) {
        return NextResponse.json(
          { error: "Only the VP of Global Sales can accept or return a regional submission." },
          { status: 403 }
        );
      }
    }

    // ── Gates ─────────────────────────────────────────────────────────────
    let maturity: ReturnType<typeof pipelineMaturity> | undefined;

    if (to === "SUBMITTED_TO_RM") {
      const gate = canSubmit(forecast.segments, forecast.confidenceScore, forecast.rationale);
      if (!gate.ok) {
        return NextResponse.json(
          { error: "This forecast is not ready to submit.", reasons: gate.errors },
          { status: 422 }
        );
      }
      // Spec §10: maturity is recorded at submission, so it reflects where the
      // pipeline stood when the judgement was made rather than whatever it
      // looks like whenever someone next opens the record.
      const pipeline = await computePipeline({
        institutionId: forecast.institutionId,
        intakeYear: forecast.intakeYear,
        intakeMonth: forecast.intakeMonth,
        icrId: forecast.icrId,
      });
      maturity = pipelineMaturity(maturityInput(pipeline));
    }

    // Spec §13: an adjustment without a reason is not reviewable, and returning
    // work without saying why makes the round trip useless.
    if ((to === "RETURNED_TO_ICR" || to === "RETURNED_TO_RM") && !comments?.trim()) {
      return NextResponse.json(
        { error: "Explain what needs to change before returning the forecast." },
        { status: 422 }
      );
    }
    if (to === "RM_REVIEWED") {
      const adjusted = forecast.segments.some(
        (s) => s.rmApplications !== null || s.rmDeposits !== null || s.rmEnrolments !== null
      );
      if (adjusted && !comments?.trim()) {
        return NextResponse.json(
          { error: "You have adjusted the ICR's figures. Record why before continuing." },
          { status: 422 }
        );
      }
    }

    const now = new Date();
    const updated = await db.$transaction(async (tx) => {
      const f = await tx.forecast.update({
        where: { id },
        data: {
          status: to,
          ...(maturity ? { pipelineMaturity: maturity } : {}),
          ...(to === "SUBMITTED_TO_RM" ? { submittedAt: now } : {}),
          ...(to === "RM_REVIEWED"
            ? { rmReviewedAt: now, regionalManagerId: session.user.id, rmComment: comments?.trim() || null }
            : {}),
          ...(to === "REGIONAL_SUBMITTED" ? { regionalSubmittedAt: now } : {}),
          ...(to === "ACCEPTED"
            ? { acceptedAt: now, vpReviewerId: session.user.id, vpComment: comments?.trim() || null }
            : {}),
        },
        select: { id: true, status: true, pipelineMaturity: true, acceptedAt: true },
      });
      await tx.forecastEvent.create({
        data: {
          forecastId: id,
          fromStatus: forecast.status,
          toStatus: to,
          actedById: session.user.id,
          comments: comments?.trim() || null,
        },
      });
      return f;
    });

    return NextResponse.json({ data: updated });
  } catch (err) {
    console.error("[POST /api/forecasts/[id]/status]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
