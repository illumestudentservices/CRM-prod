import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { assertInstitutionVisible } from "@/lib/lead-access";
import { handleApiError } from "@/lib/api-validation";
import { logActivity } from "@/lib/activity-logger";

// ─── DELETE /api/institutions/:id/documents/:documentId ─────────────────────
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; documentId: string }> }
) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await effectiveHasPermission(session.user.role, "institutions", "write")))
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    const { id, documentId } = await params;
    if (!(await assertInstitutionVisible(id, session.user.id, session.user.role)))
      return NextResponse.json({ error: "Institution not found" }, { status: 404 });

    // The document must belong to this institution — otherwise one client's id
    // could delete another's file by guessing a document id.
    const doc = await db.institutionDocument.findUnique({ where: { id: documentId }, select: { id: true, institutionId: true } });
    if (!doc || doc.institutionId !== id)
      return NextResponse.json({ error: "Document not found" }, { status: 404 });

    await db.institutionDocument.delete({ where: { id: documentId } });
    void logActivity(session.user.id, "DELETE", "InstitutionDocument", documentId, { route: "institutions/[id]/documents/[documentId]" });

    return NextResponse.json({ deleted: true });
  } catch (error) {
    return handleApiError(error, "[DELETE /api/institutions/:id/documents/:documentId]");
  }
}
