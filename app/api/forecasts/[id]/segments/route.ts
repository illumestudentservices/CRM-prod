import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import type { ForecastSegmentKey } from "@prisma/client";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { assertNoNulBytes, ApiError } from "@/lib/api-validation";
import {
  FORECAST_SEGMENTS, canEditIcrValues, canReview, isLocked,
} from "@/lib/forecasting";

/**
 * Enter or adjust the judgement figures for one segment.
 *
 * This route is where spec §13 is enforced. Two callers write to the same row
 * but to DIFFERENT columns: the ICR writes icr*, the Regional Manager writes
 * rm*. The RM has no path to the ICR's columns at all — not a rule applied at
 * runtime, but a shape the request cannot express, because "RM adjustments must
 * create separate RM forecast values rather than overwriting the ICR
 * submission" is the clause the module's accountability rests on.
 */

const SEGMENT_KEYS = FORECAST_SEGMENTS as readonly string[];

const patchSchema = z.object({
  segment: z.string().refine((s) => SEGMENT_KEYS.includes(s), "Unknown segment"),
  applications: z.number().int().min(0).max(100000),
  deposits: z.number().int().min(0).max(100000),
  enrolments: z.number().int().min(0).max(100000),
  /**
   * Clears an RM adjustment, returning the segment to the ICR's figure. Needed
   * because null and zero mean different things here, so there has to be a way
   * to express "actually, I agree" that is not "adjust it to the same number".
   */
  clearAdjustment: z.boolean().optional(),
});

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const role = session.user.role as Role;
    if (!(await effectiveHasPermission(role, "forecasting", "write"))) {
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
        { error: parsed.error.issues[0]?.message ?? "Validation failed" },
        { status: 422 }
      );
    }
    const d = parsed.data;

    const forecast = await db.forecast.findUnique({
      where: { id },
      select: { id: true, status: true, icrId: true, regionalManagerId: true },
    });
    if (!forecast) return NextResponse.json({ error: "Forecast not found" }, { status: 404 });

    if (isLocked(forecast.status)) {
      return NextResponse.json(
        { error: "This forecast has been accepted and can no longer be changed." },
        { status: 409 }
      );
    }

    const asIcr = canEditIcrValues(forecast, session.user.id, role);
    const asRm = canReview(forecast, session.user.id, role);

    if (!asIcr && !asRm) {
      return NextResponse.json(
        {
          error:
            forecast.status === "SUBMITTED_TO_RM"
              ? "This forecast is with the Regional Manager and cannot be edited until it is returned."
              : "You cannot change this forecast.",
        },
        { status: 403 }
      );
    }

    // A funnel that widens as it descends is an entry error whichever role
    // types it, so it is refused on the way in rather than at submission.
    if (d.deposits > d.applications || d.enrolments > d.deposits) {
      return NextResponse.json(
        { error: "Deposits cannot exceed applications, and enrolments cannot exceed deposits." },
        { status: 422 }
      );
    }

    const segment = d.segment as ForecastSegmentKey;

    // The whole of §13 in one branch: the ICR path touches only icr* columns,
    // the RM path only rm*. Neither can reach the other's.
    const data = asIcr
      ? {
          icrApplications: d.applications,
          icrDeposits: d.deposits,
          icrEnrolments: d.enrolments,
        }
      : d.clearAdjustment
        ? { rmApplications: null, rmDeposits: null, rmEnrolments: null }
        : {
            rmApplications: d.applications,
            rmDeposits: d.deposits,
            rmEnrolments: d.enrolments,
          };

    const updated = await db.forecastSegment.update({
      where: { forecastId_segment: { forecastId: id, segment } },
      data,
      select: {
        segment: true,
        icrApplications: true, icrDeposits: true, icrEnrolments: true,
        rmApplications: true, rmDeposits: true, rmEnrolments: true,
      },
    });

    return NextResponse.json({
      data: updated,
      wroteAs: asIcr ? "icr" : "rm",
    });
  } catch (err) {
    console.error("[PATCH /api/forecasts/[id]/segments]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
