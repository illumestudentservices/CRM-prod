import * as React from "react";
import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  MapPin, Mail, Phone, User, Star, ExternalLink,
} from "lucide-react";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { StatCard } from "@/components/shared/stat-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { cn, formatDate } from "@/lib/utils";
import { SourceForm } from "../_components/source-form";

const STAGE_COLORS: Record<string, string> = {
  NEW: "bg-slate-100 text-slate-700",
  CONTACTED: "bg-blue-100 text-blue-700",
  APPLICATION_SENT: "bg-violet-100 text-violet-700",
  DOCUMENTS_RECEIVED: "bg-amber-100 text-amber-700",
  OFFER_ISSUED: "bg-sky-100 text-sky-700",
  ENROLLED: "bg-green-100 text-green-700",
  DEFERRED: "bg-amber-100 text-amber-700",
  REJECTED: "bg-red-100 text-red-700",
  LOST: "bg-slate-100 text-slate-400",
};

function stageLabel(stage: string) {
  return stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

const TYPE_LABELS: Record<string, string> = {
  AGENT: "Agent",
  SCHOOL: "School",
  FAIR: "Education Fair",
  REFERRAL: "Referral",
  DIGITAL: "Digital",
  WALK_IN: "Walk-in",
  OTHER: "Other",
};

const AGREEMENT_LABELS: Record<string, { label: string; className: string }> = {
  SIGNED: { label: "Signed", className: "bg-green-100 text-green-700" },
  PENDING: { label: "Pending", className: "bg-amber-100 text-amber-700" },
  EXPIRED: { label: "Expired", className: "bg-red-100 text-red-700" },
  NONE: { label: "None", className: "bg-slate-100 text-slate-600" },
};

async function getSource(id: string) {
  const source = await db.source.findUnique({
    where: { id },
    include: {
      region: { select: { id: true, name: true } },
      campaigns: { where: { deletedAt: null }, orderBy: { createdAt: "desc" } },
      leads: {
        where: { deletedAt: null },
        include: {
          assignedICR: { select: { id: true, name: true } },
          institution: { select: { id: true, name: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      },
      _count: { select: { leads: { where: { deletedAt: null } }, campaigns: { where: { deletedAt: null } } } },
    },
  });

  if (!source || source.deletedAt) return null;

  const totalLeads = source._count.leads;
  const enrolledLeads = source.leads.filter((l) => l.stage === "ENROLLED").length;
  const conversionRate = totalLeads > 0 ? Math.round((enrolledLeads / totalLeads) * 100) : 0;

  return { ...source, totalLeads, enrolledLeads, conversionRate };
}

async function getRegions() {
  return db.region.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
}

export default async function SourceDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { id } = await params;
  const [source, regions] = await Promise.all([getSource(id), getRegions()]);

  if (!source) notFound();

  const agreementConfig = source.agreementStatus
    ? (AGREEMENT_LABELS[source.agreementStatus] ?? { label: source.agreementStatus, className: "bg-slate-100 text-slate-600" })
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title={source.name}
        description={`${TYPE_LABELS[source.type] ?? source.type} · ${source.country}${source.city ? `, ${source.city}` : ""}`}
        breadcrumbs={[
          { label: "Dashboard", href: "/dashboard" },
          { label: "Sources", href: "/sources" },
          { label: source.name },
        ]}
        actions={
          <SourceForm
            source={{
              id: source.id,
              name: source.name,
              type: source.type,
              country: source.country,
              city: source.city,
              contactPerson: source.contactPerson,
              email: source.email,
              phone: source.phone,
              agreementStatus: source.agreementStatus,
              rating: source.rating,
              notes: source.notes,
              region: source.region,
            }}
            regions={regions}
          />
        }
      />

      {/* Stat Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total Leads"
          value={source.totalLeads}
          icon="Users"
          iconColor="text-[#1E3A5F]"
          iconBg="bg-[#1E3A5F]/10"
        />
        <StatCard
          title="Enrolled"
          value={source.enrolledLeads}
          icon="GraduationCap"
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50"
        />
        <StatCard
          title="Conversion Rate"
          value={`${source.conversionRate}%`}
          icon="Target"
          iconColor="text-sky-600"
          iconBg="bg-sky-50"
        />
        <StatCard
          title="Campaigns"
          value={source._count.campaigns}
          icon="Megaphone"
          iconColor="text-violet-600"
          iconBg="bg-violet-50"
        />
      </div>

      {/* Tabs */}
      <Tabs defaultValue="overview" className="w-full">
        <TabsList className="bg-white border border-slate-200">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="leads">Leads ({source.totalLeads})</TabsTrigger>
          <TabsTrigger value="campaigns">Campaigns ({source._count.campaigns})</TabsTrigger>
        </TabsList>

        {/* Overview */}
        <TabsContent value="overview" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-700">Source Details</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Type</span>
                  <Badge variant="outline">{TYPE_LABELS[source.type] ?? source.type}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Status</span>
                  <Badge className={cn("border-0", source.isActive ? "bg-green-100 text-green-700" : "bg-slate-100 text-slate-500")}>
                    {source.isActive ? "Active" : "Inactive"}
                  </Badge>
                </div>
                {source.region && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Region</span>
                    <span className="font-medium text-slate-800">{source.region.name}</span>
                  </div>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-slate-500">Location</span>
                  <span className="flex items-center gap-1 font-medium text-slate-800">
                    <MapPin className="h-3.5 w-3.5 text-slate-400" />
                    {source.country}{source.city ? `, ${source.city}` : ""}
                  </span>
                </div>
                {agreementConfig && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Agreement</span>
                    <Badge className={cn("border-0", agreementConfig.className)}>{agreementConfig.label}</Badge>
                  </div>
                )}
                {source.rating !== null && (
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">Rating</span>
                    <div className="flex items-center gap-0.5">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={cn("h-3.5 w-3.5", i < (source.rating ?? 0) ? "fill-amber-400 text-amber-400" : "text-slate-200")}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-semibold text-slate-700">Contact Information</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {source.contactPerson ? (
                  <div className="flex items-center gap-2 text-slate-700">
                    <User className="h-4 w-4 text-slate-400 shrink-0" />
                    <span>{source.contactPerson}</span>
                  </div>
                ) : null}
                {source.email ? (
                  <div className="flex items-center gap-2 text-slate-700">
                    <Mail className="h-4 w-4 text-slate-400 shrink-0" />
                    <a href={`mailto:${source.email}`} className="hover:underline text-sky-600">{source.email}</a>
                  </div>
                ) : null}
                {source.phone ? (
                  <div className="flex items-center gap-2 text-slate-700">
                    <Phone className="h-4 w-4 text-slate-400 shrink-0" />
                    <a href={`tel:${source.phone}`} className="hover:underline text-sky-600">{source.phone}</a>
                  </div>
                ) : null}
                {!source.contactPerson && !source.email && !source.phone && (
                  <p className="text-slate-400 text-xs">No contact information recorded.</p>
                )}
              </CardContent>
            </Card>

            {source.notes && (
              <Card className="lg:col-span-2">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm font-semibold text-slate-700">Notes</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-slate-600 whitespace-pre-wrap">{source.notes}</p>
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        {/* Leads */}
        <TabsContent value="leads" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {source.leads.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
                  No leads from this source yet.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Stage</TableHead>
                      <TableHead>Institution</TableHead>
                      <TableHead>Assigned ICR</TableHead>
                      <TableHead>Created</TableHead>
                      <TableHead className="w-8" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {source.leads.map((lead) => (
                      <TableRow key={lead.id} className="hover:bg-slate-50">
                        <TableCell className="font-medium text-slate-800">{lead.fullName}</TableCell>
                        <TableCell>
                          <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", STAGE_COLORS[lead.stage] ?? "bg-slate-100 text-slate-700")}>
                            {stageLabel(lead.stage)}
                          </span>
                        </TableCell>
                        <TableCell className="text-slate-600">{lead.institution?.name ?? "—"}</TableCell>
                        <TableCell className="text-slate-600">{lead.assignedICR?.name ?? "—"}</TableCell>
                        <TableCell className="text-slate-500 text-xs">{formatDate(lead.createdAt)}</TableCell>
                        <TableCell>
                          <Link href={`/students/${lead.id}`} className="text-slate-400 hover:text-slate-700">
                            <ExternalLink className="h-4 w-4" />
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Campaigns */}
        <TabsContent value="campaigns" className="mt-4">
          <Card>
            <CardContent className="p-0">
              {source.campaigns.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
                  No campaigns linked to this source.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Campaign</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Start Date</TableHead>
                      <TableHead>End Date</TableHead>
                      <TableHead>Budget</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {source.campaigns.map((campaign) => (
                      <TableRow key={campaign.id}>
                        <TableCell className="font-medium text-slate-800">{campaign.name}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="capitalize text-xs">
                            {campaign.isActive ? "active" : "inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-slate-500 text-xs">
                          {campaign.startDate ? formatDate(campaign.startDate) : "—"}
                        </TableCell>
                        <TableCell className="text-slate-500 text-xs">
                          {campaign.endDate ? formatDate(campaign.endDate) : "—"}
                        </TableCell>
                        <TableCell className="text-slate-600 text-sm">
                          {campaign.budget != null ? `$${Number(campaign.budget).toLocaleString()}` : "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
