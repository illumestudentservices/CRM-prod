import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";

// ─── GET /api/hr/performance-reviews/[id] ─────────────────────────────────────

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await effectiveHasPermission(session.user.role, "erp_hr", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const review = await db.performanceReview.findUnique({
      where: { id },
      include: {
        employee: {
          include: { user: { select: { id: true, name: true, image: true } } },
        },
      },
    });

    if (!review) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    // Fetch reviewer details
    const reviewer = await db.employee.findUnique({
      where: { id: review.reviewerId },
      include: { user: { select: { id: true, name: true } } },
    });

    return NextResponse.json({
      review: {
        ...review,
        reviewerName: reviewer?.user.name ?? "Unknown",
        reviewer,
      },
    });
  } catch (error) {
    console.error("[GET /api/hr/performance-reviews/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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

    if (!(await effectiveHasPermission(session.user.role, "erp_hr", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await db.performanceReview.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    const body = await req.json();
    const { period, score, strengths, improvements, goals, status } = body;

    const data: Record<string, unknown> = {};
    if (period !== undefined) data.period = period;
    if (score !== undefined) data.score = score != null ? parseFloat(score) : null;
    if (strengths !== undefined) data.strengths = strengths;
    if (improvements !== undefined) data.improvements = improvements;
    if (goals !== undefined) data.goals = goals;
    if (status !== undefined) {
      data.status = status;
      // Set completedAt when status changes to COMPLETED
      if (status === "COMPLETED" && existing.status !== "COMPLETED") {
        data.completedAt = new Date();
      }
      // Clear completedAt if reverting from COMPLETED
      if (status !== "COMPLETED" && existing.status === "COMPLETED") {
        data.completedAt = null;
      }
    }

    const review = await db.performanceReview.update({
      where: { id },
      data,
      include: {
        employee: {
          include: { user: { select: { id: true, name: true } } },
        },
      },
    });

    return NextResponse.json({ review });
  } catch (error) {
    console.error("[PATCH /api/hr/performance-reviews/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── DELETE /api/hr/performance-reviews/[id] ──────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await effectiveHasPermission(session.user.role, "erp_hr", "delete"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;

    const existing = await db.performanceReview.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Review not found" }, { status: 404 });
    }

    await db.performanceReview.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[DELETE /api/hr/performance-reviews/[id]]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
