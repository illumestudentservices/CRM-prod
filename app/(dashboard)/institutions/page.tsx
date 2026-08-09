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
  const now = new Date();
  // Spec §1 (Clients) — "Renewal Due" is a computed alert from contract dates,
  // NOT a stored client status. Institutions with an ACTIVE contract expiring
  // within 90 days count as renewal-due for the summary card.
  const renewalWindowMs = 90 * 24 * 60 * 60 * 1000;
  const [total, active, renewalDueByContract, prospects, openIssues] = await Promise.all([
    db.institution.count({ where: { deletedAt: null } }),
    db.institution.count({ where: { deletedAt: null, accountStatus: "ACTIVE" } }),
    db.institution.count({
      where: {
        deletedAt: null,
        contracts: {
          some: {
            OR: [
              { statusEnum: "ACTIVE" },
              { statusEnum: null, status: "ACTIVE" },
            ],
            endDate: {
              gte: now,
              lte: new Date(now.getTime() + renewalWindowMs),
            },
          },
        },
      },
    }),
    db.institution.count({ where: { deletedAt: null, accountStatus: "PROSPECT" } }),
    // Spec §9 — Open Issues stat card.
    db.clientIssue.count({
      where: { status: { notIn: ["RESOLVED", "CLOSED"] } },
    }),
  ]);
  return { total, active, renewalDue: renewalDueByContract, prospects, openIssues };
}

async function getInstitutions() {
  return db.institution.findMany({
    where: { deletedAt: null },
    include: {
      region: { select: { id: true, name: true } },
      accountManager: { select: { id: true, name: true } },
      _count: {
        select: {
          // Spec §1 (Clients) — the card's "students" pill should count
          // ACTIVE students on the pipeline, not every lead ever captured.
          // A LOST / DEFERRED / APPLICATION_REJECTED / ENROLLED lead is not
          // active recruitment.
          leads: {
            where: {
              deletedAt: null,
              stage: {
                notIn: [
                  "LOST",
                  "DEFERRED",
                  "APPLICATION_REJECTED",
                  "WITHDRAWN",
                  "VISA_REFUSED",
                  "ENROLLED",
                ],
              },
            },
          },
          // Only ACTIVE contracts count for the header pill; expired/superseded
          // rows stay in the model but shouldn't inflate the summary.
          contracts: {
            where: {
              OR: [
                { statusEnum: "ACTIVE" },
                { statusEnum: null, status: "ACTIVE" },
              ],
            },
          },
          // Only ICR-role users count for the "ICRs" label on the card. Other
          // roles (Regional Manager, Account Manager) are counted separately
          // when needed.
          users: {
            where: {
              assignmentStatus: "ACTIVE",
              user: { role: "ICR" },
            },
          },
        },
      },
    },
    orderBy: { name: "asc" },
  });
}

async function getRegions() {
  return db.region.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
}

async function getAccountManagers() {
  // Spec §1 (Clients) — dashboard filter by Account Manager.
  return db.user.findMany({
    where: {
      isActive: true,
      deletedAt: null,
      // Cover the current AM signal (User referenced by institutions.accountManagerId)
      // plus the new ACCOUNT_MANAGER role added in migration 019.
      OR: [
        { role: "ACCOUNT_MANAGER" },
        { managedInstitutions: { some: {} } },
      ],
    },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
}

export default async function InstitutionsPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");
  if (!(await effectiveHasPermission(session.user.role, "institutions", "read"))) redirect("/dashboard");

  const [stats, institutions, regions, accountManagers] = await Promise.all([
    getInstitutionStats(),
    getInstitutions(),
    getRegions(),
    getAccountManagers(),
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
          accountManagerId: i.accountManagerId ?? null,
          accountManagerName: i.accountManager?.name ?? null,
        }))}
        regions={regions}
        accountManagers={accountManagers}
      />
    </div>
  );
}
