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

  return (
    <PlanDetailClient
      plan={JSON.parse(JSON.stringify(plan))}
      currentUserId={session.user.id}
      currentUserRole={session.user.role}
    />
  );
}
