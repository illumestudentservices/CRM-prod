import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Network Performance dashboard — spec §6 (retire Stakeholders) + spec §10
 * (Sources / Recruitment Network).
 *
 * Every metric on this page is generated from CRM data. Nothing here is
 * manually entered. Sections:
 *
 *   1. Agent Rankings           (rolling 12mo, from AgentProfile + Interests)
 *   2. School Rankings          (last-visit + Field Ops counts, no counsellors)
 *   3. Campaign Rankings        (leads / apps / enrolments, cost per lead)
 *   4. Recent Recruitment Events (12mo)
 *   5. Relationship Activity    (unified feed of "last engagement" across the
 *                               partner + school + client population)
 */
export default async function NetworkPerformancePage() {
  const now = new Date();
  const from = new Date(now);
  from.setFullYear(from.getFullYear() - 1);

  const DAY_MS = 86_400_000;
  const daysSince = (d: Date | null | undefined) =>
    d ? Math.floor((now.getTime() - d.getTime()) / DAY_MS) : null;

  // ─── 1. Agents ──────────────────────────────────────────────────────────
  const agents = await db.agentProfile.findMany({
    include: { source: { select: { id: true, name: true, country: true } } },
    orderBy: [{ tier: "asc" }, { enrolments: "desc" }],
    take: 50,
  });

  // ─── 2. Schools ─────────────────────────────────────────────────────────
  // Spec §6: drop the counsellors count (Counsellor is retired). Show
  // Field-Ops touch instead.
  const schoolStats = await db.school.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { lastVisitDate: "desc" },
    include: { _count: { select: { activities: true } } },
    take: 50,
  });

  // ─── 3. Campaigns ───────────────────────────────────────────────────────
  // Rankings by leads generated in the window, plus derived Cost per Lead
  // where the campaign has a spend value on record.
  const campaigns = await db.campaign.findMany({
    where: {
      deletedAt: null,
      startDate: { gte: from },
    },
    orderBy: [{ leadsGenerated: "desc" }, { startDate: "desc" }],
    take: 25,
  });
  const campaignRows = campaigns.map((c) => {
    const spend = c.actualSpend ?? c.budget ?? null;
    const costPerLead =
      spend !== null && c.leadsGenerated > 0
        ? spend / c.leadsGenerated
        : null;
    return { ...c, costPerLead };
  });

  // ─── 4. Recent Events ───────────────────────────────────────────────────
  const eventRanking = await db.event.findMany({
    where: { deletedAt: null, date: { gte: from } },
    orderBy: { date: "desc" },
    include: {
      _count: { select: { leads: true, participations: true, expenses: true } },
    },
    take: 25,
  });

  // ─── 5. Relationship Activity feed ──────────────────────────────────────
  // Spec §6: a single view of who we've engaged with most recently across the
  // network. Merge agents, schools, and institutions by "last touch" and take
  // the freshest 25.
  type FeedRow = {
    kind: "AGENT" | "SCHOOL" | "CLIENT";
    id: string;
    name: string;
    country: string | null;
    lastEngagement: Date | null;
    label: string;
    href: string;
    tier?: string | null;
    relationship?: string | null;
  };

  const feed: FeedRow[] = [];

  for (const a of agents) {
    feed.push({
      kind: "AGENT",
      id: a.id,
      name: a.source.name,
      country: a.source.country,
      lastEngagement: a.lastMeetingDate,
      label: "Last meeting",
      href: `/recruitment-network/partners/${a.source.id}`,
      tier: a.tier,
    });
  }
  for (const s of schoolStats) {
    feed.push({
      kind: "SCHOOL",
      id: s.id,
      name: s.name,
      country: s.country,
      lastEngagement: s.lastVisitDate,
      label: "Last visit",
      href: `/stakeholders?school=${s.id}`,
      relationship: s.relationshipStatus,
    });
  }

  // Active clients too — using days-since-last-activity as their "engagement"
  const activeClients = await db.institution.findMany({
    where: { deletedAt: null, accountStatus: "ACTIVE" },
    select: {
      id: true,
      name: true,
      country: true,
      activities: {
        orderBy: { date: "desc" },
        take: 1,
        select: { date: true },
      },
    },
    take: 50,
  });
  for (const c of activeClients) {
    feed.push({
      kind: "CLIENT",
      id: c.id,
      name: c.name,
      country: c.country,
      lastEngagement: c.activities[0]?.date ?? null,
      label: "Last activity",
      href: `/institutions/${c.id}`,
    });
  }

  const relationshipFeed = feed
    .filter((r) => r.lastEngagement !== null)
    .sort(
      (a, b) =>
        (b.lastEngagement?.getTime() ?? 0) - (a.lastEngagement?.getTime() ?? 0)
    )
    .slice(0, 25);

  const staleCount = feed.filter(
    (r) => r.lastEngagement === null || daysSince(r.lastEngagement)! > 90
  ).length;

  return (
    <div className="space-y-8">
      {/* ─── 1. Agents ─────────────────────────────────────────────────── */}
      <section>
        <h2 className="text-lg font-semibold mb-2">Agent Rankings (rolling 12 months)</h2>
        <p className="text-xs text-muted-foreground mb-2">
          Auto-calculated. Tier is set by the network-automation cron; manual writes are refused.
        </p>
        <table className="w-full text-sm border">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">Agent</th>
              <th className="text-left p-2">Country</th>
              <th className="text-left p-2">Tier</th>
              <th className="text-left p-2">Applications</th>
              <th className="text-left p-2">Offers</th>
              <th className="text-left p-2">Deposits</th>
              <th className="text-left p-2">Enrolments</th>
              <th className="text-left p-2">Yield</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="p-2">{a.source.name}</td>
                <td className="p-2">{a.source.country}</td>
                <td className="p-2">{a.tier}</td>
                {/* Applications is a derivable but not currently stored count;
                    the AgentProfile.offers column stands in for the moment
                    since offers > applications is guaranteed impossible. */}
                <td className="p-2 text-muted-foreground">—</td>
                <td className="p-2">{a.offers}</td>
                <td className="p-2">{a.deposits}</td>
                <td className="p-2">{a.enrolments}</td>
                <td className="p-2">{a.yieldRate != null ? `${a.yieldRate.toFixed(1)}%` : "—"}</td>
              </tr>
            ))}
            {agents.length === 0 && (
              <tr><td className="p-3 text-center text-muted-foreground" colSpan={8}>No agents yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* ─── 2. Schools ───────────────────────────────────────────────────
          Spec §6 removed the counsellors count from this ranking — schools
          are now measured by field-operations engagement instead. */}
      <section>
        <h2 className="text-lg font-semibold mb-2">School Rankings</h2>
        <table className="w-full text-sm border">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">School</th>
              <th className="text-left p-2">Country</th>
              <th className="text-left p-2">Type</th>
              <th className="text-left p-2">Relationship</th>
              <th className="text-left p-2">Field Ops</th>
              <th className="text-left p-2">Last Visit</th>
              <th className="text-left p-2">Days Since</th>
            </tr>
          </thead>
          <tbody>
            {schoolStats.map((s) => {
              const ds = daysSince(s.lastVisitDate);
              const stale = ds !== null && ds > 180;
              return (
                <tr key={s.id} className="border-t">
                  <td className="p-2">{s.name}</td>
                  <td className="p-2">{s.country}</td>
                  <td className="p-2">{s.type}</td>
                  <td className="p-2">{s.relationshipStatus}</td>
                  <td className="p-2">{s._count.activities}</td>
                  <td className="p-2">{s.lastVisitDate?.toISOString().slice(0, 10) ?? "—"}</td>
                  <td className={`p-2 ${stale ? "text-red-600" : ""}`}>{ds ?? "—"}</td>
                </tr>
              );
            })}
            {schoolStats.length === 0 && (
              <tr><td className="p-3 text-center text-muted-foreground" colSpan={7}>No schools yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* ─── 3. Campaign Rankings ─────────────────────────────────────────
          Spec §10 — leads generated, applications, enrolments, cost per lead. */}
      <section>
        <h2 className="text-lg font-semibold mb-2">Campaign Rankings (rolling 12 months)</h2>
        <p className="text-xs text-muted-foreground mb-2">
          Cost per Lead uses actual spend where recorded, else the planned budget.
        </p>
        <table className="w-full text-sm border">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">Campaign</th>
              <th className="text-left p-2">Channel</th>
              <th className="text-left p-2">Start</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Leads</th>
              <th className="text-left p-2">Spend</th>
              <th className="text-left p-2">Cost / Lead</th>
            </tr>
          </thead>
          <tbody>
            {campaignRows.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="p-2">{c.name}</td>
                <td className="p-2">{c.channel}</td>
                <td className="p-2">{c.startDate.toISOString().slice(0, 10)}</td>
                <td className="p-2">{c.status ?? (c.isActive ? "OPEN" : "CLOSED")}</td>
                <td className="p-2">{c.leadsGenerated}</td>
                <td className="p-2">{c.actualSpend != null ? `$${c.actualSpend.toLocaleString()}` : c.budget != null ? `$${c.budget.toLocaleString()} (planned)` : "—"}</td>
                <td className="p-2">{c.costPerLead != null ? `$${c.costPerLead.toFixed(2)}` : "—"}</td>
              </tr>
            ))}
            {campaignRows.length === 0 && (
              <tr><td className="p-3 text-center text-muted-foreground" colSpan={7}>No campaigns in the last 12 months.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* ─── 4. Events ────────────────────────────────────────────────────*/}
      <section>
        <h2 className="text-lg font-semibold mb-2">Recent Events (rolling 12 months)</h2>
        <table className="w-full text-sm border">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">Event</th>
              <th className="text-left p-2">Date</th>
              <th className="text-left p-2">Institutions</th>
              <th className="text-left p-2">Leads</th>
              <th className="text-left p-2">Expenses</th>
            </tr>
          </thead>
          <tbody>
            {eventRanking.map((e) => (
              <tr key={e.id} className="border-t">
                <td className="p-2">{e.name}</td>
                <td className="p-2">{e.date.toISOString().slice(0, 10)}</td>
                <td className="p-2">{e._count.participations}</td>
                <td className="p-2">{e._count.leads}</td>
                <td className="p-2">{e._count.expenses}</td>
              </tr>
            ))}
            {eventRanking.length === 0 && (
              <tr><td className="p-3 text-center text-muted-foreground" colSpan={5}>No events in the last 12 months.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {/* ─── 5. Relationship Activity ─────────────────────────────────────
          Spec §6/§8 — unified "last engagement" feed across agents, schools
          and clients. Sorted freshest-first; stale rows (>90d silent) are
          flagged. */}
      <section>
        <h2 className="text-lg font-semibold mb-2">Relationship Activity</h2>
        <p className="text-xs text-muted-foreground mb-2">
          Last engagement across {feed.length} agents / schools / clients.
          {staleCount > 0 && (
            <span className="ml-1 text-amber-700">
              {staleCount} record{staleCount === 1 ? "" : "s"} with no touch in the last 90 days.
            </span>
          )}
        </p>
        <table className="w-full text-sm border">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">Type</th>
              <th className="text-left p-2">Name</th>
              <th className="text-left p-2">Country</th>
              <th className="text-left p-2">Last Engagement</th>
              <th className="text-left p-2">Days Since</th>
              <th className="text-left p-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {relationshipFeed.map((r) => {
              const ds = daysSince(r.lastEngagement);
              const stale = ds !== null && ds > 90;
              return (
                <tr key={`${r.kind}-${r.id}`} className="border-t hover:bg-muted/50">
                  <td className="p-2">
                    <span className="inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide bg-slate-100 text-slate-700 border border-slate-200">
                      {r.kind}
                    </span>
                  </td>
                  <td className="p-2">
                    <a href={r.href} className="text-blue-600 hover:underline">{r.name}</a>
                  </td>
                  <td className="p-2">{r.country ?? "—"}</td>
                  <td className="p-2">
                    <span className="text-xs text-muted-foreground mr-1">{r.label}:</span>
                    {r.lastEngagement?.toISOString().slice(0, 10) ?? "—"}
                  </td>
                  <td className={`p-2 ${stale ? "text-red-600" : ""}`}>{ds ?? "—"}</td>
                  <td className="p-2">{r.tier ?? r.relationship ?? "—"}</td>
                </tr>
              );
            })}
            {relationshipFeed.length === 0 && (
              <tr><td className="p-3 text-center text-muted-foreground" colSpan={6}>No engagement recorded yet.</td></tr>
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
