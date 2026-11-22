import { db } from "@/lib/db";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import type { Role } from "@/lib/permissions";
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
  // Only roles that can actually create a plan see the button; the API already
  // enforces recruitment_planning:write.
  const canCreatePlan = await effectiveHasPermission(
    session.user.role as Role,
    "recruitment_planning",
    "write"
  );

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
        {canCreatePlan && <NewPlanButton defaultIcrId={session.user.id} />}
      </div>

      <p className="text-sm text-muted-foreground mb-3">
        {plans.length === scopedPlans.length
          ? `${plans.length} plan${plans.length === 1 ? "" : "s"}`
          : `${plans.length} of ${scopedPlans.length} plans`}
      </p>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Quarter</TableHead>
              <TableHead>ICR</TableHead>
              <TableHead>Client / Market</TableHead>
              <TableHead>Currency</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Travel</TableHead>
              <TableHead className="text-right">Events</TableHead>
              <TableHead className="text-right">Budget items</TableHead>
              <TableHead className="text-right">Variations</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {plans.map((p) => (
              <TableRow key={p.id}>
                <TableCell>
                  <Link href={`/recruitment-planning/${p.id}`} className="font-medium text-blue-600 hover:underline dark:text-blue-400">
                    Q{p.quarter} {p.year}
                  </Link>
                </TableCell>
                <TableCell>{p.icr.name}</TableCell>
                <TableCell>{p.institution?.name ?? p.market?.name ?? "—"}</TableCell>
                <TableCell>{p.reportingCurrency}</TableCell>
                <TableCell>
                  <span className="rounded bg-slate-100 px-2 py-0.5 text-xs dark:bg-slate-800">{STATUS_LABELS[p.status] ?? p.status}</span>
                </TableCell>
                <TableCell className="text-right tabular-nums">{p._count.plannedTravel}</TableCell>
                <TableCell className="text-right tabular-nums">{p._count.plannedEvents}</TableCell>
                <TableCell className="text-right tabular-nums">{p._count.budgetItems}</TableCell>
                <TableCell className="text-right tabular-nums">{p._count.variationRequests}</TableCell>
              </TableRow>
            ))}
            {plans.length === 0 && (
              <TableRow><TableCell colSpan={9} className="py-8 text-center text-sm text-muted-foreground">No plans yet. Click &quot;New plan&quot; to create one.</TableCell></TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
