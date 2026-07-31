import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";

export async function GET() {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await effectiveHasPermission(session.user.role, "whatsapp", "read"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const conversations = await db.whatsAppConversation.findMany({
    orderBy: { lastMessageAt: "desc" },
    include: {
      lead: { select: { id: true, firstName: true,
        lastName: true, phone: true } },
    },
  });

  return NextResponse.json({ conversations });
}
