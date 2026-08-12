import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { restoreRecord, purgeRecord } from "@/lib/recycle-bin";
import { logActivity } from "@/lib/activity-logger";
import { hasCapability } from "@/lib/granular-permissions";
import type { Role } from "@/lib/permissions";

/**
 * DELETE /api/recycle-bin/[id]
 * Permanently delete a bin item now instead of waiting for the 60-day cron.
 *
 * Gated on the settings.purge_recycle_bin capability rather than a SUPER_ADMIN
 * string literal. Same set of people by default — the capability requires
 * settings:delete, which only SUPER_ADMIN holds — but it becomes visible and
 * revocable in Settings → Security, which is what the registry already advertised
 * and the route did not honour. This destroys a record inside its retention
 * window, so it should be withdrawable from an account without a deploy.
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!(await hasCapability(session.user.role as Role, "settings.purge_recycle_bin"))) {
    return NextResponse.json(
      { error: "Your role is not permitted to permanently delete records" },
      { status: 403 }
    );
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
