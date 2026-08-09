import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/// Spec §6 (retire Stakeholders) — Network Performance dashboard auto-generated
/// from InstitutionInterest / LeadApplication data.
export default async function NetworkPerformancePage() {
  // Rolling 12 months
  const from = new Date();
  from.setFullYear(from.getFullYear() - 1);

  const agents = await db.agentProfile.findMany({
    include: { source: { select: { id: true, name: true, country: true } } },
    orderBy: [{ tier: "asc" }, { enrolments: "desc" }],
    take: 50,
  });

  const schoolStats = await db.school.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { lastVisitDate: "desc" },
    include: { _count: { select: { counsellors: true, activities: true } } },
    take: 50,
  });

  const eventRanking = await db.event.findMany({
    where: { deletedAt: null, date: { gte: from } },
    orderBy: { date: "desc" },
    include: { _count: { select: { leads: true, participations: true, expenses: true } } },
    take: 25,
  });

  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-lg font-semibold mb-2">Agent Rankings (rolling 12 months)</h2>
        <table className="w-full text-sm border">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">Agent</th>
              <th className="text-left p-2">Country</th>
              <th className="text-left p-2">Tier</th>
              <th className="text-left p-2">Enrolments</th>
              <th className="text-left p-2">Deposits</th>
              <th className="text-left p-2">Offers</th>
              <th className="text-left p-2">Yield</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={a.id} className="border-t">
                <td className="p-2">{a.source.name}</td>
                <td className="p-2">{a.source.country}</td>
                <td className="p-2">{a.tier}</td>
                <td className="p-2">{a.enrolments}</td>
                <td className="p-2">{a.deposits}</td>
                <td className="p-2">{a.offers}</td>
                <td className="p-2">{a.yieldRate?.toFixed(1) ?? "—"}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">School Rankings</h2>
        <table className="w-full text-sm border">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">School</th>
              <th className="text-left p-2">Country</th>
              <th className="text-left p-2">Type</th>
              <th className="text-left p-2">Relationship</th>
              <th className="text-left p-2">Counsellors</th>
              <th className="text-left p-2">Field Ops</th>
              <th className="text-left p-2">Last Visit</th>
            </tr>
          </thead>
          <tbody>
            {schoolStats.map((s) => (
              <tr key={s.id} className="border-t">
                <td className="p-2">{s.name}</td>
                <td className="p-2">{s.country}</td>
                <td className="p-2">{s.type}</td>
                <td className="p-2">{s.relationshipStatus}</td>
                <td className="p-2">{s._count.counsellors}</td>
                <td className="p-2">{s._count.activities}</td>
                <td className="p-2">{s.lastVisitDate?.toISOString().slice(0, 10) ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

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
          </tbody>
        </table>
      </section>
    </div>
  );
}
