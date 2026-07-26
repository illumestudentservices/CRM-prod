import * as React from "react";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ExternalLink, MapPin, DollarSign, CalendarClock } from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { cn, formatCurrency, formatDate } from "@/lib/utils";
import { InstitutionForm } from "../_components/institution-form";
import { InstitutionTabsClient } from "./_components/institution-tabs-client";
import { type AccountStatus } from "@prisma/client";

const STATUS_CONFIG: Record<AccountStatus, { label: string; className: string }> = {
  PROSPECT: { label: "Prospect", className: "bg-slate-100 text-slate-600 border-slate-200" },
  ACTIVE: { label: "Active", className: "bg-green-100 text-green-700 border-green-200" },
  RENEWAL_DUE: { label: "Renewal Due", className: "bg-amber-100 text-amber-700 border-amber-200" },
  CHURNED: { label: "Churned", className: "bg-red-100 text-red-700 border-red-200" },
};

async function getInstitution(id: string) {
  const institution = await db.institution.findUnique({
    where: { id },
    include: {
      region: { select: { id: true, name: true } },
      accountManager: { select: { id: true, name: true, email: true, role: true, image: true } },
      contacts: { orderBy: [{ isPrimary: "desc" }, { name: "asc" }] },
      contracts: {
        orderBy: { startDate: "desc" },
        include: {
          attachments: {
            select: { id: true, name: true, mimeType: true, size: true, createdAt: true },
            orderBy: { createdAt: "desc" },
          },
        },
      },
      engagementLogs: {
        include: { user: { select: { id: true, name: true, image: true } } },
        orderBy: { date: "desc" },
      },
      deliverables: { orderBy: { createdAt: "desc" } },
      documents: { orderBy: { uploadedAt: "desc" } },
      leads: {
        where: { deletedAt: null },
        select: { id: true, stage: true, createdAt: true },
      },
      enrollmentTargets: { orderBy: { year: "asc" } },
      users: {
        include: {
          user: { select: { id: true, name: true, email: true, role: true, image: true } },
        },
      },
      activities: {
        orderBy: { date: "desc" },
        take: 10,
        select: { id: true, title: true, type: true, date: true, outcomes: true },
      },
      clientKPIs: {
        orderBy: { createdAt: "desc" },
        take: 20,
      },
      riskRegisters: {
        where: { status: { in: ["OPEN", "ESCALATED"] } },
        orderBy: { riskScore: "desc" },
      },
      complianceItems: {
        where: { completedAt: null },
        orderBy: { dueDate: "asc" },
      },
      _count: {
        select: {
          leads: true,
          contacts: true,
          contracts: true,
          engagementLogs: true,
          activities: true,
        },
      },
    },
  });
  if (institution?.deletedAt) return null;
  return institution;
}

async function getRegions() {
  return db.region.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
}

export default async function InstitutionDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;

  const [institution, regions] = await Promise.all([
    getInstitution(id),
    getRegions(),
  ]);

  if (!institution) notFound();

  const status = STATUS_CONFIG[institution.accountStatus];
  const enrolledCount = institution.leads.filter((l) => l.stage === "ENROLLED").length;
  const deliverablesCompleted = institution.deliverables.filter((d) => d.status === "COMPLETED").length;
  const deliverablesPending = institution.deliverables.filter((d) => d.status !== "COMPLETED").length;

  const assignedUsers = institution.users.map((iu) => ({
    id: iu.user.id,
    name: iu.user.name,
    email: iu.user.email,
    role: iu.user.role,
    image: iu.user.image,
  }));

  const accountManager = institution.accountManager
    ? {
        id: institution.accountManager.id,
        name: institution.accountManager.name,
        email: institution.accountManager.email,
        role: institution.accountManager.role,
        image: institution.accountManager.image,
      }
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={institution.name}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Clients", href: "/institutions" },
          { label: institution.name },
        ]}
        actions={
          <InstitutionForm
            institution={{
              id: institution.id,
              name: institution.name,
              country: institution.country,
              type: institution.type,
              website: institution.website,
              primaryContact: institution.primaryContact,
              accountStatus: institution.accountStatus,
              notes: institution.notes,
              region: institution.region,
            }}
            regions={regions}
            mode="edit"
          />
        }
      />

      {/* Header Info */}
      <div className="flex flex-wrap items-center gap-3">
        <span
          className={cn(
            "inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium border",
            status.className
          )}
        >
          {status.label}
        </span>
        <span className="inline-flex items-center gap-1 text-sm text-slate-500">
          <MapPin className="h-3.5 w-3.5" />
          {institution.country}
          {institution.region ? ` · ${institution.region.name}` : ""}
        </span>
        {institution.website && (
          <Link
            href={institution.website}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-[#1E3A5F] hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            Website
          </Link>
        )}
        <span className="text-sm text-slate-500">{institution.type}</span>
        {institution.contractValue != null && (
          <span className="inline-flex items-center gap-1 text-sm text-emerald-600 font-medium">
            <DollarSign className="h-3.5 w-3.5" />
            {formatCurrency(institution.contractValue)}
          </span>
        )}
        {institution.renewalDate && (
          <span className="inline-flex items-center gap-1 text-sm text-amber-600">
            <CalendarClock className="h-3.5 w-3.5" />
            Renewal: {formatDate(institution.renewalDate)}
          </span>
        )}
      </div>

      {/* Overview text */}
      {institution.overview && (
        <p className="text-sm text-slate-600 leading-relaxed max-w-3xl">{institution.overview}</p>
      )}

      {/* Tabs */}
      <InstitutionTabsClient
        institutionId={institution.id}
        counts={{ ...institution._count }}
        enrolledCount={enrolledCount}
        enrollmentTargets={institution.enrollmentTargets}
        contacts={institution.contacts}
        contracts={institution.contracts}
        engagementLogs={institution.engagementLogs.map((l) => ({
          id: l.id,
          type: l.type,
          date: l.date,
          notes: l.notes,
          outcome: l.outcome,
          user: l.user,
        }))}
        deliverablesCount={institution.deliverables.length}
        documents={institution.documents}
        governanceData={{
          stats: {
            totalLeads: institution._count.leads,
            enrolledCount,
            activitiesCount: institution._count.activities,
            openRisks: institution.riskRegisters.length,
            openCompliance: institution.complianceItems.length,
            deliverablesPending,
            deliverablesCompleted,
          },
          budget: { total: institution.budgetTotal, used: institution.budgetUsed },
          kpis: institution.clientKPIs.map((k) => ({
            id: k.id,
            name: k.name,
            category: k.category,
            targetValue: k.targetValue,
            currentValue: k.currentValue,
            unit: k.unit,
          })),
          recentActivities: institution.activities.map((a) => ({
            id: a.id,
            title: a.title,
            type: a.type,
            date: a.date.toISOString(),
            outcomes: a.outcomes,
          })),
        }}
        teamData={{
          accountManager,
          assignedUsers,
        }}
        strategicObjectives={institution.strategicObjectives}
      />
    </div>
  );
}
