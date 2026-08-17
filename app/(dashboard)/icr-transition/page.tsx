import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { TRANSITION_TYPE_LABELS } from "@/lib/icr-transition";
import { NewTransitionButton } from "./_components/new-transition-button";

/**
 * ICR Transition dashboard (spec §29).
 *
 * A server component so the row scope is applied in one place, on the server,
 * against the session — the list a user sees is the list they are entitled to,
 * not a client filter over everything.
 */

export const dynamic = "force-dynamic";

/** Mirrors scopeFilter() in the API route. */
function scopeFilter(role: Role, userId: string) {
  switch (role) {
    case "SUPER_ADMIN":
    case "HQ_EXECUTIVE":
      return {};
    case "VP_GLOBAL_SALES":
    case "ACCOUNT_MANAGER":
      return { status: { in: ["FINAL", "ARCHIVED"] as ("FINAL" | "ARCHIVED")[] } };
    case "REGIONAL_MANAGER":
      return { OR: [{ regionalManagerId: userId }, { outgoingIcrId: userId }] };
    case "ICR":
      return { OR: [{ outgoingIcrId: userId }, { incomingIcrId: userId }] };
    default:
      return { id: "__no_access__" };
  }
}

const STATUS_STYLE: Record<string, string> = {
  ASSIGNED: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300",
  IN_PROGRESS: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-200",
  SUBMITTED_TO_RM: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  AMENDMENTS_REQUIRED: "bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200",
  RESUBMITTED: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200",
  ACCEPTED_BY_RM: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200",
  FINAL: "bg-emerald-600 text-white",
  ARCHIVED: "bg-slate-200 text-slate-600 dark:bg-slate-700 dark:text-slate-300",
};

const STATUS_LABEL: Record<string, string> = {
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In progress",
  SUBMITTED_TO_RM: "With Regional Manager",
  AMENDMENTS_REQUIRED: "Amendments required",
  RESUBMITTED: "Resubmitted",
  ACCEPTED_BY_RM: "Accepted",
  FINAL: "Final",
  ARCHIVED: "Archived",
};

/** Whole days until a date, in UTC so a late-evening user is not a day out. */
function daysUntil(d: Date): number {
  const utc = (x: Date) => Date.UTC(x.getFullYear(), x.getMonth(), x.getDate());
  return Math.round((utc(d) - utc(new Date())) / 86400000);
}

export default async function IcrTransitionPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const role = session.user.role as Role;
  if (!(await effectiveHasPermission(role, "icr_transition", "read"))) {
    redirect("/dashboard");
  }

  const isManager = role === "SUPER_ADMIN" || role === "REGIONAL_MANAGER";

  // Options are resolved on the server and passed down, so the dialog needs no
  // extra endpoint and cannot list people the caller could not otherwise see.
  const [icrUsers, institutionOpts, managerUsers] = isManager
    ? await Promise.all([
        db.user.findMany({
          where: { deletedAt: null, isActive: true, role: { in: ["ICR", "ACCOUNT_MANAGER"] } },
          select: { id: true, name: true, email: true }, orderBy: { name: "asc" },
        }),
        db.institution.findMany({
          where: { deletedAt: null },
          select: { id: true, name: true, country: true }, orderBy: { name: "asc" },
        }),
        db.user.findMany({
          where: { deletedAt: null, isActive: true, role: { in: ["REGIONAL_MANAGER", "SUPER_ADMIN"] } },
          select: { id: true, name: true, email: true }, orderBy: { name: "asc" },
        }),
      ])
    : [[], [], []];

  const [reports, canCreate] = await Promise.all([
    db.transitionReport.findMany({
      where: scopeFilter(role, session.user.id),
      orderBy: [{ status: "asc" }, { reportDueDate: "asc" }],
      select: {
        id: true, status: true, transitionType: true,
        effectiveTransitionDate: true, reportDueDate: true,
        institution: { select: { name: true, country: true } },
        outgoingIcr: { select: { name: true, email: true } },
        incomingIcr: { select: { name: true } },
        regionalManager: { select: { name: true } },
        sections: { select: { completedAt: true } },
      },
    }),
    effectiveHasPermission(role, "icr_transition", "write"),
  ]);

  const open = reports.filter((r) => r.status !== "FINAL" && r.status !== "ARCHIVED");
  const closed = reports.filter((r) => r.status === "FINAL" || r.status === "ARCHIVED");

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
            ICR Transition &amp; Handover
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Structured handovers when an ICR stops covering an assignment.
          </p>
        </div>
        {canCreate && (role === "SUPER_ADMIN" || role === "REGIONAL_MANAGER") && (
          <NewTransitionButton
            icrs={icrUsers.map((u) => ({ id: u.id, label: u.name ?? u.email }))}
            institutions={institutionOpts.map((i) => ({ id: i.id, label: `${i.name} (${i.country})` }))}
            managers={managerUsers.map((u) => ({ id: u.id, label: u.name ?? u.email }))}
          />
        )}
      </div>

      <section>
        <h2 className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">
          Open handovers ({open.length})
        </h2>
        {open.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 p-8 text-center text-sm text-slate-500">
            No handovers in progress.
          </p>
        ) : (
          <ul className="space-y-2">
            {open.map((r) => {
              const done = r.sections.filter((s) => s.completedAt).length;
              const due = daysUntil(r.reportDueDate);
              return (
                <li key={r.id}>
                  <Link
                    href={`/icr-transition/${r.id}`}
                    className="block rounded-lg border border-slate-200 dark:border-slate-700 p-4 hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-slate-900 dark:text-slate-100">
                        {r.outgoingIcr.name ?? r.outgoingIcr.email}
                      </span>
                      <span className="text-slate-400">→</span>
                      <span className="text-slate-700 dark:text-slate-300">
                        {r.incomingIcr?.name ?? "no incoming ICR yet"}
                      </span>
                      <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}>
                        {STATUS_LABEL[r.status]}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-slate-500 dark:text-slate-400">
                      <span>{r.institution.name}</span>
                      <span>{TRANSITION_TYPE_LABELS[r.transitionType]}</span>
                      <span>{done}/15 sections</span>
                      {/* Overdue is the number that matters on this screen: the
                          whole module exists to stop handovers happening after
                          the person has already gone. */}
                      <span
                        className={
                          due < 0
                            ? "font-medium text-red-600 dark:text-red-400"
                            : due <= 7
                              ? "font-medium text-amber-600 dark:text-amber-400"
                              : ""
                        }
                      >
                        {due < 0
                          ? `${Math.abs(due)}d overdue`
                          : due === 0
                            ? "due today"
                            : `due in ${due}d`}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {closed.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-medium text-slate-700 dark:text-slate-300">
            Completed handovers ({closed.length})
          </h2>
          <ul className="space-y-2">
            {closed.map((r) => (
              <li key={r.id}>
                <Link
                  href={`/icr-transition/${r.id}`}
                  className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 p-3 text-sm hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                >
                  <span className="font-medium text-slate-900 dark:text-slate-100">
                    {r.outgoingIcr.name ?? r.outgoingIcr.email}
                  </span>
                  <span className="text-slate-500">{r.institution.name}</span>
                  <span className={`ml-auto rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[r.status]}`}>
                    {STATUS_LABEL[r.status]}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
