import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { MarketsClient } from "./_components/markets-client";
import type { Role } from "@/lib/permissions";

async function getMarkets() {
  return db.market.findMany({
    where: { deletedAt: null },
    include: {
      _count: { select: { schools: true, activities: true, riskRegisters: true } },
    },
    orderBy: { name: "asc" },
  });
}

export default async function MarketsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await effectiveHasPermission(session.user.role as Role, "markets", "read"))) redirect("/dashboard");

  const markets = await getMarkets();
  const canWrite = await effectiveHasPermission(session.user.role as Role, "markets", "write");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Markets"
        description="Manage market intelligence, health scores, and regional recruitment data"
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Markets" }]}
      />
      <MarketsClient markets={markets} canWrite={canWrite} />
    </div>
  );
}
