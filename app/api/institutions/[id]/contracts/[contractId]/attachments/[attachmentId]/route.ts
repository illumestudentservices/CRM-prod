import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { safeAttachmentHeaders } from "@/lib/attachment-safety";
import { trashRecord } from "@/lib/recycle-bin";
import { institutionIdsForUser } from "@/lib/lead-access";
import type { Role } from "@/lib/permissions";

type Params = { params: Promise<{ id: string; contractId: string; attachmentId: string }> };

/**
 * The attachment used to be fetched by its own id alone, which made the [id] and
 * [contractId] path segments decorative: institutions:read — held by
 * INSTITUTION_CLIENT, ICR, ADMISSIONS_SUPPORT, ACCOUNT_MANAGER, VP_GLOBAL_SALES
 * and both HQ roles — was enough to download any client's signed contract by
 * walking attachment ids. Only the sibling POST validated the chain.
 *
 * Two checks are needed, not one. Matching the full parent chain stops an
 * attachment being pulled through somebody else's institution id; scoping to the
 * caller's own institutions stops an INSTITUTION_CLIENT simply supplying the
 * correct foreign ids. Returns null when the institution is not the caller's, so
 * no query is issued at all.
 */
async function attachmentWhere(
  p: { id: string; contractId: string; attachmentId: string },
  userId: string,
  role: Role
) {
  if (role === "INSTITUTION_CLIENT") {
    const allowed = await institutionIdsForUser(userId, role);
    if (!allowed.includes(p.id)) return null;
  }
  return {
    id: p.attachmentId,
    contract: { id: p.contractId, institutionId: p.id },
  };
}

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await effectiveHasPermission(session.user.role, "institutions", "read")))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const p = await params;
  const where = await attachmentWhere(p, session.user.id, session.user.role as Role);
  if (!where) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const attachment = await db.contractAttachment.findFirst({ where });
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Spec pentest H-4 — safeAttachmentHeaders derives Content-Type from the
  // filename extension (not the stored mimeType), forces Content-Disposition
  // to `attachment` (never inline), and adds nosniff + noopen + sandbox CSP
  // so the download can never execute in-origin.
  return new NextResponse(new Uint8Array(attachment.data), {
    headers: safeAttachmentHeaders({
      filename: attachment.name,
      storedMime: attachment.mimeType,
      size: attachment.size,
    }),
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await effectiveHasPermission(session.user.role, "institutions", "delete")))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const p = await params;
  const where = await attachmentWhere(p, session.user.id, session.user.role as Role);
  if (!where) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const attachment = await db.contractAttachment.findFirst({ where, select: { id: true } });
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await trashRecord({ entityType: "ContractAttachment", entityId: p.attachmentId, userId: session.user.id });

  return NextResponse.json({ success: true });
}
