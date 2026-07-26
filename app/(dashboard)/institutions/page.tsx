import * as React from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { InstitutionForm } from "./_components/institution-form";
import { InstitutionsClient } from "./_components/institutions-client";
import { ExportButton } from "@/components/shared/export-button";

const INSTITUTION_EXPORT_COLUMNS = [
  { key: "name",           header: "Institution Name" },
  { key: "country",        header: "Country" },
  { key: "type",           header: "Type" },
  { key: "status",         header: "Status" },
  { key: "region",         header: "Region" },
  { key: "leadsCount",     header: "Leads" },
  { key: "contractsCount", header: "Contracts" },
  { key: "usersCount",     header: "Users" },
];

async function getInstitutionStats() {
  const [total, active, renewalDue, prospects, churned] = await Promise.all([
    db.institution.count({ where: { deletedAt: null } }),
    db.institution.count({ where: { deletedAt: null, accountStatus: "ACTIVE" } }),
    db.institution.count({ where: { deletedAt: null, accountStatus: "RENEWAL_DUE" } }),
    db.institution.count({ where: { deletedAt: null, accountStatus: "PROSPECT" } }),
    db.institution.count({ where: { deletedAt: null, accountStatus: "CHURNED" } }),
  ]);
  return { total, active, renewalDue, prospects, churned };
}

async function getInstitutions() {
  return db.institution.findMany({
    where: { deletedAt: null },
    include: {
      region: { select: { id: true, name: true } },
      _count: {
        select: {
          leads: true,
          contracts: true,
          users: true,
        },
      },
    },
    orderBy: { name: "asc" },
  });
}

async function getRegions() {
  return db.region.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
}

export default async function InstitutionsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await effectiveHasPermission(session.user.role, "institutions", "read"))) redirect("/dashboard");

  const [stats, institutions, regions] = await Promise.all([
    getInstitutionStats(),
    getInstitutions(),
    getRegions(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="Manage partner universities, colleges and institution accounts"
        breadcrumbs={[{ label: "Dashboard", href: "/dashboard" }, { label: "Clients" }]}
        actions={
          <div className="flex items-center gap-2">
            <ExportButton
              data={institutions.map((i) => ({
                name:           i.name,
                country:        i.country,
                type:           i.type.replace(/_/g, " "),
                status:         i.accountStatus.replace(/_/g, " "),
                region:         i.region?.name ?? "",
                leadsCount:     i._count.leads,
                contractsCount: i._count.contracts,
                usersCount:     i._count.users,
              }))}
              columns={INSTITUTION_EXPORT_COLUMNS}
              filename="institutions"
              title="Institutions"
            />
            <InstitutionForm regions={regions} />
          </div>
        }
      />

      {/* Stat Cards + Institution Grid with filters */}
      <InstitutionsClient
        stats={stats}
        institutions={institutions.map((i) => ({
          id: i.id,
          name: i.name,
          country: i.country,
          type: i.type,
          logoUrl: i.logoUrl,
          accountStatus: i.accountStatus,
          leadsCount: i._count.leads,
          contractsCount: i._count.contracts,
          usersCount: i._count.users,
          regionId: i.region?.id ?? null,
          regionName: i.region?.name ?? null,
        }))}
        regions={regions}
      />
    </div>
  );
}
