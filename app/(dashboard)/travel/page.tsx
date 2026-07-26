import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { redirect } from "next/navigation";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import type { Role } from "@/lib/permissions";
import { PageHeader } from "@/components/shared/page-header";
import { TravelClient } from "./_components/travel-client";

export default async function TravelPage() {
  const session = await auth();
  if (!session) redirect("/login");

  const role = session.user.role as Role;
  if (!(await effectiveHasPermission(role, "travel", "read"))) {
    redirect("/dashboard");
  }

  // Fetch travel requests
  const travelRequests = await db.travelRequest.findMany({
    include: {
      employee: {
        include: { user: { select: { id: true, name: true, image: true } } },
      },
      itineraryItems: { orderBy: { date: "asc" } },
      travelMeetings: { orderBy: { date: "asc" } },
    },
    orderBy: { createdAt: "desc" },
  });

  // Fetch reporting stats
  const totalTrips = travelRequests.length;
  const totalCost = travelRequests.reduce(
    (sum, tr) => sum + (tr.actualCost ?? tr.estimatedCost ?? 0),
    0
  );
  const averageCostPerTrip = totalTrips > 0 ? totalCost / totalTrips : 0;

  // Count school visits and agent meetings from linked activities
  const activityIds = travelRequests
    .flatMap((tr) => tr.travelMeetings)
    .filter((tm) => tm.activityId)
    .map((tm) => tm.activityId as string);

  let schoolsVisited = 0;
  let agentsVisited = 0;

  if (activityIds.length > 0) {
    const linkedActivities = await db.activity.findMany({
      where: { id: { in: activityIds } },
      select: { type: true },
    });
    schoolsVisited = linkedActivities.filter((a) => a.type === "SCHOOL_VISIT").length;
    agentsVisited = linkedActivities.filter((a) => a.type === "AGENT_MEETING").length;
  }

  // Fetch employees for the create form
  const employees = await db.employee.findMany({
    where: { isActive: true },
    include: { user: { select: { name: true } } },
    orderBy: { user: { name: "asc" } },
  });

  return (
    <div className="p-6 space-y-6">
      <PageHeader
        title="Travel Management"
        description="Plan, track, and report on business travel"
      />

      <TravelClient
        travelRequests={JSON.parse(JSON.stringify(travelRequests))}
        stats={{
          totalTrips,
          totalCost,
          averageCostPerTrip,
          schoolsVisited,
          agentsVisited,
        }}
        employees={employees.map((e) => ({
          id: e.id,
          name: e.user.name ?? "Unknown",
        }))}
      />
    </div>
  );
}
