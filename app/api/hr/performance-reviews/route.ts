import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { handleApiError } from "@/lib/api-validation";
import { logActivity } from "@/lib/activity-logger";
import {
  actorFor, isReviewAdmin, refuseWrite, visibleReviewWhere,
  REVIEW_SELECT, REVIEW_STATUSES, SCORE_MIN, SCORE_MAX,
} from "@/lib/review-access";
import { notifyReviewCompleted } from "@/lib/review-notify";

/**
 * ★ VALIDATION USED TO BE THE BROWSER'S JOB ALONE.
 *
 * The form carries min="0" max="5" and the API carried `parseFloat(score)`
 * with no bounds at all, so anything that skipped the form was taken at its
 * word: a score of 97, a score of -3, and the word "banana" (parseFloat gives
 * NaN) were all accepted with a 201. Everything the form claims is checked
 * here now, because the form is a convenience and this is the gate.
 */
const reviewSchema = z.object({
  employeeId: z.string().min(1, "Choose an employee"),
  period: z.string().trim().min(1, "Period is required").max(60),
  score: z
    .number()
    // Guards NaN specifically: the old route ran parseFloat on whatever came
    // in, and parseFloat("banana") is NaN, which is a number and passes min
    // and max without complaint.
    .refine(Number.isFinite, "Score must be a number")
    .min(SCORE_MIN, `Score cannot be below ${SCORE_MIN}`)
    .max(SCORE_MAX, `Score cannot be above ${SCORE_MAX}`)
    .nullable()
    .optional(),
  strengths: z.string().max(20_000).nullable().optional(),
  improvements: z.string().max(20_000).nullable().optional(),
  goals: z.string().max(20_000).nullable().optional(),
  status: z.enum(REVIEW_STATUSES).default("PENDING"),
});

// ─── GET /api/hr/performance-reviews ──────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const actor = await actorFor(session);

    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId");
    const status = searchParams.get("status");

    /**
     * ★ THE FEED IS SCOPED NOW.
     *
     * It used to run findMany with whatever filter the caller passed and
     * nothing else, so anybody who got through the erp_hr check read every
     * review in the company. The scope is the floor; employeeId and status
     * narrow it further but cannot widen it.
     */
    const scope = await visibleReviewWhere(actor);
    const where: Record<string, unknown> = {
      AND: [
        scope,
        ...(employeeId ? [{ employeeId }] : []),
        ...(status ? [{ status }] : []),
      ],
    };

    const reviews = await db.performanceReview.findMany({
      where,
      select: REVIEW_SELECT,
      orderBy: { createdAt: "desc" },
    });

    const canWrite = await isReviewAdmin(actor, "write");
    const canDelete = await isReviewAdmin(actor, "delete");

    /**
     * ★ WHO THIS PERSON MAY REVIEW, ANSWERED HERE.
     *
     * The screen used to populate its picker from /api/hr/employees with no
     * limit, which was wrong twice over: that endpoint defaults to 50 rows, so
     * half the company could not be chosen, and it is gated on HR_ROLES, so a
     * manager got a 403 and an empty dropdown with no explanation.
     *
     * The rule already lives on the server, so the list comes from the server.
     * An empty list is also the answer to "may I write one at all".
     */
    const reviewable = canWrite
      ? await db.employee.findMany({
          where: {
            isActive: true,
            user: { deletedAt: null },
            // Nobody reviews themselves, so nobody is offered themselves.
            ...(actor.employeeId ? { id: { not: actor.employeeId } } : {}),
          },
          select: {
            id: true, employeeId: true, jobTitle: true,
            user: { select: { name: true } },
          },
          orderBy: { employeeId: "asc" },
        })
      : actor.employeeId
        ? await db.employee.findMany({
            where: { managerId: actor.employeeId, isActive: true, user: { deletedAt: null } },
            select: {
              id: true, employeeId: true, jobTitle: true,
              user: { select: { name: true } },
            },
            orderBy: { employeeId: "asc" },
          })
        : [];

    return NextResponse.json({
      reviews: reviews.map((r) => ({
        ...r,
        // Kept for the existing table, which reads reviewerName directly.
        reviewerName: r.reviewer?.user.name ?? "Unknown",
      })),
      canWrite,
      canDelete,
      myEmployeeId: actor.employeeId,
      reviewable: reviewable.map((e) => ({
        id: e.id,
        employeeId: e.employeeId,
        jobTitle: e.jobTitle,
        name: e.user.name ?? e.employeeId,
      })),
    });
  } catch (error) {
    return handleApiError(error, "[GET /api/hr/performance-reviews]");
  }
}

// ─── POST /api/hr/performance-reviews ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const actor = await actorFor(session);

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const parsed = reviewSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Validation failed", details: parsed.error.flatten() },
        { status: 422 }
      );
    }
    const data = parsed.data;

    const employee = await db.employee.findUnique({
      where: { id: data.employeeId },
      select: { id: true },
    });
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const refusal = await refuseWrite(actor, data.employeeId);
    if (refusal) {
      return NextResponse.json({ error: refusal.error }, { status: refusal.status });
    }

    if (!actor.employeeId) {
      return NextResponse.json(
        { error: "A reviewer needs an employee record of their own." },
        { status: 422 }
      );
    }

    // The database enforces one review per (employee, period); checked here so
    // the answer is a readable 409 rather than a unique-constraint 500.
    const clash = await db.performanceReview.findFirst({
      where: { employeeId: data.employeeId, period: data.period },
      select: { id: true },
    });
    if (clash) {
      return NextResponse.json(
        { error: `There is already a review for ${data.period}. Edit that one instead.` },
        { status: 409 }
      );
    }

    const review = await db.performanceReview.create({
      data: {
        employeeId: data.employeeId,
        reviewerId: actor.employeeId,
        period: data.period,
        score: data.score ?? null,
        strengths: data.strengths || null,
        improvements: data.improvements || null,
        goals: data.goals || null,
        status: data.status,
        completedAt: data.status === "COMPLETED" ? new Date() : null,
      },
      select: REVIEW_SELECT,
    });

    void logActivity(session.user.id, "CREATE", "PerformanceReview", review.id, {
      route: "hr/performance-reviews",
      employeeId: data.employeeId,
      period: data.period,
      status: data.status,
    });

    // Written complete in one go — tell them straight away.
    if (data.status === "COMPLETED") {
      void notifyReviewCompleted(review.id).catch((err) =>
        console.error("[POST /api/hr/performance-reviews] notify failed:", err)
      );
    }

    return NextResponse.json({ review }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "[POST /api/hr/performance-reviews]");
  }
}
