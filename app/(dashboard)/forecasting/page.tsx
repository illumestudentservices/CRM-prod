import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { totals, MATURITY_LABELS } from "@/lib/forecasting";

/**
 * Forecasting dashboard (spec §29-equivalent).
 *
 * A server component so the row scope is decided once, on the server, against
 * the session — the list a user sees is the list they are entitled to, not a
 * client filter over everything.
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

export default async function ForecastingPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role;
  if (!(await effectiveHasPermission(role, "forecasting", "read"))) {
    redirect("/dashboard");
  }

  const forecasts = await db.forecast.findMany({
    where: scopeFilter(role, session.user.id),
    orderBy: [{ periodYear: "desc" }, { periodMonth: "desc" }],
    select: {
      id: true, periodYear: true, periodMonth: true, status: true,
      intakeYear: true, intakeMonth: true, confidenceScore: true,
      pipelineMaturity: true,
      institution: { select: { name: true } },
      icr: { select: { name: true, email: true } },
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
            {/* Spec §13: when the RM has adjusted, both numbers are shown. The
                whole point of keeping them is that a reader can see the
                disagreement, so hiding the original here would waste it. */}
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

  return (
    <div className="space-y-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Forecasting</h1>
        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
          Monthly enrolment forecasts by institution and intake, from ICR judgement
          through Regional Manager review to VP acceptance.
        </p>
      </div>

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
    </div>
  );
}
