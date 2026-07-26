import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";

// ─── GET /api/institutions/:id/documents ──────────────────────────────────

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

    const documents = await db.institutionDocument.findMany({
      where: { institutionId: id },
      orderBy: { uploadedAt: "desc" },
    });

    return NextResponse.json(documents);
  } catch (error) {
    console.error("[GET /api/institutions/:id/documents]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ─── POST /api/institutions/:id/documents ─────────────────────────────────

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

    const body = await req.json();
    const { name, url, type, size } = body;

    if (!name || !url || !type) {
      return NextResponse.json(
        { error: "name, url, and type are required" },
        { status: 400 }
      );
    }

    const document = await db.institutionDocument.create({
      data: {
        institutionId: id,
        name,
        url,
        type,
        size: size !== undefined && size !== null ? parseInt(size, 10) : null,
        uploadedBy: session.user.id,
      },
    });

    await db.auditLog.create({
      data: {
        action: "CREATE",
        entity: "InstitutionDocument",
        entityId: document.id,
        userId: session.user.id,
        changes: { after: { name, url, type, size } },
      },
    });

    return NextResponse.json(document, { status: 201 });
  } catch (error) {
    console.error("[POST /api/institutions/:id/documents]", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
