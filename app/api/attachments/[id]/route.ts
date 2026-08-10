import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { canReadParent, canWriteParent } from "@/lib/attachment-parent";
import { safeAttachmentHeaders } from "@/lib/attachment-safety";
import { logActivity } from "@/lib/activity-logger";

/**
 * Polymorphic attachment — download + delete.
 *
 * Download always emits Content-Disposition: attachment (never inline) plus
 * sandbox CSP, nosniff, noopen, and canonical MIME derived from the file
 * extension. See lib/attachment-safety.ts.
 *
 * Delete rules:
 *   - The uploader can always delete their own row.
 *   - Callers with WRITE permission on the parent module can delete any row.
 *   - Everyone else gets 403.
 */

// ── GET /api/attachments/[id] ───────────────────────────────────────────

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const attachment = await db.attachment.findUnique({ where: { id } });
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Read gate is on the PARENT — knowing the attachment ID doesn't
  // automatically permit reading if the caller can't see the parent module.
  const role = session.user.role as Role;
  if (!(await canReadParent(role, attachment.parentType))) {
    // Same 404 for permission-denied to prevent ID enumeration against the gate.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(attachment.data), {
    headers: safeAttachmentHeaders({
      filename: attachment.name,
      storedMime: attachment.mimeType,
      size: attachment.size,
    }),
  });
}

// ── DELETE /api/attachments/[id] ────────────────────────────────────────

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const attachment = await db.attachment.findUnique({
    where: { id },
    select: { id: true, parentType: true, parentId: true, uploadedById: true },
  });
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isUploader = attachment.uploadedById === session.user.id;
  const role = session.user.role as Role;
  const isWriter = await canWriteParent(role, attachment.parentType);

  if (!isUploader && !isWriter) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await db.attachment.delete({ where: { id } });
  void logActivity(session.user.id, "DELETE", "ATTACHMENT", id, {
    parentType: attachment.parentType,
    parentId: attachment.parentId,
    byUploader: isUploader,
  }, req);

  return NextResponse.json({ ok: true });
}
