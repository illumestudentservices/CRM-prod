import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { effectiveHasPermission } from "@/lib/effective-permissions";

// ─── GET /api/travel/report ───────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await effectiveHasPermission(session.user.role, "travel", "read"))) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const year = searchParams.get("year");
  const month = searchParams.get("month");

  // Build date filters
  const dateFilter: Record<string, unknown> = {};
  if (year) {
    const y = parseInt(year, 10);
    const startOfYear = new Date(y, 0, 1);
    const endOfYear = new Date(y + 1, 0, 1);
    dateFilter.departDate = { gte: startOfYear, lt: endOfYear };

    if (month) {
      const m = parseInt(month, 10) - 1; // 0-indexed
      const startOfMonth = new Date(y, m, 1);
      const endOfMonth = new Date(y, m + 1, 1);
      dateFilter.departDate = { gte: startOfMonth, lt: endOfMonth };
    }
  }

  // Get all travel requests matching filters
  const travelRequests = await db.travelRequest.findMany({
    where: dateFilter,
    include: {
      travelMeetings: {
        include: {
          // We need activityId to check activity type
        },
      },
    },
  });

  const totalTrips = travelRequests.length;
  const totalCost = travelRequests.reduce(
    (sum, tr) => sum + (tr.actualCost ?? tr.estimatedCost ?? 0),
    0
  );
  const averageCostPerTrip = totalTrips > 0 ? totalCost / totalTrips : 0;

  // Count school visits and agent meetings by querying travel meetings with linked activities
  const travelMeetingIds = travelRequests.flatMap((tr) =>
    tr.travelMeetings
      .filter((tm) => tm.activityId)
      .map((tm) => tm.activityId as string)
  );

  let schoolsVisited = 0;
  let agentsVisited = 0;

  if (travelMeetingIds.length > 0) {
    const linkedActivities = await db.activity.findMany({
      where: {
        id: { in: travelMeetingIds },
      },
      select: { type: true },
    });

    schoolsVisited = linkedActivities.filter((a) => a.type === "SCHOOL_VISIT").length;
    agentsVisited = linkedActivities.filter((a) => a.type === "AGENT_MEETING").length;
  }

  // Cost breakdown by destination
  const costByDestination: Record<string, { trips: number; cost: number }> = {};
  for (const tr of travelRequests) {
    const dest = tr.destination;
    if (!costByDestination[dest]) {
      costByDestination[dest] = { trips: 0, cost: 0 };
    }
    costByDestination[dest].trips += 1;
    costByDestination[dest].cost += tr.actualCost ?? tr.estimatedCost ?? 0;
  }

  const destinationBreakdown = Object.entries(costByDestination)
    .map(([destination, data]) => ({
      destination,
      trips: data.trips,
      cost: data.cost,
    }))
    .sort((a, b) => b.cost - a.cost);

  return NextResponse.json({
    totalTrips,
    totalCost,
    averageCostPerTrip,
    schoolsVisited,
    agentsVisited,
    destinationBreakdown,
  });
}
