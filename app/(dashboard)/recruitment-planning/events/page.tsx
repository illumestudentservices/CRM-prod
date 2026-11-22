import { db } from "@/lib/db";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import Link from "next/link";
import { ListSearch } from "@/components/shared/list-search";

export const dynamic = "force-dynamic";

interface Props {
  searchParams?: Promise<{ status?: string; type?: string; q?: string }>;
}

/**
 * Recruitment Events list. Spec §7 (Recruitment Events section of Recruitment
 * Network) — one event per record, shared across participating institutions.
 *
 * Duplicate-prevention: POST /api/events refuses (name + city + country + date
 * ±14 days) matches; SUPER_ADMIN can force-create with `forceCreate: true`.
 */
export default async function EventsPage({ searchParams }: Props) {
  const sp = (await searchParams) ?? {};
  const statusFilter = sp.status && sp.status !== "all" ? sp.status : null;
  const typeFilter = sp.type && sp.type !== "all" ? sp.type : null;
  const q = sp.q ?? "";

  const events = await db.event.findMany({
    where: {
      deletedAt: null,
      ...(statusFilter ? { status: statusFilter as never } : {}),
      ...(typeFilter ? { type: typeFilter as never } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { city: { contains: q, mode: "insensitive" } },
              { country: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { date: "desc" },
    include: {
      _count: { select: { participations: true, leads: { where: { deletedAt: null } }, expenses: true } },
      assignedICR: { select: { id: true, name: true } },
      region: { select: { id: true, name: true } },
    },
    take: 200,
  });

  const grouped = await db.event.groupBy({
    by: ["status"],
    where: { deletedAt: null },
    _count: { _all: true },
  });
  const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count._all]));
  const total = Object.values(counts).reduce((a: number, b) => a + (b as number), 0);

  const STATUS_TABS: Array<{ key: string; label: string }> = [
    { key: "all", label: "All" },
    { key: "PLANNED", label: "Planned" },
    { key: "CONFIRMED", label: "Confirmed" },
    { key: "IN_PROGRESS", label: "In Progress" },
    { key: "COMPLETED", label: "Completed" },
    { key: "CLOSED", label: "Closed" },
    { key: "CANCELLED", label: "Cancelled" },
  ];

  const STATUS_BADGE: Record<string, string> = {
    PLANNED: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    CONFIRMED: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30",
    IN_PROGRESS: "bg-violet-100 text-violet-700 border-violet-200 dark:bg-violet-500/15 dark:text-violet-300 dark:border-violet-500/30",
    COMPLETED: "bg-green-100 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30",
    CLOSED: "bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:border-emerald-500/30",
    CANCELLED: "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30",
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {events.length} of {total} events
          {q && <span> · filtered by &quot;{q}&quot;</span>}
        </div>
        <Link
          href="/events"
          className="text-sm px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          + New event
        </Link>
      </div>

      {/* The `q` parameter was honoured by the query below long before
          anything rendered a box for it. This is the missing half. */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ListSearch label="Search events" placeholder="Search by name, city or country…" />
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b pb-2">
        {STATUS_TABS.map((t) => {
          const active = (statusFilter ?? "all") === t.key;
          const count = t.key === "all" ? total : (counts[t.key] ?? 0);
          // Carries the search term across. Without this, choosing a
          // status tab silently throws away what was typed.
          const tabParams = new URLSearchParams();
          if (q) tabParams.set("q", q);
          if (t.key !== "all") tabParams.set("status", t.key);
          const tabQs = tabParams.toString();
          const href = tabQs ? `/recruitment-planning/events?${tabQs}` : "/recruitment-planning/events";
          return (
            <Link
              key={t.key}
              href={href}
              className={
                "text-xs px-2.5 py-1 rounded-full border transition-colors " +
                (active
                  ? "bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100"
                  : "bg-white text-slate-600 hover:bg-slate-50 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-800/60")
              }
            >
              {t.label} <span className="opacity-70">{count}</span>
            </Link>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Event</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Location</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Owner</TableHead>
              <TableHead>Institutions</TableHead>
              <TableHead>Leads</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {events.map((e) => {
              const badgeCls = STATUS_BADGE[e.status] ?? "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300";
              return (
                <TableRow key={e.id}>
                  <TableCell>
                    <Link href={`/events/${e.id}`} className="text-blue-600 dark:text-blue-400 hover:underline font-medium">
                      {e.name}
                    </Link>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{e.type.replace(/_/g, " ")}</TableCell>
                  <TableCell className="whitespace-nowrap">{e.date.toISOString().slice(0, 10)}</TableCell>
                  <TableCell>{e.city}, {e.country}</TableCell>
                  <TableCell>
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide border ${badgeCls}`}>
                      {e.status.replace(/_/g, " ")}
                    </span>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{e.assignedICR?.name ?? "—"}</TableCell>
                  <TableCell>{e._count.participations}</TableCell>
                  <TableCell>{e._count.leads}</TableCell>
                </TableRow>
              );
            })}
            {events.length === 0 && (
              <TableRow>
                <TableCell colSpan={8} className="py-8 text-center text-muted-foreground">
                  No events match the current filter.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
