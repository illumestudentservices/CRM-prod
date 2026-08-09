import { db } from "@/lib/db";
import { notFound } from "next/navigation";
import { MarketDetailClient } from "./_components/market-detail-client";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function MarketDetail({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  const { id } = await params;

  const market = await db.market.findFirst({
    where: { id, deletedAt: null },
    include: {
      regionalManager: { select: { id: true, name: true } },
      schools: { where: { deletedAt: null, isActive: true }, take: 20 },
      updateSuggestions: {
        orderBy: { submittedAt: "desc" },
        take: 20,
        include: {
          submittedBy: { select: { id: true, name: true } },
          reviewedBy: { select: { id: true, name: true } },
        },
      },
      _count: { select: { activities: true, riskRegisters: true } },
    },
  });
  if (!market) notFound();

  return (
    <MarketDetailClient
      market={JSON.parse(JSON.stringify(market))}
      currentUserRole={session.user.role}
    />
  );
}
