import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { logActivity } from "@/lib/activity-logger";
import { safeAttachmentHeaders } from "@/lib/attachment-safety";
import { trashRecord } from "@/lib/recycle-bin";

/// Roles that can manage KB attachments (matches the sibling parent-article
/// write gate). Any role at or above this level can also read all attachments
/// including drafts.
const KB_WRITE_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN", "HQ_EXECUTIVE"];

/**
 * GET /api/hr/knowledge-base/attachments/[attachmentId]
 *
 * Security posture (pentest H-3, 2026-08-10):
 *
 * Previous behaviour was `if (session?.user) return the bytes`. That let any
 * authenticated user in any role guess a CUID and download any HR KB file —
 * salary policies, contracts, PII. The equivalent POST / DELETE handlers gate
 * on KB_WRITE_ROLES; read was accidentally left open.
 *
 * Corrected policy:
 *   1. Must be signed in AND have `knowledge_base:read` on the permission
 *      matrix (`effectiveHasPermission`).
 *   2. Load the parent article; refuse if it doesn't exist.
 *   3. Refuse drafts (`isPublished:false`) to non-write roles — drafts by
 *      definition aren't ready to leave the author's team.
 *   4. `PROPOSAL`-type articles are HR-only content; refuse to non-write
 *      roles regardless of publish state.
 *
 * We deliberately do NOT tighten INSTITUTION- or MARKET-scoped articles
 * here — that scope logic belongs on the parent article GET where it can
 * be enforced consistently across list + single-fetch. Tracking as a
 * separate finding.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = session.user.role as Role;
  if (!(await effectiveHasPermission(role, "knowledge_base", "read"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { attachmentId } = await params;

  const attachment = await db.knowledgeBaseAttachment.findUnique({
    where: { id: attachmentId },
    include: {
      article: {
        select: { id: true, isPublished: true, knowledgeType: true },
      },
    },
  });

  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const isWriter = KB_WRITE_ROLES.includes(role);

  // Drafts and PROPOSAL articles are only readable by KB writers. The 404
  // response deliberately doesn't distinguish "attachment doesn't exist"
  // from "attachment exists but you can't see it" — no information disclosed.
  if (!isWriter && (!attachment.article.isPublished || attachment.article.knowledgeType === "PROPOSAL")) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Spec pentest H-4 — safeAttachmentHeaders derives Content-Type from the
  // FILE EXTENSION (not the stored mimeType, which may pre-date this fix and
  // contain a client-supplied text/html), encodes the filename safely
  // (Content-Disposition: attachment always, never inline), and adds
  // nosniff + noopen + sandbox CSP so an untrusted download can never
  // execute in-origin even if a viewer path tries.
  return new NextResponse(new Uint8Array(attachment.data), {
    headers: safeAttachmentHeaders({
      filename: attachment.name,
      storedMime: attachment.mimeType,
      size: attachment.size,
    }),
  });
}

// DELETE /api/hr/knowledge-base/attachments/[attachmentId]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = session.user.role as Role;
  if (!KB_WRITE_ROLES.includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { attachmentId } = await params;
  await trashRecord({ entityType: "KnowledgeBaseAttachment", entityId: attachmentId, userId: session.user.id });
  void logActivity(session.user.id, "DELETE", "KB_ATTACHMENT", attachmentId, null, req);
  return NextResponse.json({ ok: true });
}
