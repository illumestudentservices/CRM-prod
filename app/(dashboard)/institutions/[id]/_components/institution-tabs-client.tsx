"use client";

import Link from "next/link";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { formatDate } from "@/lib/utils";
import type { InteractionType } from "@prisma/client";
import { EnrollmentChart } from "./enrollment-chart";
import { ContractList } from "./contract-list";
import { EngagementLog } from "./engagement-log";
import { GovernanceTab } from "./governance-tab";
import { TeamTab } from "./team-tab";
import { KpiManager } from "./kpi-manager";
import { PipelinePanel } from "./pipeline-panel";
import { AccountHealthCard } from "./account-health-card";
import { ClientIssuesPanel } from "./client-issues-panel";
import type { LeadStage } from "@prisma/client";

// ─── Types ─────────────────────────────────────────────────────────────────

interface Contact {
  id: string;
  name: string;
  title: string | null;
  email: string | null;
  phone: string | null;
  isPrimary: boolean;
}

interface Contract {
  id: string;
  title: string;
  value: number | null;
  startDate: Date | string;
  endDate: Date | string;
  status: string;
  documentUrl: string | null;
  notes: string | null;
}

interface LogEntry {
  id: string;
  type: InteractionType;
  date: Date | string;
  notes: string | null;
  outcome: string | null;
  user: { id: string; name: string | null; image: string | null };
}

interface EnrollmentTarget {
  id: string;
  year: number;
  target: number;
  actual: number;
}

interface Document {
  id: string;
  name: string;
  type: string;
  uploadedAt: Date | string;
  url: string;
}

interface TeamMember {
  id: string;
  name: string | null;
  email: string;
  role: string;
  image?: string | null;
}

interface InstitutionTabsClientProps {
  institutionId: string;
  /** institutions:write — may raise and update issues. */
  canWrite: boolean;
  /** institutions.set_health — may change the red/amber/green rating. */
  canSetHealth: boolean;
  counts: { leads: number; contacts: number; contracts: number; engagementLogs: number; activities: number };
  enrolledCount: number;
  enrollmentTargets: EnrollmentTarget[];
  contacts: Contact[];
  contracts: Contract[];
  engagementLogs: LogEntry[];
  deliverablesCount: number;
  documents: Document[];
  governanceData: {
    stats: {
      totalLeads: number;
      enrolledCount: number;
      activitiesCount: number;
      openRisks: number;
      openCompliance: number;
      openIssues?: number;
      deliverablesPending: number;
      deliverablesCompleted: number;
    };
    /// Spec §11 — traffic-light account health. Optional to keep old test
    /// harnesses passing during rollout.
    accountHealth?: "GREEN" | "AMBER" | "RED" | "GREY" | null;
    kpis: Array<{
      id: string;
      name: string;
      category: string;
      targetValue: number;
      currentValue: number;
      unit: string;
    }>;
    recentActivities: Array<{
      id: string;
      title: string;
      type: string;
      date: string | Date;
      outcomes: string | null;
    }>;
  };
  teamData: {
    accountManager: TeamMember | null;
    assignedUsers: TeamMember[];
  };
  strategicObjectives: string | null;
  /// Spec §2 (Clients) — student pipeline panel data (all leads with stage).
  leads: Array<{ id: string; stage: LeadStage }>;
}

// ─── Component ─────────────────────────────────────────────────────────────

export function InstitutionTabsClient({
  institutionId,
  canWrite,
  canSetHealth,
  counts,
  enrolledCount,
  enrollmentTargets,
  contacts,
  contracts,
  engagementLogs,
  deliverablesCount,
  documents,
  governanceData,
  teamData,
  strategicObjectives,
  leads,
}: InstitutionTabsClientProps) {
  return (
    <Tabs defaultValue="governance">
      <TabsList className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex-wrap h-auto">
        <TabsTrigger value="governance">Governance</TabsTrigger>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="team">Team</TabsTrigger>
        <TabsTrigger value="contacts">Contacts ({counts.contacts})</TabsTrigger>
        <TabsTrigger value="contracts">Contracts ({counts.contracts})</TabsTrigger>
        <TabsTrigger value="engagement">Engagement ({counts.engagementLogs})</TabsTrigger>
        <TabsTrigger value="issues">Issues</TabsTrigger>
        <TabsTrigger value="kpis">KPIs</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
      </TabsList>

      {/* Governance Dashboard */}
      <TabsContent value="governance" className="mt-4 space-y-6">
        {/* The rating and its interventions were modelled and had no way to be
            set. Placed above the dashboard because it is the one thing on this
            tab a person acts on rather than reads. */}
        <AccountHealthCard institutionId={institutionId} canSetHealth={canSetHealth} />
        <GovernanceTab
          stats={governanceData.stats}
          accountHealth={governanceData.accountHealth ?? null}
          kpis={governanceData.kpis}
          recentActivities={governanceData.recentActivities}
        />
      </TabsContent>

      {/* Client issues */}
      <TabsContent value="issues" className="mt-4">
        <ClientIssuesPanel institutionId={institutionId} canWrite={canWrite} />
      </TabsContent>

      {/* Overview */}
      <TabsContent value="overview" className="mt-4 space-y-6">
        {/* Spec §2 (Clients) — 8-stage pipeline panel. Sits above the summary
            tiles so an AM opening the tab sees the live pipeline immediately. */}
        <PipelinePanel leads={leads} />

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Leads", value: counts.leads, cls: "text-slate-900 dark:text-slate-100" },
            { label: "Enrolled", value: enrolledCount, cls: "text-green-600 dark:text-green-400" },
            { label: "Contracts", value: counts.contracts, cls: "text-slate-900 dark:text-slate-100" },
            { label: "Activities", value: counts.activities, cls: "text-cyan-600 dark:text-cyan-400" },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4 text-center">
                <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {strategicObjectives && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Strategic Objectives</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600 dark:text-slate-400 whitespace-pre-wrap leading-relaxed">
                {strategicObjectives}
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-4">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300 mb-3">Enrollment Targets vs Actual</p>
            <EnrollmentChart targets={enrollmentTargets} />
          </CardContent>
        </Card>
      </TabsContent>

      {/* Team */}
      <TabsContent value="team" className="mt-4">
        <TeamTab
          accountManager={teamData.accountManager}
          assignedUsers={teamData.assignedUsers}
        />
      </TabsContent>

      {/* Contacts */}
      <TabsContent value="contacts" className="mt-4">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80 dark:bg-slate-900/40">
                  <TableHead>Name</TableHead>
                  <TableHead>Title</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Primary</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {contacts.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-slate-400 dark:text-slate-500 py-8">
                      No contacts added yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  contacts.map((contact) => (
                    <TableRow key={contact.id}>
                      <TableCell className="font-medium">{contact.name}</TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-400">{contact.title ?? "—"}</TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-400">{contact.email ?? "—"}</TableCell>
                      <TableCell className="text-slate-600 dark:text-slate-400">{contact.phone ?? "—"}</TableCell>
                      <TableCell>
                        {contact.isPrimary && (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30 text-xs">
                            Primary
                          </Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>

      {/* Contracts */}
      <TabsContent value="contracts" className="mt-4">
        <ContractList contracts={contracts} institutionId={institutionId} />
      </TabsContent>

      {/* Engagement */}
      <TabsContent value="engagement" className="mt-4">
        <EngagementLog logs={engagementLogs} institutionId={institutionId} />
      </TabsContent>

      {/* KPIs */}
      <TabsContent value="kpis" className="mt-4 space-y-6">
        {/* Spec §8 (Clients) — auto-computed metrics from student records
            appear above the manual KPI tracker. The disclaimer text is
            spec-mandated: "Based on student records maintained within Illume
            CRM." */}
        <PipelinePanel leads={leads} />
        <div className="rounded-md border border-slate-200 bg-slate-50 dark:bg-slate-900/40 dark:border-slate-800 p-3 text-xs text-slate-600 dark:text-slate-400">
          <p className="font-medium text-slate-700 dark:text-slate-300">Manual KPI targets</p>
          <p className="mt-0.5">
            The auto-computed pipeline above comes from student records. Use
            the section below to record manual KPI targets your Account Manager
            tracks separately (e.g. quarterly enquiry targets).
          </p>
        </div>
        <KpiManager institutionId={institutionId} />
      </TabsContent>

      {/* Documents */}
      <TabsContent value="documents" className="mt-4">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80 dark:bg-slate-900/40">
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-slate-400 dark:text-slate-500 py-8">
                      No documents uploaded yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  documents.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="font-medium">{doc.name}</TableCell>
                      <TableCell>{doc.type}</TableCell>
                      <TableCell>{formatDate(doc.uploadedAt)}</TableCell>
                      <TableCell>
                        <Link
                          href={doc.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[#1E3A5F] dark:text-blue-400 hover:underline text-sm"
                        >
                          Download
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}
