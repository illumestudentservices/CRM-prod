import { db } from "@/lib/db";
import type { Role } from "@prisma/client";

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
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-4">
      <Tile label="Planned this week" value={plannedThisWeek} tone="slate" />
      <Tile label="Completed this week" value={completedThisWeek} tone="green" />
      <Tile label="Upcoming" value={upcoming} tone="blue" />
      <Tile label="Overdue" value={overdue} tone={overdue > 0 ? "red" : "slate"} />
      <Tile label="Completion rate" value={`${completionRate}%`} tone="cyan" />
    </div>
  );
}

async function renderRegionalManagerDashboard(regionId: string | null, now: Date) {
  // Group by user. Prisma's groupBy on a filtered set + a joined user name
  // isn't natively supported; do it manually with two queries: pull the ICR
  // roster in the region, then count activities per ICR.
  const icrs = await db.user.findMany({
    where: {
      role: "ICR",
      isActive: true,
      deletedAt: null,
      ...(regionId ? { regionId } : {}),
    },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
    take: 20,
  });

  if (icrs.length === 0) {
    return (
      <div className="mb-4 rounded border border-slate-200 bg-slate-50 p-3 text-sm text-slate-500">
        No ICRs in your region yet.
      </div>
    );
  }

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
    <div className="mb-4 rounded border border-slate-200 overflow-hidden">
      <div className="bg-slate-50 border-b border-slate-200 px-3 py-2 text-xs font-medium text-slate-600">
        Team activity — {icrs.length} ICR{icrs.length === 1 ? "" : "s"} in your region
      </div>
      <table className="w-full text-sm">
        <thead className="bg-slate-50/60 text-slate-500 text-xs">
          <tr>
            <th className="text-left p-2">ICR</th>
            <th className="text-right p-2">Planned</th>
            <th className="text-right p-2">Completed</th>
            <th className="text-right p-2">Overdue</th>
            <th className="text-right p-2">Rate</th>
          </tr>
        </thead>
        <tbody>
          {stats.map(({ icr, planned, completed, overdue, rate }) => (
            <tr key={icr.id} className="border-t">
              <td className="p-2">{icr.name ?? icr.id}</td>
              <td className="p-2 text-right tabular-nums">{planned}</td>
              <td className="p-2 text-right tabular-nums text-green-700">{completed}</td>
              <td className={`p-2 text-right tabular-nums ${overdue > 0 ? "text-red-600" : "text-slate-400"}`}>{overdue}</td>
              <td className="p-2 text-right tabular-nums">{rate}%</td>
            </tr>
          ))}
        </tbody>
      </table>
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

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 mb-4">
      <div className="rounded border border-slate-200 p-3">
        <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">
          Last 30 days — org-wide
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <p className="text-2xl font-semibold tabular-nums text-slate-800">{totalCompleted30d}</p>
            <p className="text-xs text-slate-500">completed</p>
          </div>
          <div>
            <p className={`text-2xl font-semibold tabular-nums ${totalOverdue > 0 ? "text-red-700" : "text-slate-800"}`}>
              {totalOverdue}
            </p>
            <p className="text-xs text-slate-500">overdue</p>
          </div>
        </div>
      </div>

      <div className="rounded border border-slate-200 p-3">
        <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">
          By market (30d completed)
        </p>
        {byRegion.length === 0 ? (
          <p className="text-sm text-slate-400">No activity yet.</p>
        ) : (
          <ul className="space-y-0.5 text-sm">
            {byRegion
              .sort((a, b) => b._count._all - a._count._all)
              .slice(0, 6)
              .map((r) => (
                <li key={r.marketId ?? "unassigned"} className="flex justify-between">
                  <span className="text-slate-600">{marketName(r.marketId)}</span>
                  <span className="tabular-nums">{r._count._all}</span>
                </li>
              ))}
          </ul>
        )}
      </div>

      <div className="rounded border border-slate-200 p-3">
        <p className="text-xs uppercase tracking-wide text-slate-500 mb-2">
          By type (30d completed)
        </p>
        {byType.length === 0 ? (
          <p className="text-sm text-slate-400">No activity yet.</p>
        ) : (
          <ul className="space-y-0.5 text-sm">
            {byType
              .sort((a, b) => b._count._all - a._count._all)
              .slice(0, 6)
              .map((t) => (
                <li key={t.type} className="flex justify-between">
                  <span className="text-slate-600">{t.type.replace(/_/g, " ")}</span>
                  <span className="tabular-nums">{t._count._all}</span>
                </li>
              ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function Tile({ label, value, tone }: { label: string; value: number | string; tone: "slate" | "green" | "blue" | "red" | "cyan" }) {
  const toneCls: Record<string, string> = {
    slate: "bg-slate-50 text-slate-800 border-slate-200",
    green: "bg-green-50 text-green-800 border-green-200",
    blue: "bg-blue-50 text-blue-800 border-blue-200",
    red: "bg-red-50 text-red-800 border-red-200",
    cyan: "bg-cyan-50 text-cyan-800 border-cyan-200",
  };
  return (
    <div className={`rounded border p-3 ${toneCls[tone]}`}>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs opacity-80 mt-0.5">{label}</p>
    </div>
  );
}
