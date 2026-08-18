import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role, AttachmentParentType } from "@prisma/client";
import { checkUploadSize } from "@/lib/uploads";
import { validateAttachment } from "@/lib/attachment-safety";
import { attachmentContext, canReadParent, canWriteParent } from "@/lib/attachment-parent";
import { logActivity } from "@/lib/activity-logger";

/**
 * Polymorphic attachments — list + upload.
 *
 * All uploads go through validateAttachment (H-4 MIME/filename allowlist) —
 * the canonical MIME derived from the extension is what's persisted, not
 * whatever the client claimed. Downloads (in the sibling [id] route) use
 * safeAttachmentHeaders so a bad row can't be served as HTML/SVG.
 *
 * Permission model lives in lib/attachment-parent.ts.
 */

const PARENT_TYPES = [
  "TASK",
  "ACTIVITY",
  "CLIENT_ISSUE",
  "RECRUITMENT_EVENT",
  "MARKETING_CAMPAIGN",
  "RECRUITMENT_PARTNER",
  "MARKET_UPDATE_SUGGESTION",
  "RECRUITMENT_PLAN",
  "VARIATION_REQUEST",
  "MONTHLY_REPORT",
  "ICR_MONTHLY_REPORT",
  "ENGAGEMENT_LOG",
  "LEAD_NOTE",
  "LEAD",
  "INSTITUTION_INTEREST",
  "RISK_REGISTER",
  "COMPLIANCE_ITEM",
  "ACCOUNT_INTERVENTION",
  "QUARTERLY_BUSINESS_REVIEW",
] as const;

const parentQuerySchema = z.object({
  parentType: z.enum(PARENT_TYPES),
  parentId: z.string().min(1),
});

// ── GET /api/attachments?parentType=…&parentId=… ────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const parsed = parentQuerySchema.safeParse({
    parentType: url.searchParams.get("parentType"),
    parentId: url.searchParams.get("parentId"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "parentType and parentId are required" },
      { status: 422 }
    );
  }
  const { parentType, parentId } = parsed.data;

  const role = session.user.role as Role;
  if (!(await canReadParent(role, parentType as AttachmentParentType))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Existence check — same 404 whether it doesn't exist or the caller can't
  // see it. Prevents ID enumeration.
  const ctx = attachmentContext(parentType as AttachmentParentType);
  if (!(await ctx.exists(parentId))) {
    return NextResponse.json({ error: `${ctx.label} not found` }, { status: 404 });
  }

  const attachments = await db.attachment.findMany({
    where: { parentType: parentType as AttachmentParentType, parentId },
    select: {
      id: true,
      name: true,
      mimeType: true,
      size: true,
      createdAt: true,
      uploadedById: true,
      uploadedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ data: attachments });
}

// ── POST /api/attachments (multipart/form-data) ─────────────────────────

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const parsed = parentQuerySchema.safeParse({
    parentType: url.searchParams.get("parentType"),
    parentId: url.searchParams.get("parentId"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "parentType and parentId are required (query string)" },
      { status: 422 }
    );
  }
  const { parentType, parentId } = parsed.data;

  const role = session.user.role as Role;
  if (!(await canWriteParent(role, parentType as AttachmentParentType))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const ctx = attachmentContext(parentType as AttachmentParentType);
  if (!(await ctx.exists(parentId))) {
    return NextResponse.json({ error: `${ctx.label} not found` }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  // Size check first — cheap, cuts short a big upload before the more
  // expensive MIME sniff/validate.
  const sizeCheck = checkUploadSize(file);
  if (!sizeCheck.ok) {
    return NextResponse.json({ error: sizeCheck.message }, { status: 413 });
  }

  // MIME + filename allowlist. Refuses html/svg/exe/script types.
  const check = validateAttachment(file);
  if (!check.ok) {
    return NextResponse.json({ error: check.message }, { status: 415 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const attachment = await db.attachment.create({
      data: {
        parentType: parentType as AttachmentParentType,
        parentId,
        name: check.safeName!,
        mimeType: check.canonicalMime!,
        size: file.size,
        data: buffer,
        uploadedById: session.user.id,
      },
      select: {
        id: true,
        name: true,
        mimeType: true,
        size: true,
        createdAt: true,
        uploadedById: true,
      },
    });

    void logActivity(session.user.id, "UPLOAD", "ATTACHMENT", attachment.id, {
      parentType,
      parentId,
      fileName: check.safeName,
      size: file.size,
    });

    return NextResponse.json({ data: attachment }, { status: 201 });
  } catch (err) {
    // Keep the internal error server-side (pentest M-5 rule).
    console.error("[POST /api/attachments]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
