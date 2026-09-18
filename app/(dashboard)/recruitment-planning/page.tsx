import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { NewPlanButton } from "./_components/new-plan-button";
import { PlanFilters } from "./_components/plan-filters";

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

interface Props {
  searchParams?: Promise<{
    status?: string;
    year?: string;
    quarter?: string;
    icr?: string;
    institution?: string;
    market?: string;
  }>;
}

export default async function RecruitmentPlanningPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const isIcr = session.user.role === "ICR";
  const isRegional = session.user.role === "REGIONAL_MANAGER";

  /**
   * Who this user may see AT ALL. Every filter is applied INSIDE this, never
   * instead of it — a filter must narrow the visible set and can never widen
   * it, or a query parameter becomes a way around the scoping.
   */
  const scope = isIcr
    ? { icrId: session.user.id }
    : isRegional && session.user.regionId
      ? { icr: { regionId: session.user.regionId } }
      : {};

  const sp = (await searchParams) ?? {};
  const pick = (v?: string) => (v && v !== "all" ? v : undefined);
  const year = Number(pick(sp.year));
  const quarter = Number(pick(sp.quarter));

  /**
   * Scope AND filters — never spread together.
   *
   * THIS IS NOT STYLE. Spreading them into one object lets a later key
   * overwrite an earlier one, and `icrId` appears in BOTH: the scope pins an
   * ICR to their own rows, and the ICR filter sets the same key. Spread, the
   * filter silently replaced the scope, so `?icr=<a colleague's id>` returned
   * that colleague's plans to someone who may not see them. It was written that
   * way first and qa-planning-filters-ui caught it.
   *
   * `AND` also means this stays correct if the scope ever grows another key:
   * the filter object does not have to know the scope's shape.
   */
  const where = {
    AND: [
      scope,
      {
        ...(pick(sp.status) ? { status: pick(sp.status) as never } : {}),
        ...(Number.isInteger(year) && year > 0 ? { year } : {}),
        ...(Number.isInteger(quarter) && quarter > 0 ? { quarter } : {}),
        ...(pick(sp.icr) ? { icrId: pick(sp.icr) } : {}),
        ...(pick(sp.institution) ? { institutionId: pick(sp.institution) } : {}),
        ...(pick(sp.market) ? { marketId: pick(sp.market) } : {}),
      },
    ],
  };

  const plans = await db.quarterlyRecruitmentPlan.findMany({
    where,
    orderBy: [{ year: "desc" }, { quarter: "desc" }, { createdAt: "desc" }],
    include: {
      icr: { select: { id: true, name: true } },
      institution: { select: { name: true } },
      market: { select: { name: true, code: true } },
      _count: { select: { plannedTravel: true, plannedEvents: true, budgetItems: true, variationRequests: true } },
    },
    take: 100,
  });

  /**
   * The filter option lists.
   *
   * Built from `scope`, NOT from the whole table and NOT from `where` — two
   * separate points:
   *
   *  - From `scope`, because listing every ICR, client and market in the
   *    database would leak colleague and client names through a dropdown to
   *    someone who cannot open a single one of those plans.
   *  - NOT from `where`, because once you pick a year the other dropdowns must
   *    still offer everything else you could pick; narrowing them to the
   *    current result makes the filters feel broken.
   */
  const scopedPlans = await db.quarterlyRecruitmentPlan.findMany({
    where: scope,
    select: {
      year: true,
      icr: { select: { id: true, name: true } },
      institution: { select: { id: true, name: true } },
      market: { select: { id: true, name: true } },
    },
  });

  const uniqueBy = <T extends { id: string; name: string | null }>(rows: (T | null)[]) => {
    const seen = new Map<string, { id: string; name: string }>();
    for (const r of rows) if (r?.id) seen.set(r.id, { id: r.id, name: r.name ?? r.id });
    return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
  };

  const years = [...new Set(scopedPlans.map((p) => p.year))].sort((a, b) => b - a);
  // Withheld for an ICR: every row is theirs, so the control would offer one
  // choice and filter nothing.
  const icrs = isIcr ? [] : uniqueBy(scopedPlans.map((p) => p.icr));
  const institutions = uniqueBy(scopedPlans.map((p) => p.institution));
  const markets = uniqueBy(scopedPlans.map((p) => p.market));
  const statuses = Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }));

  return (
    // The p-6 wrapper, the title and the subtitle now live in layout.tsx, which
    // also draws the Plans / Events / Campaigns tabs. Leaving them here as well
    // would render the heading twice.
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <PlanFilters
          statuses={statuses}
          years={years}
          icrs={icrs}
          institutions={institutions}
          markets={markets}
        />
        <NewPlanButton defaultIcrId={session.user.id} />
      </div>

      <p className="text-sm text-muted-foreground mb-3">
        {plans.length === scopedPlans.length
          ? `${plans.length} plan${plans.length === 1 ? "" : "s"}`
          : `${plans.length} of ${scopedPlans.length} plans`}
      </p>

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
