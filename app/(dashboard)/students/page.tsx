import * as React from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { db } from "@/lib/db";
import { regionScope } from "@/lib/region-scope";
import { PageHeader } from "@/components/shared/page-header";
import { NoRegionBanner } from "@/components/shared/no-region-banner";
import type { Role } from "@/lib/permissions";
import { StudentsClientPage } from "./_components/students-client";
import { MergeLeadsButton } from "./_components/merge-leads-button";
import type { LeadWithRelations } from "./_components/lead-card";

// ─── Data fetching ─────────────────────────────────────────────────────────────

async function getLeadsData(userId: string, role: string, regionId: string | null | undefined) {
  const MANAGER_ROLES = ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER"];
  const isManager = MANAGER_ROLES.includes(role);

  const whereClause = {
    deletedAt: null,
    // `&& regionId` used to drop the filter entirely when the manager had no
    // region, so the page rendered every student in the organisation. See
    // lib/region-scope.ts.
    ...(role === "REGIONAL_MANAGER" ? regionScope(regionId) : {}),
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
      <NoRegionBanner role={role as Role} regionId={regionId} />
      <PageHeader
        title="Student Pipeline"
        description="Track and manage student leads through the recruitment funnel."
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Students" }]}
        actions={
          role === "SUPER_ADMIN" ? (
            <MergeLeadsButton
              leads={leads.map((l) => ({
                id: l.id,
                firstName: l.firstName,
                lastName: l.lastName,
                email: l.email,
                stage: l.stage,
              }))}
            />
          ) : undefined
        }
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
