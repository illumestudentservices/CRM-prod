import { db } from "@/lib/db";
import Link from "next/link";

export const dynamic = "force-dynamic";

export default async function MarketIntelligencePage() {
  const markets = await db.market.findMany({
    where: { deletedAt: null, isActive: true },
    orderBy: [{ priority: "asc" }, { name: "asc" }],
    include: {
      regionalManager: { select: { id: true, name: true } },
      _count: { select: { schools: true, activities: true, updateSuggestions: { where: { status: "PENDING" } } } },
    },
  });

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-1">Market Intelligence</h1>
      <p className="text-sm text-muted-foreground mb-4">
        Priority + potential + risk-level classification per country. RM-edited narrative, CRM-generated numbers.
      </p>

      <table className="w-full text-sm border">
        <thead className="bg-muted">
          <tr>
            <th className="text-left p-2">Market</th>
            <th className="text-left p-2">Country</th>
            <th className="text-left p-2">Priority</th>
            <th className="text-left p-2">Potential</th>
            <th className="text-left p-2">Risk</th>
            <th className="text-left p-2">RM</th>
            <th className="text-left p-2">Schools</th>
            <th className="text-left p-2">Field Ops</th>
            <th className="text-left p-2">Pending updates</th>
          </tr>
        </thead>
        <tbody>
          {markets.map((m) => (
            <tr key={m.id} className="border-t hover:bg-muted/50">
              <td className="p-2">
                <Link href={`/market-intelligence/${m.id}`} className="text-blue-600 hover:underline">{m.name}</Link>
              </td>
              <td className="p-2">{m.countryCode}</td>
              <td className="p-2">
                <span className={
                  m.priority === "HIGH" ? "text-xs px-2 py-0.5 bg-red-100 text-red-800 rounded" :
                  m.priority === "MEDIUM" ? "text-xs px-2 py-0.5 bg-yellow-100 text-yellow-800 rounded" :
                  "text-xs px-2 py-0.5 bg-gray-100 dark:bg-slate-800 text-gray-800 dark:text-slate-200 rounded"
                }>{m.priority ?? "—"}</span>
              </td>
              <td className="p-2">{m.potential ?? "—"}</td>
              <td className="p-2">{m.politicalRiskLevel}</td>
              <td className="p-2">{m.regionalManager?.name ?? "—"}</td>
              <td className="p-2">{m._count.schools}</td>
              <td className="p-2">{m._count.activities}</td>
              <td className="p-2">
                {m._count.updateSuggestions > 0 && <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded">{m._count.updateSuggestions}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
