import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditOrigin } from "@/lib/activity-logger";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { readJsonBody, handleApiError } from "@/lib/api-validation";

// ─── GET /api/institutions/:id/deliverables ───────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "institutions", "read")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const institution = await db.institution.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!institution || institution.deletedAt) {
      return NextResponse.json({ error: "Institution not found" }, { status: 404 });
    }

    const deliverables = await db.deliverable.findMany({
      where: { institutionId: id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(deliverables);
  } catch (error) {
    return handleApiError(error, "[GET /api/institutions/:id/deliverables]");
  }
}

// ─── POST /api/institutions/:id/deliverables ──────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "institutions", "write")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id } = await params;

    const institution = await db.institution.findUnique({
      where: { id },
      select: { id: true, deletedAt: true },
    });
    if (!institution || institution.deletedAt) {
      return NextResponse.json({ error: "Institution not found" }, { status: 404 });
    }

    const body = await readJsonBody(req);
    const { title, description, dueDate, status } = body;

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }

    const deliverable = await db.deliverable.create({
      data: {
        institutionId: id,
        title,
        description: description || null,
        dueDate: dueDate ? new Date(dueDate) : null,
        status: status || "PENDING",
      },
    });

    await db.auditLog.create({
      data: {
        action: "CREATE",
        entity: "Deliverable",
        entityId: deliverable.id,
        userId: session.user.id,
        changes: { after: body },
      
        ...(await auditOrigin()),
      },
    });

    return NextResponse.json(deliverable, { status: 201 });
  } catch (error) {
    return handleApiError(error, "[POST /api/institutions/:id/deliverables]");
  }
}
