import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { trashRecord } from "@/lib/recycle-bin";
import { handleApiError } from "@/lib/api-validation";
import { logActivity } from "@/lib/activity-logger";
import {
  actorFor, isReviewAdmin, refuseEdit, visibleReviewWhere,
  REVIEW_SELECT, REVIEW_STATUSES, SCORE_MIN, SCORE_MAX,
} from "@/lib/review-access";
import { notifyReviewCompleted } from "@/lib/review-notify";

const patchSchema = z
  .object({
    period: z.string().trim().min(1).max(60).optional(),
    score: z
      .number()
      .refine(Number.isFinite, "Score must be a number")
      .min(SCORE_MIN, `Score cannot be below ${SCORE_MIN}`)
      .max(SCORE_MAX, `Score cannot be above ${SCORE_MAX}`)
      .nullable()
      .optional(),
    strengths: z.string().max(20_000).nullable().optional(),
    improvements: z.string().max(20_000).nullable().optional(),
    goals: z.string().max(20_000).nullable().optional(),
    status: z.enum(REVIEW_STATUSES).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "Nothing to change" });

// ─── GET /api/hr/performance-reviews/[id] ─────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const actor = await actorFor(session);

    /**
     * Scoped, not findUnique. The old route checked erp_hr and then fetched by
     * id, so anybody holding the permission could read any review — and now
     * that managers and subjects can read at all, an unscoped lookup would let
     * anyone with an id read a colleague's appraisal. 404 covers "not yours"
     * and "not there" alike, so the two cannot be told apart.
     */
    const review = await db.performanceReview.findFirst({
      where: { AND: [{ id }, await visibleReviewWhere(actor)] },
      select: REVIEW_SELECT,
    });
    if (!review) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    return NextResponse.json({
      review: { ...review, reviewerName: review.reviewer?.user.name ?? "Unknown" },
    });
  } catch (error) {
    return handleApiError(error, "[GET /api/hr/performance-reviews/[id]]");
  }
}

// ─── PATCH /api/hr/performance-reviews/[id] ───────────────────────────────────

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const actor = await actorFor(session);

    const existing = await db.performanceReview.findUnique({
      where: { id },
      select: { id: true, employeeId: true, reviewerId: true, status: true, period: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    // The subject can read a completed review; they must not be able to edit
    // it. refuseEdit never grants on "it is about me".
    const refusal = await refuseEdit(actor, existing);
    if (refusal) {
      return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    }

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = patchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 422 }
      );
    }
    const data = parsed.data;

    // Moving a review to a period that already has one would hit the unique
    // constraint as a 500; answered here instead.
    if (data.period && data.period !== existing.period) {
      const clash = await db.performanceReview.findFirst({
        where: { employeeId: existing.employeeId, period: data.period, id: { not: id } },
        select: { id: true },
      });
      if (clash) {
        return NextResponse.json(
          { error: `There is already a review for ${data.period}.` },
          { status: 409 }
        );
      }
    }

    const nowComplete =
      data.status === "COMPLETED" && existing.status !== "COMPLETED";

    const review = await db.performanceReview.update({
      where: { id },
      data: {
        ...(data.period !== undefined ? { period: data.period } : {}),
        ...(data.score !== undefined ? { score: data.score } : {}),
        ...(data.strengths !== undefined ? { strengths: data.strengths || null } : {}),
        ...(data.improvements !== undefined ? { improvements: data.improvements || null } : {}),
        ...(data.goals !== undefined ? { goals: data.goals || null } : {}),
        ...(data.status !== undefined ? { status: data.status } : {}),
        // Stamped when it first completes; cleared if it is reopened, so the
        // date never claims a completion that was undone.
        ...(data.status === "COMPLETED"
          ? { completedAt: existing.status === "COMPLETED" ? undefined : new Date() }
          : data.status !== undefined
            ? { completedAt: null }
            : {}),
      },
      select: REVIEW_SELECT,
    });

    void logActivity(session.user.id, "UPDATE", "PerformanceReview", id, {
      route: "hr/performance-reviews/[id]",
      fields: Object.keys(data),
    });

    /**
     * Only on the transition into COMPLETED. Firing on every save of an
     * already-complete review would email somebody each time a typo was fixed
     * in it.
     */
    if (nowComplete) {
      void notifyReviewCompleted(id).catch((err) =>
        console.error("[PATCH /api/hr/performance-reviews/[id]] notify failed:", err)
      );
    }

    return NextResponse.json({
      review: { ...review, reviewerName: review.reviewer?.user.name ?? "Unknown" },
    });
  } catch (error) {
    return handleApiError(error, "[PATCH /api/hr/performance-reviews/[id]]");
  }
}

// ─── DELETE /api/hr/performance-reviews/[id] ──────────────────────────────────

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { id } = await params;
    const actor = await actorFor(session);

    /**
     * Deleting needs erp_hr:delete, which a line manager does not hold.
     * Writing an appraisal and destroying one are different acts: a manager
     * may say what they think, and removing the record of what was said is an
     * administrator's decision.
     */
    if (!(await isReviewAdmin(actor, "delete"))) {
      return NextResponse.json(
        { error: "Only an administrator can delete a performance review." },
        { status: 403 }
      );
    }

    const existing = await db.performanceReview.findUnique({
      where: { id },
      select: { id: true, employeeId: true, period: true },
    });
    if (!existing) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    await trashRecord({ entityType: "PerformanceReview", entityId: id, userId: session.user.id });

    void logActivity(session.user.id, "DELETE", "PerformanceReview", id, {
      route: "hr/performance-reviews/[id]",
      employeeId: existing.employeeId,
      period: existing.period,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return handleApiError(error, "[DELETE /api/hr/performance-reviews/[id]]");
  }
}
