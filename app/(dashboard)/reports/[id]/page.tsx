import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ApprovalActions } from "./_components/approval-actions";
import { ForecastSection } from "./_components/forecast-section";
import {
  Edit,
  Download,
  Users,
  BookOpen,
  Globe,
  Calendar,
  MessageSquare,
  TrendingUp,
  AlertTriangle,
  ClipboardList,
} from "lucide-react";
import type { Role } from "@/lib/permissions";

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-slate-100 text-slate-600 border-slate-200" },
  PENDING_REVIEW: { label: "Pending Review", className: "bg-amber-100 text-amber-800 border-amber-200" },
  REGIONAL_APPROVED: { label: "Regionally Approved", className: "bg-blue-100 text-blue-800 border-blue-200" },
  HQ_REVIEW: { label: "HQ Review", className: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  FINAL_APPROVED: { label: "Final Approved", className: "bg-green-100 text-green-800 border-green-200" },
  RETURNED: { label: "Returned", className: "bg-red-100 text-red-800 border-red-200" },
};

const STAGE_COLORS: Record<string, string> = {
  ENROLLED: "text-[#22C55E]",
  OFFER_ISSUED: "text-[#F59E0B]",
  REJECTED: "text-[#EF4444]",
  LOST: "text-[#EF4444]",
};

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await db.monthlyReport.findFirst({
    where: { id, deletedAt: null },
    select: { reportingMonth: true, reportingYear: true, institution: { select: { name: true } } },
  });
  if (!report) return { title: "Report | Illume Student Advisory Services" };
  return {
    title: `${report.institution.name} — ${MONTH_NAMES[report.reportingMonth]} ${report.reportingYear} | Illume Student Advisory Services`,
  };
}

export default async function ReportViewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { role, id: userId, regionId } = session.user as {
    role: Role;
    id: string;
    regionId: string | null;
  };

  const { id } = await params;

  const report = await db.monthlyReport.findFirst({
    where: { id, deletedAt: null },
    include: {
      icr: { select: { id: true, name: true, email: true } },
      institution: { select: { id: true, name: true, country: true } },
      region: { select: { id: true, name: true } },
      approvals: {
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, name: true, role: true } } },
      },
    },
  });

  if (!report) notFound();

  // Access control
  const isExec = ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS"].includes(role);
  if (role === "ICR" && report.icrId !== userId) redirect("/reports");
  if (role === "REGIONAL_MANAGER" && report.regionId !== regionId) redirect("/reports");
  if (!isExec && role !== "ICR" && role !== "REGIONAL_MANAGER" && role !== "INSTITUTION_CLIENT") {
    redirect("/reports");
  }

  const canEdit =
    role === "ICR" &&
    report.icrId === userId &&
    ["DRAFT", "RETURNED"].includes(report.status);

  const leads = Array.isArray(report.leadsData) ? (report.leadsData as Array<{ id: string; fullName: string; email: string; stage: string; studyLevel: string; interestedProgram: string; nationality: string; createdAt: string }>) : [];
  const programs = Array.isArray(report.programBreakdown) ? (report.programBreakdown as Array<{ program: string; count: number; levels: Record<string, number> }>) : [];
  const sources = Array.isArray(report.sourcePerformance) ? (report.sourcePerformance as Array<{ name: string; leads: number; enrolled: number }>) : [];
  const events = Array.isArray(report.eventActivities) ? (report.eventActivities as Array<{ id: string; name: string; type: string; date: string; location: string; cost: number; leadsGenerated: number; roi: number | null }>) : [];
  const kpi = report.kpiSummary as { totalLeads: number; enrolled: number; conversionRate: number; contactRate: number; eventsCount: number; totalEventCost: number } | null;

  const statusCfg = STATUS_CONFIG[report.status] ?? STATUS_CONFIG["DRAFT"];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <PageHeader
        title={`Monthly Report — ${report.institution.name}`}
        description={`${MONTH_NAMES[report.reportingMonth]} ${report.reportingYear} · ICR: ${report.icr.name ?? report.icr.email}`}
        breadcrumbs={[
          { label: "Home", href: "/dashboard" },
          { label: "Reports", href: "/reports" },
          { label: `${report.institution.name} ${MONTH_NAMES[report.reportingMonth]} ${report.reportingYear}` },
        ]}
        actions={
          <div className="flex items-center gap-2">
            {canEdit && (
              <Button asChild className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white">
                <Link href={`/reports/${id}/edit`}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </Link>
              </Button>
            )}
            {report.pdfUrl && (
              <Button variant="outline" asChild>
                <a href={report.pdfUrl} target="_blank" rel="noopener noreferrer">
                  <Download className="h-4 w-4 mr-2" />
                  Download PDF
                </a>
              </Button>
            )}
          </div>
        }
      />

      {/* Section 1: Report Header */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <CardTitle className="text-base font-semibold text-slate-800">Report Header</CardTitle>
              <p className="text-xs text-slate-500 mt-0.5">Section 1 — Report metadata</p>
            </div>
            <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium border ${statusCfg.className}`}>
              {statusCfg.label}
            </span>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: "ICR", value: report.icr.name ?? report.icr.email },
              { label: "Institution", value: report.institution.name },
              { label: "Period", value: `${MONTH_NAMES[report.reportingMonth]} ${report.reportingYear}` },
              { label: "Region", value: report.region?.name ?? "—" },
            ].map((item) => (
              <div key={item.label}>
                <p className="text-xs text-slate-500">{item.label}</p>
                <p className="text-sm font-medium text-slate-800 mt-0.5">{item.value}</p>
              </div>
            ))}
          </div>

          {/* Approval history */}
          {report.approvals.length > 0 && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-500 mb-2">Approval History</p>
              <div className="space-y-1.5">
                {report.approvals.map((approval: { id: string; action: string; comment: string | null; createdAt: Date; user: { name: string | null; role: string } }) => (
                  <div key={approval.id} className="flex items-start gap-3 text-xs">
                    <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                      approval.action === "APPROVED" ? "bg-green-100 text-green-700"
                        : approval.action === "RETURNED" ? "bg-red-100 text-red-700"
                        : approval.action === "SUBMITTED" ? "bg-blue-100 text-blue-700"
                        : "bg-slate-100 text-slate-600"
                    }`}>
                      {approval.action}
                    </span>
                    <span className="text-slate-600">{approval.user.name} ({approval.user.role.replace(/_/g, " ")})</span>
                    <span className="text-slate-400">{new Date(approval.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}</span>
                    {approval.comment && (
                      <span className="text-slate-500 italic truncate max-w-xs">"{approval.comment}"</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 2: Leads */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <Users className="h-4 w-4 text-[#0EA5E9]" />
            Section 2: Leads Collected
            <span className="text-xs font-normal text-slate-400">({leads.length} leads)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {leads.length === 0 ? (
            <p className="text-sm text-slate-400">No leads recorded for this period.</p>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left font-semibold text-slate-500 py-2 px-3">Name</th>
                    <th className="text-left font-semibold text-slate-500 py-2 px-3">Nationality</th>
                    <th className="text-left font-semibold text-slate-500 py-2 px-3">Program</th>
                    <th className="text-left font-semibold text-slate-500 py-2 px-3">Level</th>
                    <th className="text-left font-semibold text-slate-500 py-2 px-3">Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.slice(0, 20).map((lead) => (
                    <tr key={lead.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-2 px-3 font-medium text-slate-800">{lead.fullName}</td>
                      <td className="py-2 px-3 text-slate-600">{lead.nationality}</td>
                      <td className="py-2 px-3 text-slate-600 max-w-[140px] truncate">{lead.interestedProgram}</td>
                      <td className="py-2 px-3 text-slate-500">{lead.studyLevel}</td>
                      <td className={`py-2 px-3 font-medium ${STAGE_COLORS[lead.stage] ?? "text-slate-600"}`}>
                        {lead.stage.replace(/_/g, " ")}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {leads.length > 20 && (
                <p className="text-xs text-slate-400 text-center py-2 bg-slate-50 border-t border-slate-200">
                  + {leads.length - 20} more leads
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 3: Program Breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-[#0EA5E9]" />
            Section 3: Program Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          {programs.length === 0 ? (
            <p className="text-sm text-slate-400">No program data available.</p>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left text-xs font-semibold text-slate-500 py-2 px-4">Program</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">Total</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">UG</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">PG</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">Foundation</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">Pathway</th>
                  </tr>
                </thead>
                <tbody>
                  {programs.map((prog) => (
                    <tr key={prog.program} className="border-b border-slate-50 last:border-0">
                      <td className="py-2.5 px-4 font-medium text-slate-800">{prog.program}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-[#1E3A5F]">{prog.count}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">{prog.levels?.["UNDERGRADUATE"] ?? 0}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">{prog.levels?.["POSTGRADUATE"] ?? 0}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">{prog.levels?.["FOUNDATION"] ?? 0}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">{prog.levels?.["PATHWAY"] ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 4: Source Performance */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <Globe className="h-4 w-4 text-[#0EA5E9]" />
            Section 4: Source Performance
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sources.length === 0 ? (
            <p className="text-sm text-slate-400">No source data.</p>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left text-xs font-semibold text-slate-500 py-2 px-4">Source</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">Leads</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">Enrolled</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">Conversion</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((src) => (
                    <tr key={src.name} className="border-b border-slate-50 last:border-0">
                      <td className="py-2.5 px-4 font-medium text-slate-800">{src.name}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">{src.leads}</td>
                      <td className="py-2.5 px-4 text-right text-[#22C55E] font-semibold">{src.enrolled}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">
                        {src.leads > 0 ? `${Math.round((src.enrolled / src.leads) * 100)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 5: Events */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-[#0EA5E9]" />
            Section 5: Event Activities & ROI
          </CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-slate-400">No events during this period.</p>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left text-xs font-semibold text-slate-500 py-2 px-4">Event</th>
                    <th className="text-left text-xs font-semibold text-slate-500 py-2 px-3">Location</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-3">Leads</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-3">Cost</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id} className="border-b border-slate-50 last:border-0">
                      <td className="py-2.5 px-4 font-medium text-slate-800">{event.name}</td>
                      <td className="py-2.5 px-3 text-slate-600 text-xs">{event.location}</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-[#0EA5E9]">{event.leadsGenerated}</td>
                      <td className="py-2.5 px-3 text-right text-slate-600">
                        {event.cost > 0 ? `$${event.cost.toLocaleString()}` : "—"}
                      </td>
                      <td className="py-2.5 px-4 text-right text-slate-600">
                        {event.roi !== null ? `${event.roi}` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 6: Engagement Notes */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <MessageSquare className="h-4 w-4 text-[#0EA5E9]" />
            Section 6: Engagement & BD Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.engagementNotes ? (
            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{report.engagementNotes}</p>
          ) : (
            <p className="text-sm text-slate-400 italic">No engagement notes provided.</p>
          )}
        </CardContent>
      </Card>

      {/* Section 7: Forecast */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[#0EA5E9]" />
            Section 7: Forecast Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ForecastSection
            reportId={report.id}
            institutionId={report.institutionId}
            readOnly={true}
          />
        </CardContent>
      </Card>

      {/* Section 8: Challenges */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-[#F59E0B]" />
            Section 8: Challenges & Opportunities
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.challengesOpportunities ? (
            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{report.challengesOpportunities}</p>
          ) : (
            <p className="text-sm text-slate-400 italic">No challenges & opportunities noted.</p>
          )}
        </CardContent>
      </Card>

      {/* Section 9: Next Month Plan */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <ClipboardList className="h-4 w-4 text-[#0EA5E9]" />
            Section 9: Next Month Plan
          </CardTitle>
        </CardHeader>
        <CardContent>
          {report.nextMonthPlan ? (
            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{report.nextMonthPlan}</p>
          ) : (
            <p className="text-sm text-slate-400 italic">No next month plan provided.</p>
          )}
        </CardContent>
      </Card>

      {/* KPI Summary */}
      {kpi && (
        <Card className="border-[#1E3A5F]/20 bg-[#1E3A5F]/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-[#1E3A5F]">KPI Summary</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {[
                { label: "Total Leads", value: kpi.totalLeads },
                { label: "Enrolled", value: kpi.enrolled },
                { label: "Conversion Rate", value: `${kpi.conversionRate}%` },
                { label: "Contact Rate", value: `${kpi.contactRate}%` },
                { label: "Events", value: kpi.eventsCount },
                { label: "Event Cost", value: kpi.totalEventCost > 0 ? `$${kpi.totalEventCost.toLocaleString()}` : "—" },
              ].map((item) => (
                <div key={item.label} className="text-center">
                  <p className="text-xl font-bold text-[#1E3A5F]">{item.value}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{item.label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Approval Actions */}
      <div className="pt-2 pb-6">
        <ApprovalActions
          reportId={report.id}
          reportStatus={report.status}
          userRole={role}
          userId={userId}
          icrId={report.icrId}
        />
      </div>
    </div>
  );
}
