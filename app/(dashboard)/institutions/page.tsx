import * as React from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { InstitutionForm } from "./_components/institution-form";
import { InstitutionsClient } from "./_components/institutions-client";
import { ExportButton } from "@/components/shared/export-button";
import { HEALTH_LABELS, HEALTH_ORDER } from "@/lib/account-health";

const INSTITUTION_EXPORT_COLUMNS = [
  { key: "name",           header: "Institution Name" },
  { key: "country",        header: "Country" },
  { key: "type",           header: "Type" },
  { key: "status",         header: "Status" },
  { key: "region",         header: "Primary Region" },
  // The export existed before the client list was imported and so carried none
  // of what that list is actually used for. Someone exporting this now gets the
  // same columns they keep in the spreadsheet, which is the point of an export.
  { key: "allRegions",     header: "Regions Represented" },
  { key: "health",         header: "Client HPI" },
  { key: "owner",          header: "Client Relations" },
  { key: "renewalDate",    header: "Contract Expiry" },
  { key: "website",        header: "Website" },
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
  // How the book of business is feeling, counted once on the server. Grouped
  // rather than five separate counts so the numbers cannot disagree with each
  // other, and defaulted to 0 because groupBy omits ratings nobody holds.
  const byHealth = await db.institution.groupBy({
    by: ["accountHealth"],
    where: { deletedAt: null },
    _count: true,
  });
  const health = Object.fromEntries(
    HEALTH_ORDER.map((h) => [h, byHealth.find((r) => r.accountHealth === h)?._count ?? 0])
  ) as Record<(typeof HEALTH_ORDER)[number], number>;

  return { total, active, renewalDue: renewalDueByContract, prospects, openIssues, health };
}

async function getInstitutions() {
  return db.institution.findMany({
    where: { deletedAt: null },
    include: {
      region: { select: { id: true, name: true } },
      accountManager: { select: { id: true, name: true } },
      // Every region the client is worked in, not just the primary. This join
      // table has been populated since the client list import but nothing read
      // it, so a client worked in six regions was indistinguishable from one
      // worked in a single region.
      regions: { select: { region: { select: { id: true, name: true } } } },
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
          // Spec §12 — open issues belong on the card. The page previously
          // showed a single organisation-wide issue total at the top, which
          // tells an account manager nothing about WHICH client is in trouble.
          // Resolved and closed are excluded: they need no attention.
          issues: {
            where: {
              status: { in: ["OPEN", "IN_PROGRESS", "AWAITING_CLIENT", "AWAITING_INTERNAL_ACTION"] },
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
                allRegions:     i.regions.map((r) => r.region.name).sort().join(", "),
                // Exported in the client list's wording rather than the CRM's
                // colour, so the file can be compared against the spreadsheet
                // it came from without translating every row by hand.
                health:         HEALTH_LABELS[i.accountHealth].sentiment,
                owner:          i.accountManager?.name ?? "",
                renewalDate:    i.renewalDate ? i.renewalDate.toISOString().slice(0, 10) : "",
                website:        i.website ?? "",
                leadsCount:     i._count.leads,
                contractsCount: i._count.contracts,
                usersCount:     i._count.users,
                openIssues:     i._count.issues,
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
          // Spec §12 — surfaced on the list so a client needing attention is
          // visible without opening it.
          openIssuesCount: i._count.issues,
          accountHealth: i.accountHealth,
          renewalDate: i.renewalDate ? i.renewalDate.toISOString() : null,
          regionId: i.region?.id ?? null,
          regionName: i.region?.name ?? null,
          // Primary first, then the rest alphabetically, so the card's
          // truncation to three keeps the one that drives the geo filter.
          regionIds: [
            ...(i.region ? [i.region.id] : []),
            ...i.regions.map((r) => r.region.id).filter((id) => id !== i.region?.id),
          ],
          regionNames: [
            ...(i.region ? [i.region.name] : []),
            ...i.regions
              .map((r) => r.region.name)
              .filter((n) => n !== i.region?.name)
              .sort(),
          ],
          website: i.website,
          accountManagerId: i.accountManagerId ?? null,
          accountManagerName: i.accountManager?.name ?? null,
        }))}
        regions={regions}
        accountManagers={accountManagers}
      />
    </div>
  );
}
