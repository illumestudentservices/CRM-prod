import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { REGISTRY } from "@/lib/recycle-bin";

/**
 * GET /api/recycle-bin
 *
 * Lists every item in the bin. SUPER_ADMIN only — this is the omniscient view.
 * Filter by ?entityType=X or ?includePurged=1. Defaults to active (not
 * restored, not purged) items.
 */
export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (session.user.role !== "SUPER_ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const entityType = searchParams.get("entityType");
  const includeRestored = searchParams.get("includeRestored") === "1";
  const includePurged = searchParams.get("includePurged") === "1";

  const where: Record<string, unknown> = {};
  if (entityType && REGISTRY[entityType]) where.entityType = entityType;
  if (!includeRestored) where.restoredAt = null;
  if (!includePurged) where.purgedAt = null;

  const items = await db.deletedRecord.findMany({
    where,
    include: {
      deletedBy: { select: { id: true, name: true, email: true } },
      restoredBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { deletedAt: "desc" },
    take: 500,
  });

  // Group entity counts so the UI can render the type filter with counts.
  const counts = await db.deletedRecord.groupBy({
    by: ["entityType"],
    where: { restoredAt: null, purgedAt: null },
    _count: { _all: true },
  });

  return NextResponse.json({
    data: items,
    counts: Object.fromEntries(counts.map((c) => [c.entityType, c._count._all])),
  });
}
