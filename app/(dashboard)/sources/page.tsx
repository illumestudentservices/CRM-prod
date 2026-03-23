import * as React from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { SourceForm } from "./_components/source-form";
import { SourcesTabsClient } from "./_components/sources-tabs-client";

async function getSourceStats() {
  const [total, agents, schools, campaigns] = await Promise.all([
    db.source.count({ where: { deletedAt: null } }),
    db.source.count({ where: { deletedAt: null, type: "AGENT", isActive: true } }),
    db.source.count({ where: { deletedAt: null, type: "SCHOOL", isActive: true } }),
    db.campaign.count({ where: { deletedAt: null } }),
  ]);
  return { total, agents, schools, campaigns };
}

async function getSources() {
  return db.source.findMany({
    where: { deletedAt: null },
    include: {
      region: { select: { id: true, name: true } },
      _count: { select: { leads: true } },
      leads: {
        where: { deletedAt: null },
        select: { stage: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function getCampaigns() {
  return db.campaign.findMany({
    where: { deletedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

async function getRegions() {
  return db.region.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
}

export default async function SourcesPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const [stats, sources, campaigns, regions] = await Promise.all([
    getSourceStats(),
    getSources(),
    getCampaigns(),
    getRegions(),
  ]);

  const sourcesWithConversion = sources.map((s) => {
    const totalLeads = s._count.leads;
    const enrolledLeads = s.leads.filter((l) => l.stage === "ENROLLED").length;
    const conversionRate = totalLeads > 0 ? (enrolledLeads / totalLeads) * 100 : 0;
    return { ...s, totalLeads, enrolledLeads, conversionRate };
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Sources"
        description="Manage lead sources, agents, schools, campaigns and partners"
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Sources" }]}
        actions={<SourceForm regions={regions} />}
      />

      <SourcesTabsClient sources={sourcesWithConversion} campaigns={campaigns} regions={regions} stats={stats} />
    </div>
  );
}
