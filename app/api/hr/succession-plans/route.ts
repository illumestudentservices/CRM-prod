import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { readJsonBody, handleApiError } from "@/lib/api-validation";

// ─── GET /api/hr/succession-plans ─────────────────────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await effectiveHasPermission(session.user.role, "erp_hr", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const plans = await db.successionPlan.findMany({
      include: {
        employee: {
          include: {
            user: { select: { id: true, name: true, image: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({ plans });
  } catch (error) {
    return handleApiError(error, "[GET /api/hr/succession-plans]");
  }
}

// ─── POST /api/hr/succession-plans ────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (!(await effectiveHasPermission(session.user.role, "erp_hr", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await readJsonBody(req);
    const { employeeId, backupPersonnel, crossTraining, emergencyCoverage, readinessLevel, notes } = body;

    if (!employeeId || !backupPersonnel) {
      return NextResponse.json(
        { error: "employeeId and backupPersonnel are required" },
        { status: 422 }
      );
    }

    // Verify employee exists
    const employee = await db.employee.findUnique({ where: { id: employeeId } });
    if (!employee) {
      return NextResponse.json({ error: "Employee not found" }, { status: 404 });
    }

    // Check if a plan already exists for this employee (unique constraint)
    const existing = await db.successionPlan.findUnique({ where: { employeeId } });
    if (existing) {
      return NextResponse.json(
        { error: "A succession plan already exists for this employee" },
        { status: 422 }
      );
    }

    const plan = await db.successionPlan.create({
      data: {
        employeeId,
        backupPersonnel,
        crossTraining: crossTraining || null,
        emergencyCoverage: emergencyCoverage || null,
        readinessLevel: readinessLevel || "DEVELOPING",
        notes: notes || null,
      },
      include: {
        employee: {
          include: { user: { select: { id: true, name: true } } },
        },
      },
    });

    return NextResponse.json({ plan }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "[POST /api/hr/succession-plans]");
  }
}
