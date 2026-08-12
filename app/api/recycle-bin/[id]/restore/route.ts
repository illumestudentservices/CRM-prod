import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { restoreRecord, RecycleBinNotFound } from "@/lib/recycle-bin";
import { logActivity } from "@/lib/activity-logger";

/**
 * POST /api/recycle-bin/[id]/restore
 * Bring a trashed item back to life. SUPER_ADMIN only.
 *
 * For soft-delete entities this just clears deletedAt. For hard-delete
 * entities it re-INSERTs from the snapshot; if a unique constraint blocks
 * the re-INSERT (e.g. another row now holds the old email), the response
 * carries the error so the admin can decide what to do.
 */
export async function POST(
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
    await restoreRecord(id, session.user.id);
    void logActivity(session.user.id, "RESTORE", "RECYCLE_BIN", id, {}, req);
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RecycleBinNotFound) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("[POST /api/recycle-bin/[id]/restore]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to restore" },
      { status: 500 }
    );
  }
}
