import { db } from "@/lib/db";
import { MarketsTable } from "./_components/markets-table";

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

      {/*
        The table moved into a client component so it can hold search and
        filter state. It had none: every market Illume recruits from, in one
        unsearchable list, on a server-rendered page that could not hold a
        text box.
      */}
      <MarketsTable
        markets={markets.map((m) => ({
          id: m.id,
          name: m.name,
          countryCode: m.countryCode,
          priority: m.priority ?? null,
          potential: m.potential ?? null,
          politicalRiskLevel: m.politicalRiskLevel,
          regionalManager: m.regionalManager,
          schools: m._count.schools,
          activities: m._count.activities,
          pendingUpdates: m._count.updateSuggestions,
        }))}
      />
    </div>
  );
}
