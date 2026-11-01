import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { z } from "zod";
import { logActivity } from "@/lib/activity-logger";
import { notifyAdmins } from "@/lib/admin-alerts";
import { rateLimit, clientIp } from "@/lib/rate-limit";

/** Exports at or above this row count alert the super admins (exfil signal). */
const BULK_EXPORT_THRESHOLD = 500;

/**
 * Export audit beacon.
 *
 * The CSV/PDF export in components/shared/export-button.tsx builds the file in
 * the browser from rows already fetched, so there is no server round-trip to
 * record it — exfiltrating a table was invisible. This endpoint gives those
 * client exports an audit trail: who exported which dataset, in what format,
 * and how many rows. Fire-and-forget from the client; best-effort server side.
 *
 * Rate-limited per user so the audit log itself cannot be flooded, and so an
 * abnormal burst of exports is capped rather than silently absorbed. The
 * server-side export endpoints (gdpr/export, hr/employees/export) log their own
 * EXPORT events already.
 */
const schema = z.object({
  dataset: z.string().min(1).max(200),
  format: z.enum(["csv", "pdf"]),
  recordCount: z.number().int().min(0).max(5_000_000),
});

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!rateLimit(`export-log:${session.user.id}`, 120, 60 * 60 * 1000)) {
    return NextResponse.json({ ok: false, rateLimited: true }, { status: 429 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid input" }, { status: 422 });

  const { dataset, format, recordCount } = parsed.data;
  const bulk = recordCount >= BULK_EXPORT_THRESHOLD;
  const ip = clientIp(req);
  void logActivity(session.user.id, "EXPORT", "DataExport", dataset.slice(0, 200), {
    format,
    recordCount,
    ip,
    via: "client",
    bulk,
  });

  // A large export is the shape of data exfiltration — tell the super admins,
  // best-effort (never block or fail the beacon). Small exports stay quiet so
  // the one that matters is not buried.
  if (bulk) {
    const actor = await db.user
      .findUnique({ where: { id: session.user.id }, select: { name: true, email: true } })
      .catch(() => null);
    void notifyAdmins({
      action: "BULK_EXPORT_DOWNLOADED",
      actorName: actor?.name ?? "Unknown",
      actorEmail: actor?.email ?? "unknown",
      summary: `${recordCount} "${dataset}" records exported as ${format.toUpperCase()}`,
      detail: [["Dataset", dataset.slice(0, 120)], ["Format", format], ["Rows", String(recordCount)]],
      ip,
    });
  }

  return NextResponse.json({ ok: true, bulk });
}
