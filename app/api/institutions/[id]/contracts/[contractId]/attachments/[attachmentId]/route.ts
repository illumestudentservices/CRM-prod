import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";

type Params = { params: Promise<{ id: string; contractId: string; attachmentId: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await effectiveHasPermission(session.user.role, "institutions", "read")))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { attachmentId } = await params;

  const attachment = await db.contractAttachment.findUnique({
    where: { id: attachmentId },
  });
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return new NextResponse(attachment.data, {
    headers: {
      "Content-Type": attachment.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(attachment.name)}"`,
      "Content-Length": String(attachment.size),
    },
  });
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await effectiveHasPermission(session.user.role, "institutions", "delete")))
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { attachmentId } = await params;

  const attachment = await db.contractAttachment.findUnique({
    where: { id: attachmentId },
    select: { id: true },
  });
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.contractAttachment.delete({ where: { id: attachmentId } });

  return NextResponse.json({ success: true });
}
