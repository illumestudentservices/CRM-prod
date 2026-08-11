import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { restoreRecord, purgeRecord } from "@/lib/recycle-bin";
import { logActivity } from "@/lib/activity-logger";

/**
 * DELETE /api/recycle-bin/[id]
 * Permanently delete a bin item now instead of waiting for the 60-day cron.
 * SUPER_ADMIN only.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  try {
    await purgeRecord(id);
    void logActivity(session.user.id, "PURGE", "RECYCLE_BIN", id, {}, req);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[DELETE /api/recycle-bin/[id]]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to purge" },
      { status: 500 }
    );
  }
}
