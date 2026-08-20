import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-logger";
import { checkUploadSize } from "@/lib/uploads";
import { validateAttachment } from "@/lib/attachment-safety";
import { canWriteKbArticle, KB_WRITE_ROLES } from "@/lib/kb-access";


// POST /api/hr/knowledge-base/attachments?articleId=xxx
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const articleId = new URL(req.url).searchParams.get("articleId");
  if (!articleId) return NextResponse.json({ error: "articleId required" }, { status: 400 });

  const article = await db.knowledgeBase.findFirst({ where: { id: articleId, deletedAt: null } });
  if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 });

  // Checked against THIS article, not a fixed list. A client or market article
  // is gated by institutions:write / markets:write, and a Regional Manager who
  // holds those could previously create one and then be refused when attaching
  // to it. See lib/kb-access.ts.
  if (!(await canWriteKbArticle(session.user.role as Role, article)))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }

  const file = formData.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file provided" }, { status: 400 });

  // The real control. The client checks too, but only so the user finds out
  // instantly — a direct request would skip it entirely.
  const sizeCheck = checkUploadSize(file);
  if (!sizeCheck.ok) {
    return NextResponse.json({ error: sizeCheck.message }, { status: 413 });
  }

  // Spec pentest H-4 — the previous code accepted `file.type` verbatim and
  // persisted the raw filename. That let an uploader smuggle text/html or
  // image/svg+xml with a <script> payload, then get it served same-origin.
  // validateAttachment refuses blocked extensions (html/svg/exe/…), enforces
  // an allowlist of MIME types, and returns the canonical MIME + sanitised
  // filename to persist.
  const check = validateAttachment(file);
  if (!check.ok) {
    return NextResponse.json({ error: check.message }, { status: 415 });
  }

  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    const attachment = await db.knowledgeBaseAttachment.create({
      data: {
        articleId,
        name:     check.safeName!,
        mimeType: check.canonicalMime!,
        size:     file.size,
        data:     buffer,
      },
      select: { id: true, name: true, mimeType: true, size: true, createdAt: true },
    });

    void logActivity(session.user.id, "UPLOAD", "KB_ATTACHMENT", attachment.id, { articleId, fileName: check.safeName, size: file.size }, req);
    return NextResponse.json({ attachment }, { status: 201 });
  } catch (err) {
    // Spec pentest M-5 — do not leak internal error text to the client.
    // The full error stays server-side for debugging.
    console.error("[kb attachments POST] DB error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
