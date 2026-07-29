import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { logActivity } from "@/lib/activity-logger";
import { checkUploadSize } from "@/lib/uploads";

const KB_WRITE_ROLES: Role[] = ["HR_MANAGER", "SUPER_ADMIN", "HQ_EXECUTIVE"];

// POST /api/hr/knowledge-base/attachments?articleId=xxx
export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!KB_WRITE_ROLES.includes(session.user.role as Role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const articleId = new URL(req.url).searchParams.get("articleId");
  if (!articleId) return NextResponse.json({ error: "articleId required" }, { status: 400 });

  const article = await db.knowledgeBase.findFirst({ where: { id: articleId, deletedAt: null } });
  if (!article) return NextResponse.json({ error: "Article not found" }, { status: 404 });

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

  try {
    const buffer = Buffer.from(await file.arrayBuffer());

    const attachment = await db.knowledgeBaseAttachment.create({
      data: {
        articleId,
        name:     file.name,
        mimeType: file.type || "application/octet-stream",
        size:     file.size,
        data:     buffer,
      },
      select: { id: true, name: true, mimeType: true, size: true, createdAt: true },
    });

    void logActivity(session.user.id, "UPLOAD", "KB_ATTACHMENT", attachment.id, { articleId, fileName: file.name, size: file.size }, req);
    return NextResponse.json({ attachment }, { status: 201 });
  } catch (err) {
    console.error("[kb attachments POST] DB error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
