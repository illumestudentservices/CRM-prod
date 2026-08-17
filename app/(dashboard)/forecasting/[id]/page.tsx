import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import {
  canEditIcrValues, canReview, isLocked, MATURITY_LABELS, totals,
} from "@/lib/forecasting";
import { computePipeline } from "@/lib/forecast-pipeline";
import { ForecastGrid } from "./_components/forecast-grid";

/**
 * One forecast: the live pipeline it is judged against, and the judgement.
 *
 * The pipeline panel is read-only and computed on every request. Spec §5 is
 * explicit that those figures are "system-generated and should not be manually
 * editable from Forecasting", so they are shown as context for the ICR rather
 * than as anything to type into.
 */

export const dynamic = "force-dynamic";

const MONTHS = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const BUCKET_LABELS: Record<string, string> = {
  activeLeads: "Active leads",
  qualified: "Qualified",
  applicationsSubmitted: "Applications submitted",
  awaitingDecision: "Awaiting decision",
  offersReceived: "Offers received",
  deposits: "Deposits",
  enrolled: "Enrolled",
};

export default async function ForecastPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role;
  if (!(await effectiveHasPermission(role, "forecasting", "read"))) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const forecast = await db.forecast.findUnique({
    where: { id },
    include: {
      institution: { select: { name: true, country: true } },
      market: { select: { name: true } },
      icr: { select: { id: true, name: true, email: true } },
      regionalManager: { select: { name: true } },
      vpReviewer: { select: { name: true } },
      segments: true,
      events: {
        orderBy: { createdAt: "desc" },
        include: { actedBy: { select: { name: true } } },
      },
    },
  });
  if (!forecast) notFound();

  // Row-level entitlement, matching the API. A direct id fetch has to check the
  // same thing the list query scopes, or the scope is decorative.
  const seesAll = ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "VP_GLOBAL_SALES"].includes(role);
  const isParticipant =
    forecast.icrId === session.user.id || forecast.regionalManagerId === session.user.id;
  if (!seesAll && !isParticipant) notFound();

  const canIcr = canEditIcrValues(forecast, session.user.id, role);
  const canRm = canReview(forecast, session.user.id, role);
  const mode = canIcr ? "icr" : canRm ? "rm" : "read";

  const pipeline = await computePipeline({
    institutionId: forecast.institutionId,
    intakeYear: forecast.intakeYear,
    intakeMonth: forecast.intakeMonth,
    icrId: forecast.icrId,
  });

  const t = totals(forecast.segments);

  return (
    <div className="space-y-5 p-6">
      <Link href="/forecasting" className="text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100">
        ← All forecasts
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {forecast.institution.name} — {MONTHS[forecast.intakeMonth]} {forecast.intakeYear} intake
        </h1>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
          <span>Forecast period {MONTHS[forecast.periodMonth]} {forecast.periodYear}</span>
          <span>ICR: {forecast.icr.name ?? forecast.icr.email}</span>
          {forecast.regionalManager && <span>RM: {forecast.regionalManager.name}</span>}
          {forecast.confidenceScore && <span>Confidence {forecast.confidenceScore}/5</span>}
          {forecast.pipelineMaturity && (
            <span>{MATURITY_LABELS[forecast.pipelineMaturity]}</span>
          )}
        </div>
      </header>

      {/* Spec §5 — the facts, read-only. */}
      <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
        <h2 className="mb-1 text-sm font-medium">Current pipeline</h2>
        <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
          Live from student records for this institution and intake. Not editable here —
          change a student&apos;s stage on their record and this follows.
        </p>
        {pipeline.interestsCounted === 0 ? (
          <p className="text-sm text-slate-500">
            No active students for this institution and intake yet.
          </p>
        ) : (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {Object.entries(pipeline.totals).map(([k, v]) => (
              <span key={k} className="text-slate-600 dark:text-slate-300">
                {BUCKET_LABELS[k]}: <strong className="tabular-nums">{v}</strong>
              </span>
            ))}
          </div>
        )}
      </section>

      {/* Spec §6 and §13 — the judgement. */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium">Forecast</h2>
        <ForecastGrid
          forecastId={forecast.id}
          segments={forecast.segments}
          mode={mode}
          locked={isLocked(forecast.status)}
        />
      </section>

      {forecast.rationale && (
        <section className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
          <h2 className="mb-1 text-sm font-medium">Rationale</h2>
          <p className="whitespace-pre-wrap text-sm text-slate-700 dark:text-slate-300">
            {forecast.rationale}
          </p>
          {forecast.rmComment && (
            <>
              <h3 className="mt-3 text-sm font-medium">Regional Manager</h3>
              <p className="whitespace-pre-wrap text-sm text-amber-700 dark:text-amber-300">
                {forecast.rmComment}
              </p>
            </>
          )}
        </section>
      )}

      {t.adjusted && (
        <p className="text-sm text-amber-700 dark:text-amber-300">
          The Regional Manager adjusted this forecast from {t.icr.enrolments} to{" "}
          {t.effective.enrolments} enrolments. Both figures are retained.
        </p>
      )}

      <details className="rounded-lg border border-slate-200 p-4 dark:border-slate-700">
        <summary className="cursor-pointer text-sm font-medium">
          History ({forecast.events.length})
        </summary>
        <ul className="mt-3 space-y-2 text-sm">
          {forecast.events.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-3 text-slate-600 dark:text-slate-400">
              <span className="font-medium text-slate-800 dark:text-slate-200">{e.toStatus}</span>
              <span>{e.actedBy?.name ?? "—"}</span>
              <span>{new Date(e.createdAt).toLocaleString()}</span>
              {e.comments && <span className="w-full text-slate-500">“{e.comments}”</span>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}
