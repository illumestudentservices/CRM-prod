import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import {
  totals, rollupForecasts, buildOutlookExports, bucketAvgConfidence, bucketVariance,
  type RollupBucket, MATURITY_LABELS, SEGMENT_LABELS,
} from "@/lib/forecasting";
import { ExportButton } from "@/components/shared/export-button";

/**
 * Forecasting dashboard (spec §29-equivalent).
 *
 * A server component so the row scope is decided once, on the server, against
 * the session — the list a user sees is the list they are entitled to, not a
 * client filter over everything.
 *
 * Two views, chosen by ?view: the per-forecast LIST (default) and a roll-up
 * SUMMARY that totals the expected numbers by intake and by region — the one
 * screen a VP or RM opens instead of adding forty rows in their head.
 */

export const dynamic = "force-dynamic";

/** Mirrors scopeFilter in app/api/forecasts/route.ts, including failing closed. */
function scopeFilter(role: Role, userId: string) {
  switch (role) {
    case "SUPER_ADMIN":
    case "HQ_EXECUTIVE":
    case "HQ_ANALYTICS":
    case "VP_GLOBAL_SALES":
      return {};
    case "REGIONAL_MANAGER":
      return { OR: [{ regionalManagerId: userId }, { icrId: userId }] };
    case "ICR":
      return { icrId: userId };
    default:
      return { id: "__no_access__" };
  }
}

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  SUBMITTED_TO_RM: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  RETURNED_TO_ICR: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  RM_REVIEWED: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  REGIONAL_SUBMITTED: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  RETURNED_TO_RM: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  ACCEPTED: "bg-emerald-600 text-white",
  ARCHIVED: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

const STATUS_LABEL: Record<string, string> = {
  DRAFT: "Draft",
  SUBMITTED_TO_RM: "With Regional Manager",
  RETURNED_TO_ICR: "Returned for changes",
  RM_REVIEWED: "Reviewed",
  REGIONAL_SUBMITTED: "With VP",
  RETURNED_TO_RM: "Returned to RM",
  ACCEPTED: "Accepted",
  ARCHIVED: "Archived",
};

const MONTHS = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const MONTHS_SHORT = [
  "", "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export default async function ForecastingPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string; fy?: string; region?: string; status?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role;
  if (!(await effectiveHasPermission(role, "forecasting", "read"))) {
    redirect("/dashboard");
  }

  const sp = (await searchParams) ?? {};
  const view = sp.view === "summary" ? "summary" : "list";

  const forecasts = await db.forecast.findMany({
    where: scopeFilter(role, session.user.id),
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
    select: {
      id: true, periodYear: true, periodMonth: true, status: true,
      intakeYear: true, intakeMonth: true, confidenceScore: true,
      pipelineMaturity: true, actualEnrolments: true,
      institutionId: true, icrId: true,
      institution: { select: { name: true } },
      // Region of the ICR who owns the forecast — the same key the review chain
      // scopes by (lib/forecasting.ts canReview uses icr.regionId).
      icr: { select: { name: true, email: true, region: { select: { name: true } } } },
      segments: {
        select: {
          segment: true,
          icrApplications: true, icrDeposits: true, icrEnrolments: true,
          rmApplications: true, rmDeposits: true, rmEnrolments: true,
        },
      },
    },
  });

  const open = forecasts.filter((f) => f.status !== "ACCEPTED" && f.status !== "ARCHIVED");
  const closed = forecasts.filter((f) => f.status === "ACCEPTED" || f.status === "ARCHIVED");

  // ─── Summary filters (intake year / region / status) ───────────────────────
  // Options come from everything in the user's scope; the chosen filters narrow
  // the set BEFORE the roll-up dedups, so totals reflect exactly the slice shown.
  const regionName = (f: (typeof forecasts)[number]) => f.icr.region?.name ?? "No region";
  const years = [...new Set(forecasts.map((f) => f.intakeYear))].sort((a, b) => a - b);
  const regions = [...new Set(forecasts.map(regionName))].sort((a, b) => a.localeCompare(b));

  const fy = sp.fy && /^\d{4}$/.test(sp.fy) && years.includes(Number(sp.fy)) ? Number(sp.fy) : null;
  const regionFilter = sp.region && regions.includes(sp.region) ? sp.region : null;
  const statusMode: "ALL" | "ACCEPTED" | "OPEN" =
    sp.status === "ACCEPTED" || sp.status === "OPEN" ? sp.status : "ALL";
  const filtersActive = fy !== null || regionFilter !== null || statusMode !== "ALL";

  let filtered = forecasts;
  if (fy !== null) filtered = filtered.filter((f) => f.intakeYear === fy);
  if (regionFilter) filtered = filtered.filter((f) => regionName(f) === regionFilter);
  if (statusMode === "ACCEPTED") filtered = filtered.filter((f) => f.status === "ACCEPTED");
  else if (statusMode === "OPEN") filtered = filtered.filter((f) => f.status !== "ACCEPTED" && f.status !== "ARCHIVED");

  // Current forecast per intake, region and institution (dedup + effective).
  const rollup = rollupForecasts(filtered);
  const exportSections = buildOutlookExports(rollup);

  function row(f: (typeof forecasts)[number]) {
    const t = totals(f.segments);
    return (
      <li key={f.id}>
        <Link
          href={`/forecasting/${f.id}`}
          className="block rounded-lg border border-slate-200 p-4 hover:bg-slate-50 dark:border-slate-700 dark:hover:bg-slate-800/60"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-slate-900 dark:text-slate-100">
              {f.institution.name}
            </span>
            <span className="text-sm text-slate-500">
              {MONTHS[f.intakeMonth]} {f.intakeYear} intake
            </span>
            <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[f.status]}`}>
              {STATUS_LABEL[f.status]}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-5 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
            <span>{f.icr.name ?? f.icr.email}</span>
            <span>Forecast period {MONTHS[f.periodMonth]} {f.periodYear}</span>
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {t.effective.enrolments} enrolments
            </span>
            {t.adjusted && t.icr.enrolments !== t.effective.enrolments && (
              <span className="text-amber-600 dark:text-amber-400">
                RM adjusted from {t.icr.enrolments}
              </span>
            )}
            {f.confidenceScore && <span>Confidence {f.confidenceScore}/5</span>}
            {f.pipelineMaturity && <span>{MATURITY_LABELS[f.pipelineMaturity]}</span>}
          </div>
        </Link>
      </li>
    );
  }

  const tab = (key: "list" | "summary", label: string, count?: number) => {
    const active = view === key;
    const href = key === "summary" ? "/forecasting?view=summary" : "/forecasting";
    return (
      <Link
        href={href}
        className={
          "rounded-full border px-3 py-1 text-xs font-medium transition-colors " +
          (active
            ? "border-slate-900 bg-slate-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900"
            : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800/60")
        }
      >
        {label}{count !== undefined ? ` ${count}` : ""}
      </Link>
    );
  };

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Forecasting</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Monthly enrolment forecasts by institution and intake, from ICR judgement
          through Regional Manager review to VP acceptance.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {tab("list", "Forecasts", forecasts.length)}
        {tab("summary", "Summary")}
        {view === "summary" && rollup.grand.n > 0 && (
          <div className="ml-auto">
            <ExportButton exports={exportSections} title="Projected Enrollment Outlook" />
          </div>
        )}
      </div>

      {view === "summary" ? (
        <>
          <ForecastFilters
            years={years} regions={regions}
            fy={fy} region={regionFilter} status={statusMode}
            active={filtersActive} shown={filtered.length} total={forecasts.length}
          />
          <RollupSummary {...rollup} />
        </>
      ) : (
        <>
          <section>
            <h2 className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">
              Open forecasts ({open.length})
            </h2>
            {open.length === 0 ? (
              <p className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
                No forecasts in progress.
              </p>
            ) : (
              <ul className="space-y-2">{open.map(row)}</ul>
            )}
          </section>

          {closed.length > 0 && (
            <section>
              <h2 className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">
                Accepted ({closed.length})
              </h2>
              <ul className="space-y-2">{closed.map(row)}</ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function num(n: number) {
  return n.toLocaleString("en-CA");
}

/**
 * Summary filters — a plain GET form so it works with no client JS (server
 * component): changing a select and pressing Apply reloads with new query
 * params, which the page reads back. `view=summary` is kept so Apply stays on
 * this tab.
 */
function ForecastFilters({
  years, regions, fy, region, status, active, shown, total,
}: {
  years: number[];
  regions: string[];
  fy: number | null;
  region: string | null;
  status: "ALL" | "ACCEPTED" | "OPEN";
  active: boolean;
  shown: number;
  total: number;
}) {
  const selectClass =
    "rounded-md border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200";
  const labelClass = "flex flex-col gap-1 text-xs font-medium text-slate-500 dark:text-slate-400";
  return (
    <form method="get" className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
      <input type="hidden" name="view" value="summary" />
      <label className={labelClass}>
        Intake year
        <select name="fy" defaultValue={fy ?? ""} className={selectClass}>
          <option value="">All years</option>
          {years.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
      </label>
      <label className={labelClass}>
        Region
        <select name="region" defaultValue={region ?? ""} className={selectClass}>
          <option value="">All regions</option>
          {regions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
      </label>
      <label className={labelClass}>
        Status
        <select name="status" defaultValue={status} className={selectClass}>
          <option value="ALL">All (current)</option>
          <option value="ACCEPTED">Accepted only</option>
          <option value="OPEN">In progress</option>
        </select>
      </label>
      <button
        type="submit"
        className="rounded-md bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200"
      >
        Apply
      </button>
      {active && (
        <Link href="/forecasting?view=summary" className="px-2 py-1.5 text-sm text-slate-500 underline underline-offset-2 hover:text-slate-700 dark:hover:text-slate-200">
          Clear
        </Link>
      )}
      <span className="ml-auto self-center text-xs text-slate-400 dark:text-slate-500">
        Showing {shown} of {total} forecasts
      </span>
    </form>
  );
}

const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => (
  <th className={`px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500 ${right ? "text-right" : "text-left"}`}>
    {children}
  </th>
);
const Td = ({ children, right, strong }: { children: React.ReactNode; right?: boolean; strong?: boolean }) => (
  <td className={`px-3 py-2.5 text-sm ${right ? "text-right tabular-nums" : "text-left"} ${strong ? "font-semibold text-slate-900 dark:text-slate-100" : "text-slate-600 dark:text-slate-300"}`}>
    {children}
  </td>
);

function conf(b: RollupBucket) {
  const v = bucketAvgConfidence(b);
  return v === null ? "—" : `${v}/5`;
}

/** One breakdown table (intake / region / institution) with the Outlook columns. */
function BreakdownTable({
  heading, firstCol, rows, grand,
}: {
  heading: string;
  firstCol: string;
  rows: Array<{ key: string; label: string; bucket: RollupBucket }>;
  grand: RollupBucket;
}) {
  return (
    <section>
      <h2 className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-300">{heading}</h2>
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800/50">
            <tr>
              <Th>{firstCol}</Th>
              <Th right>Forecasts</Th>
              <Th right>Applications</Th>
              <Th right>Deposits</Th>
              <Th right>Enrolments</Th>
              <Th right>Weighted</Th>
              <Th right>Avg conf.</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows.map((r) => (
              <tr key={r.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <Td strong>{r.label}</Td>
                <Td right>{num(r.bucket.n)}</Td>
                <Td right>{num(r.bucket.applications)}</Td>
                <Td right>{num(r.bucket.deposits)}</Td>
                <Td right strong>{num(r.bucket.enrolments)}</Td>
                <Td right>{num(Math.round(r.bucket.weighted))}</Td>
                <Td right>{conf(r.bucket)}</Td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
            <tr>
              <Td strong>Total</Td>
              <Td right strong>{num(grand.n)}</Td>
              <Td right strong>{num(grand.applications)}</Td>
              <Td right strong>{num(grand.deposits)}</Td>
              <Td right strong>{num(grand.enrolments)}</Td>
              <Td right strong>{num(Math.round(grand.weighted))}</Td>
              <Td right strong>{conf(grand)}</Td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}

type Variance = NonNullable<ReturnType<typeof bucketVariance>>;

function varianceCell(v: Variance) {
  return (
    <span className={v.variance >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"}>
      {v.variance > 0 ? "+" : ""}{num(v.variance)}
      {v.percent === null ? "" : ` (${v.percent > 0 ? "+" : ""}${v.percent}%)`}
    </span>
  );
}

/** One Forecast-vs-Actual table; renders nothing when no row has an actual yet. */
function VarianceTable({
  heading, firstCol, rows, grand,
}: {
  heading: string;
  firstCol: string;
  rows: Array<{ key: string; label: string; bucket: RollupBucket }>;
  grand: Variance | null;
}) {
  const withActual = rows
    .map((r) => ({ ...r, v: bucketVariance(r.bucket) }))
    .filter((r): r is typeof r & { v: Variance } => r.v !== null);
  if (withActual.length === 0) return null;
  return (
    <div>
      <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">{heading}</h3>
      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
        <table className="w-full">
          <thead className="bg-slate-50 dark:bg-slate-800/50">
            <tr><Th>{firstCol}</Th><Th right>Forecast</Th><Th right>Actual</Th><Th right>Variance</Th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {withActual.map((r) => (
              <tr key={r.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                <Td strong>{r.label}</Td>
                <Td right>{num(r.v.forecast)}</Td>
                <Td right strong>{num(r.v.actual)}</Td>
                <Td right>{varianceCell(r.v)}</Td>
              </tr>
            ))}
          </tbody>
          {grand && (
            <tfoot className="border-t border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
              <tr>
                <Td strong>Total</Td>
                <Td right strong>{num(grand.forecast)}</Td>
                <Td right strong>{num(grand.actual)}</Td>
                <Td right strong>{varianceCell(grand)}</Td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function RollupSummary({
  intakeRows,
  regionRows,
  institutionRows,
  segmentRows,
  maturityRows,
  grand,
}: ReturnType<typeof rollupForecasts>) {
  if (grand.n === 0) {
    return (
      <p className="rounded-lg border border-dashed border-slate-200 p-8 text-center text-sm text-slate-500 dark:border-slate-700">
        No forecasts to summarise yet.
      </p>
    );
  }

  const grandVar = bucketVariance(grand);

  return (
    <div className="space-y-6">
      {/* Headline — Projected Enrollment Outlook */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ["Expected enrolments", num(grand.enrolments), "text-emerald-600 dark:text-emerald-400"],
          ["Confidence‑weighted", num(Math.round(grand.weighted)), "text-slate-900 dark:text-slate-100"],
          ["Avg confidence", conf(grand), "text-slate-900 dark:text-slate-100"],
          ["Deposits", num(grand.deposits), "text-slate-900 dark:text-slate-100"],
          ["Applications", num(grand.applications), "text-slate-900 dark:text-slate-100"],
          ["Forecasts counted", num(grand.n), "text-slate-900 dark:text-slate-100"],
        ].map(([label, value, cls]) => (
          <div key={label} className="rounded-xl border border-slate-200 p-4 dark:border-slate-700">
            <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
            <p className={`mt-1 text-2xl font-bold ${cls}`}>{value}</p>
          </div>
        ))}
      </div>
      <p className="-mt-2 text-xs text-slate-400 dark:text-slate-500">
        Projected Enrollment Outlook. The current (most recent) forecast is counted once per
        institution, ICR and intake, using the Regional‑Manager‑adjusted figure where one exists.
        <span className="whitespace-nowrap"> “Weighted”</span> scales each forecast by its confidence
        (score ÷ 5); a forecast with no score is counted in full. Archived forecasts are excluded.
      </p>

      <BreakdownTable
        heading="By intake" firstCol="Intake" grand={grand}
        rows={intakeRows.map((r) => ({ key: `${r.year}-${r.month}`, label: `${MONTHS_SHORT[r.month]} ${r.year}`, bucket: r }))}
      />
      <BreakdownTable
        heading="By region" firstCol="Region" grand={grand}
        rows={regionRows.map((r) => ({ key: r.region, label: r.region, bucket: r }))}
      />
      <BreakdownTable
        heading="By institution" firstCol="Institution" grand={grand}
        rows={institutionRows.map((r) => ({ key: r.institution, label: r.institution, bucket: r }))}
      />
      <BreakdownTable
        heading="By segment" firstCol="Segment" grand={grand}
        rows={segmentRows.map((r) => ({ key: r.segment, label: SEGMENT_LABELS[r.segment], bucket: r }))}
      />
      <BreakdownTable
        heading="By pipeline maturity" firstCol="Pipeline maturity" grand={grand}
        rows={maturityRows.map((r) => ({ key: r.maturity, label: r.label, bucket: r }))}
      />

      {/* Forecast vs Actual — Spec Pillar 6 KPI (Accuracy = Actual ÷ Forecast). */}
      <section className="space-y-3">
        <div>
          <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300">Forecast vs Actual</h2>
          <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">
            Variance against the accepted forecast once actual enrolments are recorded (§31) — a
            planning‑quality measure, not a staff performance score.
          </p>
        </div>
        {grandVar === null ? (
          <p className="rounded-lg border border-dashed border-slate-200 p-6 text-center text-sm text-slate-500 dark:border-slate-700">
            No actual enrolments recorded yet. Once an intake’s actuals are entered on its accepted
            forecast, its variance appears here.
          </p>
        ) : (
          <div className="space-y-4">
            <VarianceTable
              heading="By intake" firstCol="Intake" grand={grandVar}
              rows={intakeRows.map((r) => ({ key: `${r.year}-${r.month}`, label: `${MONTHS_SHORT[r.month]} ${r.year}`, bucket: r }))}
            />
            <VarianceTable
              heading="By region" firstCol="Region" grand={grandVar}
              rows={regionRows.map((r) => ({ key: r.region, label: r.region, bucket: r }))}
            />
            <VarianceTable
              heading="By institution" firstCol="Institution" grand={grandVar}
              rows={institutionRows.map((r) => ({ key: r.institution, label: r.institution, bucket: r }))}
            />
          </div>
        )}
      </section>
    </div>
  );
}
