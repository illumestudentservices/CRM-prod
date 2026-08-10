import { db } from "@/lib/db";
import Link from "next/link";
import { CampaignAttachmentsButton } from "./_components/campaign-attachments-button";

export const dynamic = "force-dynamic";

interface Props {
  searchParams?: Promise<{ status?: string; q?: string }>;
}

/**
 * Marketing Campaigns list. Spec §12 (Recruitment Network) — surfaces the full
 * campaign schema: type, country, city, venue, status lifecycle, attendance.
 *
 * Duplicate-prevention: creating a campaign with a matching name+city+country
 * within ±14 days of an existing one is refused by the POST route with a 409
 * and a "Join Existing" option. This page just shows what's on file.
 */
export default async function CampaignsPage({ searchParams }: Props) {
  const sp = (await searchParams) ?? {};
  const statusFilter = sp.status && sp.status !== "all" ? sp.status : null;
  const q = sp.q ?? "";

  const campaigns = await db.campaign.findMany({
    where: {
      deletedAt: null,
      ...(statusFilter ? { status: statusFilter as never } : {}),
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { channel: { contains: q, mode: "insensitive" } },
              { city: { contains: q, mode: "insensitive" } },
              { country: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { startDate: "desc" },
    include: {
      source: { select: { id: true, name: true, type: true } },
      owner: { select: { id: true, name: true } },
    },
    take: 200,
  });

  // Status counts for the filter bar — one query, five buckets.
  const grouped = await db.campaign.groupBy({
    by: ["status"],
    where: { deletedAt: null },
    _count: { _all: true },
  });
  const counts = Object.fromEntries(grouped.map((g) => [g.status ?? "UNSET", g._count._all]));
  const total = Object.values(counts).reduce((a: number, b) => a + (b as number), 0);

  const STATUS_BADGE: Record<string, string> = {
    PLANNED: "bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700",
    APPROVED: "bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/30",
    OPEN: "bg-green-100 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30",
    COMPLETED: "bg-blue-100 text-blue-700 border-blue-200 dark:bg-blue-500/15 dark:text-blue-300 dark:border-blue-500/30",
    CLOSED: "bg-zinc-100 text-zinc-700 border-zinc-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
    CANCELLED: "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30",
    UNSET: "bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
  };

  const STATUS_TABS: Array<{ key: string; label: string }> = [
    { key: "all", label: "All" },
    { key: "PLANNED", label: "Planned" },
    { key: "APPROVED", label: "Approved" },
    { key: "OPEN", label: "Open" },
    { key: "COMPLETED", label: "Completed" },
    { key: "CLOSED", label: "Closed" },
    { key: "CANCELLED", label: "Cancelled" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {campaigns.length} of {total} campaigns
          {q && <span> · filtered by &quot;{q}&quot;</span>}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b pb-2">
        {STATUS_TABS.map((t) => {
          const active = (statusFilter ?? "all") === t.key;
          const count = t.key === "all" ? total : (counts[t.key] ?? 0);
          const href = t.key === "all" ? "/recruitment-network/campaigns" : `/recruitment-network/campaigns?status=${t.key}`;
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

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">Campaign</th>
              <th className="text-left p-2">Type</th>
              <th className="text-left p-2">Channel</th>
              <th className="text-left p-2">Location</th>
              <th className="text-left p-2">Start → End</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Budget / Spend</th>
              <th className="text-left p-2">Leads</th>
              <th className="text-left p-2">Owner</th>
              <th className="text-left p-2">Source</th>
              <th className="text-center p-2 w-[40px]"></th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => {
              const displayStatus = c.status ?? (c.isActive ? "OPEN" : "CANCELLED");
              const badgeCls = STATUS_BADGE[displayStatus] ?? STATUS_BADGE.UNSET;
              const location = [c.city, c.country].filter(Boolean).join(", ") || (c.venue ?? "—");
              return (
                <tr key={c.id} className="border-t hover:bg-muted/50">
                  <td className="p-2 font-medium">{c.name}</td>
                  <td className="p-2 text-muted-foreground">{c.type ?? "—"}</td>
                  <td className="p-2">{c.channel}</td>
                  <td className="p-2">{location}</td>
                  <td className="p-2 whitespace-nowrap">
                    {c.startDate.toISOString().slice(0, 10)}
                    {" → "}
                    {c.endDate?.toISOString().slice(0, 10) ?? "—"}
                  </td>
                  <td className="p-2">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide border ${badgeCls}`}>
                      {displayStatus}
                    </span>
                  </td>
                  <td className="p-2 whitespace-nowrap">
                    {c.actualSpend != null
                      ? `$${c.actualSpend.toLocaleString()}`
                      : c.budget != null
                      ? `$${c.budget.toLocaleString()} (planned)`
                      : "—"}
                  </td>
                  <td className="p-2">{c.leadsGenerated}</td>
                  <td className="p-2 text-muted-foreground">{c.owner?.name ?? "—"}</td>
                  <td className="p-2">
                    {c.source ? (
                      <Link href={`/recruitment-network/partners/${c.source.id}`} className="text-blue-600 dark:text-blue-400 hover:underline">
                        {c.source.name}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-2 text-center">
                    <CampaignAttachmentsButton campaignId={c.id} campaignName={c.name} />
                  </td>
                </tr>
              );
            })}
            {campaigns.length === 0 && (
              <tr>
                <td colSpan={11} className="p-6 text-center text-muted-foreground">
                  No campaigns match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
