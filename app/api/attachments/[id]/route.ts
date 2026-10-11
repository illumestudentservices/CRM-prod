import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import {
  mayReadParentRow, mayWriteParentRow, maySeeAttachment, canAccessParentRow,
} from "@/lib/attachment-parent";
import { safeAttachmentHeaders } from "@/lib/attachment-safety";
import { logActivity } from "@/lib/activity-logger";
import { trashRecord } from "@/lib/recycle-bin";

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

  /**
   * findFirst with deletedAt: null, not findUnique by id.
   *
   * Deleting is a SOFT delete - the row survives so it can be restored from
   * the recycle bin - and this route never excluded deleted rows, so a file
   * the owner had deleted was still served on request. The delete button
   * wrote a timestamp and withdrew nothing.
   */
  const attachment = await db.attachment.findFirst({ where: { id, deletedAt: null } });
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Read gate is on the PARENT — knowing the attachment ID doesn't
  // automatically permit reading if the caller can't see the parent module.
  const role = session.user.role as Role;
  const actor = { userId: session.user.id, role };

  /**
   * Both gates, in order: may they reach the record, and may they see THIS
   * file. The second is the one that matters here — without it a manager who
   * cannot see a file in the list could still fetch it by id, and the id is
   * the easy half to guess at from a shared screenshot or a browser history.
   */
  if (!(await mayReadParentRow(attachment.parentType, attachment.parentId, actor))) {
    // Same 404 for permission-denied to prevent ID enumeration against the gate.
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // …and the parent ROW, not just its module. Holding tasks:read is not the
  // same as having anything to do with the task this file hangs off.
  if (!(await maySeeAttachment(
    attachment.parentType, attachment.parentId,
    { uploadedById: attachment.uploadedById }, actor,
  ))) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  if (!(await canAccessParentRow(attachment.parentType, attachment.parentId, {
    userId: session.user.id, role,
  }))) {
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

  // Already-deleted rows are 404 here too, so deleting the same file twice
  // reports "not found" rather than a second cheerful 200 on a row that is
  // already gone.
  const attachment = await db.attachment.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, parentType: true, parentId: true, uploadedById: true },
  });
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isUploader = attachment.uploadedById === session.user.id;
  const role = session.user.role as Role;

  // "Can delete anyone's" is module write PLUS a claim on this row. Without
  // the second half, write permission on tasks meant delete permission on
  // every task attachment in the company.
  // "Can delete anyone's" now also requires being allowed to SEE the file.
  // Otherwise a manager could delete the employee's private upload — one they
  // are not permitted to open — by id.
  const isWriter =
    (await mayWriteParentRow(attachment.parentType, attachment.parentId, {
      userId: session.user.id, role,
    })) &&
    (await maySeeAttachment(
      attachment.parentType, attachment.parentId,
      { uploadedById: attachment.uploadedById }, { userId: session.user.id, role },
    )) &&
    (await canAccessParentRow(attachment.parentType, attachment.parentId, {
      userId: session.user.id, role,
    }));

  if (!isUploader && !isWriter) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  await trashRecord({ entityType: "Attachment", entityId: id, userId: session.user.id });
  void logActivity(session.user.id, "DELETE", "ATTACHMENT", id, {
    parentType: attachment.parentType,
    parentId: attachment.parentId,
    byUploader: isUploader,
  }, req);

  return NextResponse.json({ ok: true });
}
