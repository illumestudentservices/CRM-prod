import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import {
  WEEKLY_ACTIVITY_DEFS,
  WEEKLY_ACTIVITY_TYPES,
  type WeeklyActivityType,
} from "@/lib/weekly-activities";
import { ReportDetailClient } from "./_components/report-detail-client";
import { ApprovalActions } from "./_components/approval-actions";
import {
  renderKpiHtml,
  renderLeadsHtml,
  renderProgramsHtml,
  renderSourcesHtml,
  renderEventsHtml,
  renderWeeklyActivitiesHtml,
} from "./_components/report-section-html";

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTH_NAMES_FULL = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

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

  // Parse JSON data
  const leads = Array.isArray(report.leadsData) ? (report.leadsData as Array<{ id: string; fullName: string; email: string; stage: string; studyLevel: string; interestedProgram: string; nationality: string; createdAt: string }>) : [];
  const programs = Array.isArray(report.programBreakdown) ? (report.programBreakdown as Array<{ program: string; count: number; levels: Record<string, number> }>) : [];
  const sources = Array.isArray(report.sourcePerformance) ? (report.sourcePerformance as Array<{ name: string; leads: number; enrolled: number }>) : [];
  const events = Array.isArray(report.eventActivities) ? (report.eventActivities as Array<{ id: string; name: string; type: string; date: string; location: string; cost: number; leadsGenerated: number; roi: number | null }>) : [];
  const kpi = report.kpiSummary as { totalLeads: number; enrolled: number; conversionRate: number; contactRate: number; eventsCount: number; totalEventCost: number } | null;

  // Fetch previous month's report for trend comparison
  const prevMonth = report.reportingMonth === 1 ? 12 : report.reportingMonth - 1;
  const prevYear = report.reportingMonth === 1 ? report.reportingYear - 1 : report.reportingYear;
  const prevReport = await db.monthlyReport.findFirst({
    where: {
      icrId: report.icrId,
      institutionId: report.institutionId,
      reportingMonth: prevMonth,
      reportingYear: prevYear,
      deletedAt: null,
    },
    select: { kpiSummary: true },
  });
  const prevKpi = prevReport?.kpiSummary as typeof kpi | null;

  // Fetch weekly activities
  const weeklyActivities = await db.weeklyActivity.findMany({
    where: {
      icrId: report.icrId,
      year: report.reportingYear,
      month: report.reportingMonth,
    },
    orderBy: [{ type: "asc" }, { weekOfMonth: "asc" }],
  });

  const weeklyByTypeMap = new Map<string, { weeks: Record<number, number>; totalTarget: number }>();
  for (const wa of weeklyActivities) {
    let entry = weeklyByTypeMap.get(wa.type);
    if (!entry) {
      entry = { weeks: {}, totalTarget: 0 };
      weeklyByTypeMap.set(wa.type, entry);
    }
    entry.weeks[wa.weekOfMonth] = (entry.weeks[wa.weekOfMonth] ?? 0) + wa.completed;
    entry.totalTarget += wa.target;
  }

  const weeklyByType = WEEKLY_ACTIVITY_TYPES
    .filter((t) => weeklyByTypeMap.has(t))
    .map((t) => {
      const entry = weeklyByTypeMap.get(t)!;
      const def = WEEKLY_ACTIVITY_DEFS[t as WeeklyActivityType];
      return { type: t, label: def.label, weeks: entry.weeks, totalTarget: entry.totalTarget };
    });

  // Generate email-safe HTML for each section
  const sectionHtmls = {
    kpi: kpi ? renderKpiHtml(kpi) : "",
    leads: renderLeadsHtml(leads),
    programs: renderProgramsHtml(programs),
    sources: renderSourcesHtml(sources),
    events: renderEventsHtml(events),
    weeklyActivities: renderWeeklyActivitiesHtml(
      weeklyByTypeMap,
      WEEKLY_ACTIVITY_DEFS as Record<string, { label: string }>,
      WEEKLY_ACTIVITY_TYPES,
    ),
  };

  const monthName = MONTH_NAMES_FULL[report.reportingMonth];

  // Serialize approvals for client component
  const serializedReport = {
    id: report.id,
    icrId: report.icrId,
    status: report.status,
    reportingMonth: report.reportingMonth,
    reportingYear: report.reportingYear,
    engagementNotes: report.engagementNotes,
    challengesOpportunities: report.challengesOpportunities,
    successStories: report.successStories,
    marketInsights: report.marketInsights,
    nextMonthPlan: report.nextMonthPlan,
    pdfUrl: report.pdfUrl,
    icr: report.icr,
    institution: report.institution,
    region: report.region,
    approvals: report.approvals.map((a) => ({
      id: a.id,
      action: a.action,
      comment: a.comment,
      createdAt: a.createdAt.toISOString(),
      user: { name: a.user.name, role: a.user.role },
    })),
  };

  return (
    <div className="p-6">
      <ReportDetailClient
        report={serializedReport}
        kpi={kpi}
        prevKpi={prevKpi}
        leads={leads}
        programs={programs}
        sources={sources}
        events={events}
        weeklyByType={weeklyByType}
        sectionHtmls={sectionHtmls}
        canEdit={canEdit}
        userRole={role}
        monthName={monthName}
      />

      <div className="max-w-5xl mx-auto pt-2 pb-6">
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
