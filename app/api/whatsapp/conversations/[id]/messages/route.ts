import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await effectiveHasPermission(session.user.role, "whatsapp", "read"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  const [conversation, messages] = await Promise.all([
    db.whatsAppConversation.findUnique({
      where: { id },
      include: { lead: { select: { id: true, firstName: true, lastName: true, phone: true } } },
    }),
    db.whatsAppMessage.findMany({
      where: { conversationId: id },
      orderBy: { createdAt: "asc" },
      include: { sentBy: { select: { id: true, name: true } } },
    }),
  ]);

  if (!conversation) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // Mark as read
  await db.whatsAppConversation.update({
    where: { id },
    data: { unreadCount: 0 },
  });

  return NextResponse.json({ conversation, messages });
}
