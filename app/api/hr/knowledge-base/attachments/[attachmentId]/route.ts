import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logActivity } from "@/lib/activity-logger";

// GET /api/hr/knowledge-base/attachments/[attachmentId]
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { attachmentId } = await params;

  const attachment = await db.knowledgeBaseAttachment.findUnique({
    where: { id: attachmentId },
  });

  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(attachment.data, {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `attachment; filename="${attachment.name}"`,
      "Content-Length": String(attachment.size),
    },
  });
}

// DELETE /api/hr/knowledge-base/attachments/[attachmentId]
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ attachmentId: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const role = session.user.role as string;
  if (!["HR_MANAGER", "SUPER_ADMIN", "HQ_EXECUTIVE"].includes(role))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { attachmentId } = await params;
  await db.knowledgeBaseAttachment.delete({ where: { id: attachmentId } });
  void logActivity(session.user.id, "DELETE", "KB_ATTACHMENT", attachmentId, null, req);
  return NextResponse.json({ ok: true });
}
