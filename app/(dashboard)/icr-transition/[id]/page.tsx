import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { TRANSITION_TYPE_LABELS } from "@/lib/icr-transition";
import { ReportEditor } from "../_components/report-editor";

/**
 * One Transition Report.
 *
 * The shell renders on the server so entitlement is decided before anything is
 * sent; the editor is a client component that loads the report body (including
 * live CRM context) from the API, so saving a section does not require a full
 * page round trip.
 */

export const dynamic = "force-dynamic";

export default async function TransitionReportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role;
  if (!(await effectiveHasPermission(role, "icr_transition", "read"))) {
    redirect("/dashboard");
  }

  const { id } = await params;
  const report = await db.transitionReport.findUnique({
    where: { id },
    select: {
      id: true, status: true, transitionType: true,
      effectiveTransitionDate: true, reportDueDate: true, finalWorkingDay: true,
      outgoingIcrId: true, incomingIcrId: true, regionalManagerId: true,
      clientRelationsDirectorId: true, vpGlobalSalesId: true,
      institution: { select: { name: true, country: true } },
      outgoingIcr: { select: { name: true, email: true } },
      incomingIcr: { select: { name: true } },
      regionalManager: { select: { name: true } },
    },
  });
  if (!report) notFound();

  // Same entitlement rule as the API. A 404 rather than a redirect, because
  // confirming a report exists for a named ICR is itself information about who
  // is leaving.
  const isParticipant =
    report.outgoingIcrId === session.user.id ||
    report.incomingIcrId === session.user.id ||
    report.regionalManagerId === session.user.id ||
    report.clientRelationsDirectorId === session.user.id ||
    report.vpGlobalSalesId === session.user.id;
  const seesEverything = role === "SUPER_ADMIN" || role === "HQ_EXECUTIVE";
  const readsFinalOnly =
    (role === "VP_GLOBAL_SALES" || role === "ACCOUNT_MANAGER") &&
    (report.status === "FINAL" || report.status === "ARCHIVED");

  if (!seesEverything && !isParticipant && !readsFinalOnly) notFound();

  const fmt = (d: Date | null) =>
    d ? new Date(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "—";

  return (
    <div className="p-6 space-y-5">
      <Link
        href="/icr-transition"
        className="text-sm text-slate-500 hover:text-slate-900 dark:hover:text-slate-100"
      >
        ← All handovers
      </Link>

      <header className="space-y-1">
        <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          {report.outgoingIcr.name ?? report.outgoingIcr.email} — {report.institution.name}
        </h1>
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
          <span>{TRANSITION_TYPE_LABELS[report.transitionType]}</span>
          <span>Effective {fmt(report.effectiveTransitionDate)}</span>
          <span>Report due {fmt(report.reportDueDate)}</span>
          {report.finalWorkingDay && <span>Last day {fmt(report.finalWorkingDay)}</span>}
          <span>Reviewer: {report.regionalManager.name ?? "—"}</span>
          <span>Incoming: {report.incomingIcr?.name ?? "not yet known"}</span>
        </div>
      </header>

      <ReportEditor reportId={report.id} />
    </div>
  );
}
