import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";

// ─── GET /api/hr/performance-reviews ──────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await effectiveHasPermission(session.user.role, "erp_hr", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const employeeId = searchParams.get("employeeId");
    const status = searchParams.get("status");

    const where: Record<string, unknown> = {};
    if (employeeId) where.employeeId = employeeId;
    if (status) where.status = status;

    const reviews = await db.performanceReview.findMany({
      where,
      include: {
        employee: {
          include: { user: { select: { id: true, name: true, image: true } } },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    // Fetch reviewer names separately since reviewerId is a plain string (not a relation)
    const reviewerIds = [...new Set(reviews.map((r) => r.reviewerId))];
    const reviewerEmployees = await db.employee.findMany({
      where: { id: { in: reviewerIds } },
      include: { user: { select: { id: true, name: true } } },
    });
    const reviewerMap = new Map(
      reviewerEmployees.map((e) => [e.id, e.user.name ?? "Unknown"])
    );

    const enriched = reviews.map((r) => ({
      ...r,
      reviewerName: reviewerMap.get(r.reviewerId) ?? "Unknown",
    }));

    return NextResponse.json({ reviews: enriched });
  } catch (error) {
    console.error("[GET /api/hr/performance-reviews]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/hr/performance-reviews ─────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await effectiveHasPermission(session.user.role, "erp_hr", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await req.json();
    const { employeeId, period, score, strengths, improvements, goals, status } = body;

    if (!employeeId || !period) {
      return NextResponse.json(
        { error: "employeeId and period are required" },
        { status: 422 }
      );
    }

    // Resolve reviewer from session user's employee record
    const reviewerEmployee = await db.employee.findUnique({
      where: { userId: session.user.id },
      select: { id: true },
    });

    if (!reviewerEmployee) {
      return NextResponse.json(
        { error: "Reviewer must have an employee record" },
        { status: 422 }
      );
    }

    // Verify employee exists
    const employee = await db.employee.findUnique({ where: { id: employeeId } });
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    const review = await db.performanceReview.create({
      data: {
        employeeId,
        reviewerId: reviewerEmployee.id,
        period,
        score: score != null ? parseFloat(score) : null,
        strengths: strengths || null,
        improvements: improvements || null,
        goals: goals || null,
        status: status || "PENDING",
        completedAt: status === "COMPLETED" ? new Date() : null,
      },
      include: {
        employee: {
          include: { user: { select: { id: true, name: true } } },
        },
      },
    });

    return NextResponse.json({ review }, { status: 201 });
  } catch (error) {
    console.error("[POST /api/hr/performance-reviews]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
