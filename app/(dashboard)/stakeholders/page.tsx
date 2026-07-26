import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StakeholdersClient } from "./_components/stakeholders-client";

async function getStakeholderStats() {
  const [schools, counsellors, agents] = await Promise.all([
    db.school.count({ where: { deletedAt: null } }),
    db.counsellor.count({ where: { isActive: true } }),
    db.agentProfile.count(),
  ]);
  return { schools, counsellors, agents };
}

async function getSchools() {
  return db.school.findMany({
    where: { deletedAt: null },
    include: {
      market: { select: { id: true, name: true } },
      _count: { select: { counsellors: true, activities: true } },
    },
    orderBy: { name: "asc" },
    take: 50,
  });
}

async function getAgents() {
  return db.source.findMany({
    where: { type: "AGENT", deletedAt: null },
    include: {
      agentProfile: true,
      _count: { select: { leads: true } },
    },
    orderBy: { name: "asc" },
    take: 50,
  });
}

async function getAgentProfiles() {
  const profiles = await db.agentProfile.findMany({
    include: {
      source: {
        select: { id: true, name: true, country: true },
      },
    },
    orderBy: { createdAt: "desc" },
  });

  // Attach lead counts
  const profilesWithLeads = await Promise.all(
    profiles.map(async (p) => {
      const leadCount = await db.lead.count({
        where: { sourceId: p.sourceId, deletedAt: null },
      });
      return { ...p, leadCount };
    })
  );

  return profilesWithLeads;
}

export default async function StakeholdersPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await effectiveHasPermission(session.user.role, "stakeholders", "read"))) redirect("/dashboard");

  const [stats, schools, agents, agentProfiles] = await Promise.all([
    getStakeholderStats(),
    getSchools(),
    getAgents(),
    getAgentProfiles(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Stakeholders"
        description="Manage schools, counsellors, and agent relationships"
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Stakeholders" }]}
      />
      <StakeholdersClient
        stats={stats}
        schools={schools}
        agents={agents}
        agentProfiles={agentProfiles}
      />
    </div>
  );
}
