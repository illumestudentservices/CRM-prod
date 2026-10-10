import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { canSeeAnnouncement } from "@/lib/announcement-visibility";

// ─── POST /api/hr/announcements/[id]/read ────────────────────────────────────

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  // Scoped rather than findUnique. Now that the feed filters by region, a
  // plain existence check here would let anyone with an id confirm that a
  // regional announcement exists and quietly file a read receipt against it.
  // 404 for "not yours" and "not there" alike, so neither can be told apart.
  const me = await db.user.findUnique({
    where: { id: session.user.id },
    select: { id: true, regionId: true },
  });
  if (!me || !(await canSeeAnnouncement(me, id))) {
    return NextResponse.json({ error: "Announcement not found" }, { status: 404 });
  }

  await db.announcementRead.upsert({
    where: {
      announcementId_userId: {
        announcementId: id,
        userId: session.user.id,
      },
    },
    create: {
      announcementId: id,
      userId: session.user.id,
    },
    update: {
      readAt: new Date(),
    },
  });

  return NextResponse.json({ success: true });
}
