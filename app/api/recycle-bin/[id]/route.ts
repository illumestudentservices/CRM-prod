import { NextRequest, NextResponse } from "next/server";
import { notifyAdmins } from "@/lib/admin-alerts";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { restoreRecord, purgeRecord, RecycleBinNotFound } from "@/lib/recycle-bin";
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
    // Read BEFORE the purge: afterwards there is nothing left to describe,
    // and an alert saying "a record was destroyed" without saying which one is
    // not worth sending.
    const doomed = await db.deletedRecord
      .findUnique({ where: { id }, select: { entityType: true, entityLabel: true } })
      .catch(() => null);

    await purgeRecord(id);
    void logActivity(session.user.id, "PURGE", "RECYCLE_BIN", id, {}, req);

    void notifyAdmins({
      action: "RECYCLE_BIN_PURGED",
      actorName: session.user.name ?? session.user.email ?? "An administrator",
      actorEmail: session.user.email ?? "unknown",
      summary: doomed
        ? `a ${doomed.entityType} record was destroyed permanently and can no longer be restored from the app.`
        : "a record was destroyed permanently and can no longer be restored from the app.",
      detail: [
        ["Record type", doomed?.entityType ?? "Unknown"],
        ["Record", doomed?.entityLabel ?? "(label not recorded)"],
      ],
      link: "/recycle-bin",
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof RecycleBinNotFound) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    console.error("[DELETE /api/recycle-bin/[id]]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to purge" },
      { status: 500 }
    );
  }
}
