import * as React from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StudentsClientPage } from "./_components/students-client";
import type { LeadWithRelations } from "./_components/lead-card";

// ─── Data fetching ─────────────────────────────────────────────────────────────

async function getLeadsData(userId: string, role: string, regionId: string | null | undefined) {
  const MANAGER_ROLES = ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER"];
  const isManager = MANAGER_ROLES.includes(role);

  const whereClause = {
    deletedAt: null,
    ...(role === "REGIONAL_MANAGER" && regionId ? { regionId } : {}),
    ...(role === "ICR" ? { assignedICRId: userId } : {}),
  };

  const [leads, sources, institutions, icrUsers] = await Promise.all([
    db.lead.findMany({
      where: whereClause,
      include: {
        assignedICR: { select: { id: true, name: true, image: true } },
        institution: { select: { id: true, name: true } },
        source: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
    }),
    db.recruitmentPartner.findMany({
      where: { deletedAt: null, isActive: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.institution.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    isManager
      ? db.user.findMany({
          where: { isActive: true, role: "ICR" },
          select: { id: true, name: true, image: true },
          orderBy: { name: "asc" },
        })
      : Promise.resolve([]),
  ]);

  return { leads: leads as LeadWithRelations[], sources, institutions, icrUsers, isManager };
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function StudentsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await effectiveHasPermission(session.user.role, "leads", "read"))) redirect("/dashboard");

  const { id: userId, role, regionId } = session.user;

  const { leads, sources, institutions, icrUsers, isManager } = await getLeadsData(
    userId,
    role,
    regionId
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Student Pipeline"
        description="Track and manage student leads through the recruitment funnel."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Students" }]}
      />
      <StudentsClientPage
        initialLeads={leads}
        sources={sources}
        institutions={institutions}
        icrUsers={icrUsers}
        isManager={isManager}
      />
    </div>
  );
}
