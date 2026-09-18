import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { NewPlanButton } from "./_components/new-plan-button";

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED: "Submitted",
  REGIONAL_MANAGER_REVIEW: "RM Review",
  ACCOUNT_MANAGER_REVIEW: "AM Review",
  INTERNAL_FINAL_REVIEW: "Internal Final",
  CLIENT_REVIEW: "Client Review",
  APPROVED: "Approved",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  CLOSED: "Closed",
  RETURNED: "Returned",
};

export default async function RecruitmentPlanningPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const isIcr = session.user.role === "ICR";
  const isRegional = session.user.role === "REGIONAL_MANAGER";

  const plans = await db.quarterlyRecruitmentPlan.findMany({
    where: isIcr
      ? { icrId: session.user.id }
      : isRegional && session.user.regionId
        ? { icr: { regionId: session.user.regionId } }
        : {},
    orderBy: [{ year: "desc" }, { quarter: "desc" }, { createdAt: "desc" }],
    include: {
      icr: { select: { id: true, name: true } },
      institution: { select: { name: true } },
      market: { select: { name: true, code: true } },
      _count: { select: { plannedTravel: true, plannedEvents: true, budgetItems: true, variationRequests: true } },
    },
    take: 100,
  });

  return (
    // The p-6 wrapper, the title and the subtitle now live in layout.tsx, which
    // also draws the Plans / Events / Campaigns tabs. Leaving them here as well
    // would render the heading twice.
    <div>
      <div className="flex items-center justify-end mb-4">
        <NewPlanButton defaultIcrId={session.user.id} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm border">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">Quarter</th>
              <th className="text-left p-2">ICR</th>
              <th className="text-left p-2">Client / Market</th>
              <th className="text-left p-2">Currency</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Travel</th>
              <th className="text-left p-2">Events</th>
              <th className="text-left p-2">Budget items</th>
              <th className="text-left p-2">Variations</th>
            </tr>
          </thead>
          <tbody>
            {plans.map((p) => (
              <tr key={p.id} className="border-t hover:bg-muted/50">
                <td className="p-2">
                  <Link href={`/recruitment-planning/${p.id}`} className="text-blue-600 hover:underline">
                    Q{p.quarter} {p.year}
                  </Link>
                </td>
                <td className="p-2">{p.icr.name}</td>
                <td className="p-2">{p.institution?.name ?? p.market?.name ?? "—"}</td>
                <td className="p-2">{p.reportingCurrency}</td>
                <td className="p-2">
                  <span className="text-xs px-2 py-0.5 bg-muted rounded">{STATUS_LABELS[p.status] ?? p.status}</span>
                </td>
                <td className="p-2">{p._count.plannedTravel}</td>
                <td className="p-2">{p._count.plannedEvents}</td>
                <td className="p-2">{p._count.budgetItems}</td>
                <td className="p-2">{p._count.variationRequests}</td>
              </tr>
            ))}
            {plans.length === 0 && (
              <tr><td colSpan={9} className="p-4 text-center text-sm text-muted-foreground">No plans yet. Click "New plan" to create one.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
