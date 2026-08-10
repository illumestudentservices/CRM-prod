import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import Link from "next/link";

export const dynamic = "force-dynamic";

interface Props {
  searchParams?: Promise<{ type?: string; q?: string }>;
}

/**
 * Recruitment Partners — spec §1 (Recruitment Network) hierarchy:
 *
 *   Recruitment Partners
 *   ├── Agents
 *   ├── Schools
 *   └── Referral Partners
 *
 * The Source model stores all partner types with a discriminator column.
 * Rather than three separate list pages, we render one page with tab
 * filtering — a partner's underlying record is the same regardless of type,
 * and the tabs correspond to the top-level Source.type buckets.
 */

// Spec §1 grouping: type enum values → tab keys. WALK_IN, CAMPAIGN, DIGITAL
// are captured elsewhere (lead channel / campaign records); they aren't
// partner-relationship records so they're excluded from the tabs.
const TYPE_GROUPS: Record<string, { label: string; types: string[] }> = {
  all: { label: "All Partners", types: [] },
  agents: { label: "Agents", types: ["AGENT"] },
  schools: { label: "Schools", types: ["SCHOOL"] },
  referral: { label: "Referral Partners", types: ["REFERRAL_PARTNER", "PARTNER"] },
  education: { label: "Education Partners", types: ["EDUCATION_PARTNER"] },
};

const PARTNER_TAB_TYPES = ["AGENT", "SCHOOL", "REFERRAL_PARTNER", "PARTNER", "EDUCATION_PARTNER"];

const TYPE_BADGE: Record<string, string> = {
  AGENT: "bg-blue-100 text-blue-700 border-blue-200",
  SCHOOL: "bg-indigo-100 text-indigo-700 border-indigo-200",
  REFERRAL_PARTNER: "bg-orange-100 text-orange-700 border-orange-200",
  PARTNER: "bg-amber-100 text-amber-700 border-amber-200",
  EDUCATION_PARTNER: "bg-teal-100 text-teal-700 border-teal-200",
};

const TIER_BADGE: Record<string, string> = {
  PLATINUM: "bg-violet-100 text-violet-700 border-violet-200",
  GOLD: "bg-amber-100 text-amber-700 border-amber-200",
  SILVER: "bg-slate-100 text-slate-600 border-slate-200",
  EMERGING: "bg-green-100 text-green-700 border-green-200",
  INACTIVE: "bg-zinc-100 text-zinc-500 border-zinc-200",
};

export default async function PartnersPage({ searchParams }: Props) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const sp = (await searchParams) ?? {};
  const activeTab = sp.type && TYPE_GROUPS[sp.type] ? sp.type : "all";
  const q = sp.q ?? "";

  // Filter is TYPE_GROUPS-driven. "all" restricts to partner-relationship
  // types only; the other tabs pick their specific enum values.
  const typeFilter =
    activeTab === "all"
      ? { in: PARTNER_TAB_TYPES as never }
      : TYPE_GROUPS[activeTab].types.length === 1
      ? TYPE_GROUPS[activeTab].types[0]
      : { in: TYPE_GROUPS[activeTab].types as never };

  const partners = await db.recruitmentPartner.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      type: typeFilter as never,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: "insensitive" } },
              { country: { contains: q, mode: "insensitive" } },
              { city: { contains: q, mode: "insensitive" } },
              { contactPerson: { contains: q, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: { name: "asc" },
    include: {
      _count: { select: { leads: true, partnerContacts: true } },
      agentProfile: {
        select: { tier: true, enrolments: true, offers: true, yieldRate: true },
      },
    },
    take: 300,
  });

  // Group counts for the tab bar. One groupBy query, five buckets.
  const grouped = await db.recruitmentPartner.groupBy({
    by: ["type"],
    where: {
      deletedAt: null,
      isActive: true,
      type: { in: PARTNER_TAB_TYPES as never },
    },
    _count: { _all: true },
  });
  const rawCounts = Object.fromEntries(grouped.map((g) => [g.type, g._count._all]));
  const counts: Record<string, number> = {
    all: Object.values(rawCounts).reduce((a: number, b) => a + (b as number), 0),
    agents: rawCounts.AGENT ?? 0,
    schools: rawCounts.SCHOOL ?? 0,
    referral: (rawCounts.REFERRAL_PARTNER ?? 0) + (rawCounts.PARTNER ?? 0),
    education: rawCounts.EDUCATION_PARTNER ?? 0,
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-muted-foreground">
          {partners.length} of {counts.all} partners
          {q && <span> · filtered by &quot;{q}&quot;</span>}
        </div>
      </div>

      {/* Spec §1 hierarchy — tab bar */}
      <div className="flex flex-wrap items-center gap-1 border-b pb-2">
        {Object.entries(TYPE_GROUPS).map(([key, group]) => {
          const active = activeTab === key;
          const count = counts[key] ?? 0;
          const href = key === "all" ? "/recruitment-network/partners" : `/recruitment-network/partners?type=${key}`;
          return (
            <Link
              key={key}
              href={href}
              className={
                "text-xs px-2.5 py-1 rounded-full border transition-colors " +
                (active
                  ? "bg-slate-900 text-white border-slate-900"
                  : "bg-white text-slate-600 hover:bg-slate-50 border-slate-200")
              }
            >
              {group.label} <span className="opacity-70">{count}</span>
            </Link>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">Partner</th>
              <th className="text-left p-2">Type</th>
              <th className="text-left p-2">Country / City</th>
              <th className="text-left p-2">Contact</th>
              <th className="text-left p-2">People</th>
              <th className="text-left p-2">Leads</th>
              <th className="text-left p-2">Tier</th>
              <th className="text-left p-2">Enrolments</th>
            </tr>
          </thead>
          <tbody>
            {partners.map((p) => {
              const typeCls = TYPE_BADGE[p.type] ?? "bg-slate-100 text-slate-700 border-slate-200";
              const tierCls = p.agentProfile?.tier
                ? TIER_BADGE[p.agentProfile.tier] ?? "bg-slate-100 text-slate-700 border-slate-200"
                : null;
              return (
                <tr key={p.id} className="border-t hover:bg-muted/50">
                  <td className="p-2">
                    <Link href={`/recruitment-network/partners/${p.id}`} className="text-blue-600 hover:underline font-medium">
                      {p.name}
                    </Link>
                  </td>
                  <td className="p-2">
                    <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide border ${typeCls}`}>
                      {p.type.replace(/_/g, " ")}
                    </span>
                  </td>
                  <td className="p-2">
                    {p.country}
                    {p.city && <span className="text-muted-foreground"> · {p.city}</span>}
                  </td>
                  <td className="p-2 text-muted-foreground">{p.contactPerson ?? "—"}</td>
                  <td className="p-2">{p._count.partnerContacts}</td>
                  <td className="p-2">{p._count.leads}</td>
                  <td className="p-2">
                    {p.agentProfile?.tier ? (
                      <span className={`inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold border ${tierCls}`}>
                        {p.agentProfile.tier}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="p-2">{p.agentProfile?.enrolments ?? "—"}</td>
                </tr>
              );
            })}
            {partners.length === 0 && (
              <tr>
                <td colSpan={8} className="p-6 text-center text-muted-foreground">
                  No partners match the current filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
