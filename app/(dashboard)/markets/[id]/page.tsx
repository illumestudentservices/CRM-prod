import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Badge } from "@/components/ui/badge";
import { MarketDetailClient } from "./_components/market-detail-client";
import type { Role } from "@/lib/permissions";

const RISK_BADGE: Record<string, string> = {
  LOW: "bg-blue-100 text-blue-700 border-blue-200",
  MEDIUM_RISK: "bg-amber-100 text-amber-700 border-amber-200",
  HIGH_RISK: "bg-red-100 text-red-700 border-red-200",
  CRITICAL: "bg-red-200 text-red-800 border-red-300",
};

const RISK_LABEL: Record<string, string> = {
  LOW: "Low",
  MEDIUM_RISK: "Medium Risk",
  HIGH_RISK: "High Risk",
  CRITICAL: "Critical",
};

async function getMarket(id: string) {
  const market = await db.market.findUnique({
    where: { id },
    include: {
      schools: {
        where: { deletedAt: null },
        include: {
          _count: { select: { counsellors: true } },
        },
        orderBy: { name: "asc" },
      },
      activities: {
        where: { deletedAt: null },
        include: {
          user: { select: { id: true, name: true } },
        },
        orderBy: { date: "desc" },
      },
      riskRegisters: {
        include: {
          owner: { select: { id: true, name: true } },
        },
        orderBy: { riskScore: "desc" },
      },
      _count: {
        select: { schools: true, activities: true, riskRegisters: true },
      },
    },
  });
  if (market?.deletedAt) return null;
  return market;
}

export default async function MarketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (
    !(await effectiveHasPermission(
      session.user.role as Role,
      "markets",
      "read"
    ))
  )
    redirect("/dashboard");

  const { id } = await params;
  const market = await getMarket(id);

  if (!market) notFound();

  const canWrite = await effectiveHasPermission(
    session.user.role as Role,
    "markets",
    "write"
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title={market.name}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Markets", href: "/markets" },
          { label: market.name },
        ]}
      />

      {/* Profile summary */}
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-sm text-slate-500 font-mono">{market.code}</span>
        {market.countryCode && (
          <span className="text-sm text-slate-500">{market.countryCode}</span>
        )}
        <Badge
          variant="outline"
          className={
            RISK_BADGE[market.politicalRiskLevel] ??
            "bg-slate-100 text-slate-600"
          }
        >
          {RISK_LABEL[market.politicalRiskLevel] ?? market.politicalRiskLevel}
        </Badge>
        {market.healthScore != null && (
          <span className="text-sm text-slate-600">
            Health: <span className="font-semibold">{market.healthScore}</span>
            /100
          </span>
        )}
        {!market.isActive && (
          <Badge
            variant="outline"
            className="bg-red-50 text-red-600 border-red-200"
          >
            Inactive
          </Badge>
        )}
      </div>

      {/* Tabs client component */}
      <MarketDetailClient
        market={{
          id: market.id,
          name: market.name,
          code: market.code,
          countryCode: market.countryCode,
          politicalRiskLevel: market.politicalRiskLevel,
          healthScore: market.healthScore,
          isActive: market.isActive,
          studentMobilityNotes: market.studentMobilityNotes,
          competitorInstitutions: market.competitorInstitutions,
          visaTrends: market.visaTrends,
          currencyTrends: market.currencyTrends,
          recruitmentOpportunities: market.recruitmentOpportunities,
          govtStakeholders: market.govtStakeholders,
          industryAssociations: market.industryAssociations,
          schools: market.schools.map((s) => ({
            id: s.id,
            name: s.name,
            country: s.country,
            city: s.city,
            type: s.type,
            relationshipStatus: s.relationshipStatus,
            studentVolume: s.studentVolume,
            lastVisitDate: s.lastVisitDate
              ? s.lastVisitDate.toISOString()
              : null,
            _count: s._count,
          })),
          activities: market.activities.map((a) => ({
            id: a.id,
            type: a.type,
            title: a.title,
            date: a.date.toISOString(),
            location: a.location,
            studentsEngaged: a.studentsEngaged,
            leadsGenerated: a.leadsGenerated,
            user: a.user,
          })),
          riskRegisters: market.riskRegisters.map((r) => ({
            id: r.id,
            type: r.type,
            title: r.title,
            description: r.description,
            likelihood: r.likelihood,
            impact: r.impact,
            riskScore: r.riskScore,
            status: r.status,
            mitigationPlan: r.mitigationPlan,
            owner: r.owner,
          })),
          _count: market._count,
        }}
        canWrite={canWrite}
      />
    </div>
  );
}
