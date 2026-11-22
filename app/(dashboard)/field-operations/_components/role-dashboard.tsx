import Link from "next/link";
import { db } from "@/lib/db";
import type { Role } from "@prisma/client";
import { regionScope } from "@/lib/region-scope";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

/**
 * Spec §13 (Field Operations) — role-scoped dashboards.
 *
 *   ICR:            Planned this week / Completed this week / Upcoming /
 *                   Overdue / Completion rate
 *   Regional Mgr:   Per-ICR breakdown of the same
 *   Senior Mgmt:    Aggregate by Region / Client / Market / ICR
 *
 * Rendered as a server component so all counts come from a single database
 * round-trip and can be trusted (no client-side re-fetch drift). Placed
 * above the shared ActivitiesClient list on the /field-operations page.
 */

const DAY_MS = 86_400_000;

interface Props {
  userId: string;
  role: Role;
  regionId?: string | null;
}

export async function RoleDashboard({ userId, role, regionId }: Props) {
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const weekAhead = new Date(now.getTime() + 7 * DAY_MS);

  if (role === "ICR") {
    return renderICRDashboard(userId, now, weekAgo, weekAhead);
  }
  if (role === "REGIONAL_MANAGER") {
    return renderRegionalManagerDashboard(regionId ?? null, now);
  }
  if (role === "HQ_EXECUTIVE" || role === "HQ_ANALYTICS" || role === "SUPER_ADMIN" || role === "VP_GLOBAL_SALES") {
    return renderSeniorDashboard(now);
  }
  return null;
}

async function renderICRDashboard(userId: string, now: Date, weekAgo: Date, weekAhead: Date) {
  const [plannedThisWeek, completedThisWeek, upcoming, overdue, allYearCompleted, allYearTotal] = await Promise.all([
    db.activity.count({
      where: { deletedAt: null, userId, status: "PLANNED", date: { gte: weekAgo, lte: weekAhead } },
    }),
    db.activity.count({
      where: { deletedAt: null, userId, status: "COMPLETED", actualDate: { gte: weekAgo } },
    }),
    db.activity.count({
      where: { deletedAt: null, userId, status: "PLANNED", date: { gt: now } },
    }),
    db.activity.count({
      where: {
        deletedAt: null,
        userId,
        status: { in: ["PLANNED", "IN_PROGRESS"] },
        date: { lt: now },
      },
    }),
    db.activity.count({
      where: { deletedAt: null, userId, status: "COMPLETED" },
    }),
    db.activity.count({ where: { deletedAt: null, userId } }),
  ]);

  const completionRate = allYearTotal > 0 ? Math.round((allYearCompleted / allYearTotal) * 100) : 0;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
      <Tile label="Planned this week" value={plannedThisWeek} tone="slate" href="/field-operations?view=plannedWeek" />
      <Tile label="Completed this week" value={completedThisWeek} tone="green" href="/field-operations?view=completedWeek" />
      <Tile label="Upcoming" value={upcoming} tone="blue" href="/field-operations?view=upcoming" />
      <Tile label="Overdue" value={overdue} tone={overdue > 0 ? "red" : "slate"} href="/field-operations?view=overdue" />
      <Tile label="Completion rate" value={`${completionRate}%`} tone="cyan" href="/field-operations?view=completed" />
    </div>
  );
}

async function renderRegionalManagerDashboard(regionId: string | null, now: Date) {
  // Group by user. Prisma's groupBy on a filtered set + a joined user name
  // isn't natively supported; do it manually with two queries: pull the team
  // roster in the region, then count activities per person.
  //
  // ★ TWO BUGS FIXED HERE.
  //
  // 1. The roster was `role: "ICR"`. PRODUCTION HAS NO ICR-ROLE USERS — it runs
  //    on SUPER_ADMIN, HQ_EXECUTIVE and REGIONAL_MANAGER — so this table read
  //    "No ICRs in your region yet" on live no matter how much field work the
  //    team had logged. The roster is now "people in my region", which is what
  //    the heading has always claimed. Ownership is not a role (same lesson as
  //    lib/assignable-users.ts); INSTITUTION_CLIENT is excluded because an
  //    external contact is not a colleague.
  //
  // 2. `...(regionId ? { regionId } : {})` FAILED OPEN. `{}` is not "no
  //    access", it is "no filter" — a Regional Manager with no region set saw
  //    every ICR in every region, which is the precise failure lib/region-scope
  //    .ts exists to prevent. `regionScope()` matches nothing instead, so the
  //    mistake is visible rather than silent.
  const team = await db.user.findMany({
    where: {
      ...regionScope(regionId),
      isActive: true,
      deletedAt: null,
      role: { not: "INSTITUTION_CLIENT" },
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 20,
  });

  if (team.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-700 p-6 text-center text-sm text-slate-500 dark:text-slate-400">
        {regionId
          ? "No colleagues assigned to your region yet."
          : "You have no region set, so there is no team to show. Ask an administrator to assign one."}
      </div>
    );
  }
  const icrs = team;

  const stats = await Promise.all(
    icrs.map(async (icr) => {
      const [planned, completed, overdue] = await Promise.all([
        db.activity.count({
          where: { deletedAt: null, userId: icr.id, status: "PLANNED" },
        }),
        db.activity.count({
          where: { deletedAt: null, userId: icr.id, status: "COMPLETED" },
        }),
        db.activity.count({
          where: {
            deletedAt: null,
            userId: icr.id,
            status: { in: ["PLANNED", "IN_PROGRESS"] },
            date: { lt: now },
          },
        }),
      ]);
      const total = planned + completed;
      const rate = total > 0 ? Math.round((completed / total) * 100) : 0;
      return { icr, planned, completed, overdue, rate };
    })
  );

  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 dark:border-slate-800">
      <div className="border-b border-slate-200 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-300">
        {/* "colleague", not "ICR" — the roster is everyone in the region, because
            on production nobody holds the ICR role. */}
        Team activity — {icrs.length} colleague{icrs.length === 1 ? "" : "s"} in your region
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Colleague</TableHead>
              <TableHead className="text-right">Planned</TableHead>
              <TableHead className="text-right">Completed</TableHead>
              <TableHead className="text-right">Overdue</TableHead>
              <TableHead className="text-right">Rate</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {stats.map(({ icr, planned, completed, overdue, rate }) => (
              <TableRow key={icr.id}>
                <TableCell className="font-medium text-slate-900 dark:text-slate-100">{icr.name ?? icr.id}</TableCell>
                <TableCell className="text-right tabular-nums">{planned}</TableCell>
                <TableCell className="text-right tabular-nums text-emerald-600 dark:text-emerald-400">{completed}</TableCell>
                <TableCell className={`text-right tabular-nums ${overdue > 0 ? "text-red-600 dark:text-red-400" : "text-slate-400 dark:text-slate-500"}`}>{overdue}</TableCell>
                <TableCell className="text-right tabular-nums">{rate}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

async function renderSeniorDashboard(now: Date) {
  const monthAgo = new Date(now.getTime() - 30 * DAY_MS);
  const [byRegion, byType, totalCompleted30d, totalOverdue] = await Promise.all([
    db.activity.groupBy({
      by: ["marketId"],
      where: { deletedAt: null, actualDate: { gte: monthAgo }, status: "COMPLETED" },
      _count: { _all: true },
    }),
    db.activity.groupBy({
      by: ["type"],
      where: { deletedAt: null, actualDate: { gte: monthAgo }, status: "COMPLETED" },
      _count: { _all: true },
    }),
    db.activity.count({
      where: { deletedAt: null, actualDate: { gte: monthAgo }, status: "COMPLETED" },
    }),
    db.activity.count({
      where: {
        deletedAt: null,
        status: { in: ["PLANNED", "IN_PROGRESS"] },
        date: { lt: now },
      },
    }),
  ]);

  // Resolve market names once
  const marketIds = byRegion.map((r) => r.marketId).filter((x): x is string => !!x);
  const markets = marketIds.length
    ? await db.market.findMany({
        where: { id: { in: marketIds } },
        select: { id: true, name: true },
      })
    : [];
  const marketName = (id: string | null) =>
    id ? markets.find((m) => m.id === id)?.name ?? "Unknown" : "Unassigned";

  const cardClass = "rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900";
  const headClass = "mb-3 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500";

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      <div className={cardClass}>
        <p className={headClass}>Last 30 days — org-wide</p>
        <div className="grid grid-cols-2 gap-3">
          <Link href="/field-operations?view=completed" className="block rounded-lg p-1 -m-1 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60">
            <p className="text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">{totalCompleted30d}</p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Completed</p>
          </Link>
          <Link href="/field-operations?view=overdue" className="block rounded-lg p-1 -m-1 transition-colors hover:bg-slate-50 dark:hover:bg-slate-800/60">
            <p className={`text-2xl font-bold tabular-nums ${totalOverdue > 0 ? "text-red-600 dark:text-red-400" : "text-slate-900 dark:text-slate-100"}`}>
              {totalOverdue}
            </p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Overdue</p>
          </Link>
        </div>
      </div>

      <div className={cardClass}>
        <p className={headClass}>By market (30d completed)</p>
        {byRegion.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No activity yet.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {byRegion
              .sort((a, b) => b._count._all - a._count._all)
              .slice(0, 6)
              .map((r) => (
                <li key={r.marketId ?? "unassigned"} className="flex items-center justify-between">
                  <span className="text-slate-600 dark:text-slate-300">{marketName(r.marketId)}</span>
                  <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">{r._count._all}</span>
                </li>
              ))}
          </ul>
        )}
      </div>

      <div className={cardClass}>
        <p className={headClass}>By type (30d completed)</p>
        {byType.length === 0 ? (
          <p className="text-sm text-slate-400 dark:text-slate-500">No activity yet.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {byType
              .sort((a, b) => b._count._all - a._count._all)
              .slice(0, 6)
              .map((t) => (
                <li key={t.type} className="flex items-center justify-between">
                  <span className="capitalize text-slate-600 dark:text-slate-300">{t.type.replace(/_/g, " ").toLowerCase()}</span>
                  <span className="font-medium tabular-nums text-slate-900 dark:text-slate-100">{t._count._all}</span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, tone, href }: { label: string; value: number | string; tone: "slate" | "green" | "blue" | "red" | "cyan"; href?: string }) {
  // Clean neutral card with the NUMBER coloured by tone — matching the stat
  // cards on the dashboard and forecasting pages, instead of fully-filled tiles.
  const accent: Record<string, string> = {
    slate: "text-slate-900 dark:text-slate-100",
    green: "text-emerald-600 dark:text-emerald-400",
    blue: "text-blue-600 dark:text-blue-400",
    red: "text-red-600 dark:text-red-400",
    cyan: "text-cyan-600 dark:text-cyan-400",
  };
  const inner = (
    <>
      <p className="text-xs text-slate-500 dark:text-slate-400">{label}</p>
      <p className={`mt-1 text-2xl font-bold tabular-nums ${accent[tone]}`}>{value}</p>
    </>
  );
  const base = "rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900";
  if (href) {
    return (
      <Link
        href={href}
        title={`Show ${label.toLowerCase()}`}
        className={`${base} block transition-colors hover:border-slate-300 hover:bg-slate-50 dark:hover:border-slate-600 dark:hover:bg-slate-800/60`}
      >
        {inner}
      </Link>
    );
  }
  return <div className={base}>{inner}</div>;
}
