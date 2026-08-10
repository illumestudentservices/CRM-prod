import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { PlanDetailClient } from "./_components/plan-detail-client";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function PlanDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id } = await params;

  const plan = await db.quarterlyRecruitmentPlan.findUnique({
    where: { id },
    include: {
      icr: { select: { id: true, name: true, email: true } },
      institution: { select: { id: true, name: true, country: true } },
      market: { select: { id: true, name: true, code: true } },
      regionalManager: { select: { id: true, name: true } },
      accountManager: { select: { id: true, name: true } },
      vpReviewer: { select: { id: true, name: true } },
      plannedTravel: { orderBy: { plannedStart: "asc" } },
      plannedFieldActivities: true,
      budgetItems: { orderBy: { createdAt: "asc" } },
      // Spec §4B — plan references existing recruitment events. Load its
      // participation entries + the underlying event so the UI can render
      // them without a second round-trip.
      plannedEvents: {
        include: {
          event: {
            select: { id: true, name: true, date: true, city: true, country: true, status: true },
          },
          institutionRepresented: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
      },
      variationRequests: {
        orderBy: { requestedAt: "desc" },
        include: {
          requestedBy: { select: { name: true } },
          approvedBy: { select: { name: true } },
        },
      },
    },
  });
  if (!plan) notFound();

  // Spec §4B — lookups for the Event Participation picker. Only future +
  // recent events (last 90 days) so the dropdown stays scannable.
  const eventLookupFrom = new Date();
  eventLookupFrom.setDate(eventLookupFrom.getDate() - 90);
  const [availableEvents, availableInstitutions] = await Promise.all([
    db.event.findMany({
      where: { deletedAt: null, date: { gte: eventLookupFrom } },
      select: { id: true, name: true, date: true, city: true, country: true, status: true },
      orderBy: { date: "asc" },
      take: 100,
    }),
    db.institution.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <PlanDetailClient
      plan={JSON.parse(JSON.stringify(plan))}
      currentUserId={session.user.id}
      currentUserRole={session.user.role}
      availableEvents={JSON.parse(JSON.stringify(availableEvents))}
      availableInstitutions={availableInstitutions}
    />
  );
}
