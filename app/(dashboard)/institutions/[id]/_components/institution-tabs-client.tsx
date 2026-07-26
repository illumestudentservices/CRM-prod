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
      deliverablesPending: number;
      deliverablesCompleted: number;
    };
    budget: { total: number | null; used: number | null };
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
}

// ─── Component ─────────────────────────────────────────────────────────────

export function InstitutionTabsClient({
  institutionId,
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
}: InstitutionTabsClientProps) {
  return (
    <Tabs defaultValue="governance">
      <TabsList className="bg-white border border-slate-200 flex-wrap h-auto">
        <TabsTrigger value="governance">Governance</TabsTrigger>
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="team">Team</TabsTrigger>
        <TabsTrigger value="contacts">Contacts ({counts.contacts})</TabsTrigger>
        <TabsTrigger value="contracts">Contracts ({counts.contracts})</TabsTrigger>
        <TabsTrigger value="engagement">Engagement ({counts.engagementLogs})</TabsTrigger>
        <TabsTrigger value="kpis">KPIs</TabsTrigger>
        <TabsTrigger value="documents">Documents</TabsTrigger>
      </TabsList>

      {/* Governance Dashboard */}
      <TabsContent value="governance" className="mt-4">
        <GovernanceTab
          stats={governanceData.stats}
          budget={governanceData.budget}
          kpis={governanceData.kpis}
          recentActivities={governanceData.recentActivities}
        />
      </TabsContent>

      {/* Overview */}
      <TabsContent value="overview" className="mt-4 space-y-6">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          {[
            { label: "Total Leads", value: counts.leads, cls: "text-slate-900" },
            { label: "Enrolled", value: enrolledCount, cls: "text-green-600" },
            { label: "Contracts", value: counts.contracts, cls: "text-slate-900" },
            { label: "Activities", value: counts.activities, cls: "text-cyan-600" },
          ].map((s) => (
            <Card key={s.label}>
              <CardContent className="p-4 text-center">
                <p className={`text-2xl font-bold ${s.cls}`}>{s.value}</p>
                <p className="text-xs text-slate-500 mt-1">{s.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        {strategicObjectives && (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-slate-700">Strategic Objectives</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
                {strategicObjectives}
              </p>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent className="pt-4">
            <p className="text-sm font-semibold text-slate-700 mb-3">Enrollment Targets vs Actual</p>
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
                <TableRow className="bg-slate-50/80">
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
                    <TableCell colSpan={5} className="text-center text-slate-400 py-8">
                      No contacts added yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  contacts.map((contact) => (
                    <TableRow key={contact.id}>
                      <TableCell className="font-medium">{contact.name}</TableCell>
                      <TableCell className="text-slate-600">{contact.title ?? "—"}</TableCell>
                      <TableCell className="text-slate-600">{contact.email ?? "—"}</TableCell>
                      <TableCell className="text-slate-600">{contact.phone ?? "—"}</TableCell>
                      <TableCell>
                        {contact.isPrimary && (
                          <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200 text-xs">
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
      <TabsContent value="kpis" className="mt-4">
        <KpiManager institutionId={institutionId} />
      </TabsContent>

      {/* Documents */}
      <TabsContent value="documents" className="mt-4">
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-50/80">
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Uploaded</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {documents.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-slate-400 py-8">
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
                          className="text-[#1E3A5F] hover:underline text-sm"
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
