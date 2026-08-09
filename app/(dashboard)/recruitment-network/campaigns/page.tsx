import { db } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  const campaigns = await db.campaign.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: { startDate: "desc" },
    include: { source: { select: { id: true, name: true, type: true } } },
    take: 100,
  });

  return (
    <div>
      <p className="text-sm text-muted-foreground mb-3">{campaigns.length} active marketing campaigns</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm border">
          <thead className="bg-muted">
            <tr>
              <th className="text-left p-2">Campaign</th>
              <th className="text-left p-2">Channel</th>
              <th className="text-left p-2">Start</th>
              <th className="text-left p-2">End</th>
              <th className="text-left p-2">Budget</th>
              <th className="text-left p-2">Leads</th>
              <th className="text-left p-2">Attributed to</th>
            </tr>
          </thead>
          <tbody>
            {campaigns.map((c) => (
              <tr key={c.id} className="border-t hover:bg-muted/50">
                <td className="p-2">{c.name}</td>
                <td className="p-2">{c.channel}</td>
                <td className="p-2">{c.startDate.toISOString().slice(0, 10)}</td>
                <td className="p-2">{c.endDate?.toISOString().slice(0, 10) ?? "—"}</td>
                <td className="p-2">{c.budget ? `$${c.budget.toLocaleString()}` : "—"}</td>
                <td className="p-2">{c.leadsGenerated}</td>
                <td className="p-2">{c.source ? <Link href={`/recruitment-network/partners/${c.source.id}`} className="text-blue-600 hover:underline">{c.source.name}</Link> : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
