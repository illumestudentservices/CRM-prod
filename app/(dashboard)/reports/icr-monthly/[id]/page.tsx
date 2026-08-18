import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { fromJson, type AutoFilledSections } from "@/lib/icr-monthly-report";
import { IcrReportClient } from "./_components/icr-report-client";

const MONTHS = ["", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const report = await db.icrMonthlyReport.findFirst({
    where: { id, deletedAt: null },
    select: { reportingMonth: true, reportingYear: true, icr: { select: { name: true } } },
  });
  if (!report) return { title: "ICR Monthly Report | Illume Student Advisory Services" };
  return {
    title: `${report.icr.name ?? "ICR"} — ${MONTHS[report.reportingMonth]} ${report.reportingYear} | Illume Student Advisory Services`,
  };
}

export default async function IcrReportPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { role, id: userId, regionId } = session.user as {
    role: Role;
    id: string;
    regionId: string | null;
  };
  if (!(await effectiveHasPermission(role, "reports", "read"))) redirect("/dashboard");

  const { id } = await params;
  const report = await db.icrMonthlyReport.findFirst({
    where: { id, deletedAt: null },
    include: {
      icr: { select: { id: true, name: true, email: true } },
      region: { select: { id: true, name: true } },
      approvals: {
        orderBy: { createdAt: "desc" },
        include: { user: { select: { name: true, email: true } } },
      },
    },
  });
  if (!report) notFound();

  // Same gate as the API, applied again here — a page that renders is a leak in
  // its own right, regardless of what the API would have said.
  const isExec = ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "VP_GLOBAL_SALES"].includes(role);
  if (!isExec) {
    if (role === "ICR" && report.icrId !== userId) redirect("/reports/icr-monthly");
    else if (role === "REGIONAL_MANAGER" && (regionId == null || report.regionId !== regionId)) {
      redirect("/reports/icr-monthly");
    } else if (role !== "ICR" && role !== "REGIONAL_MANAGER") {
      redirect("/reports/icr-monthly");
    }
  }

  const isOwner = report.icrId === userId;
  const editable =
    (isOwner || role === "SUPER_ADMIN") &&
    (report.status === "DRAFT" || report.status === "RETURNED") &&
    (await effectiveHasPermission(role, "reports", "write"));

  const canDecide =
    (role === "REGIONAL_MANAGER" && regionId != null && report.regionId === regionId) ||
    role === "SUPER_ADMIN";

  const lastReturn = report.approvals.find((a) => a.action === "RETURNED");

  return (
    <div className="p-6">
      <IcrReportClient
        report={{
          id: report.id,
          reportingMonth: report.reportingMonth,
          reportingYear: report.reportingYear,
          status: report.status,
          intakesCovered: report.intakesCovered,
          icr: report.icr,
          region: report.region,
          submittedAt: report.submittedAt?.toISOString() ?? null,
          finalApprovedAt: report.finalApprovedAt?.toISOString() ?? null,
          generatedAt: report.generatedAt.toISOString(),
          refreshedAt: report.refreshedAt?.toISOString() ?? null,
          keyHighlights: report.keyHighlights,
          keyChallenges: report.keyChallenges,
          channelDevelopment: report.channelDevelopment,
          businessDevelopment: report.businessDevelopment,
          demandTrends: report.demandTrends,
          competitiveActivity: report.competitiveActivity,
          marketConditions: report.marketConditions,
          priorityOne: report.priorityOne,
          priorityTwo: report.priorityTwo,
          priorityThree: report.priorityThree,
          supportRequested: report.supportRequested,
        }}
        sections={{
          performance: fromJson<AutoFilledSections["performance"]>(report.performance) ?? [],
          pipelineSnapshot:
            fromJson<AutoFilledSections["pipelineSnapshot"]>(report.pipelineSnapshot) ?? {
              activeLeads: 0, applicationsInProgress: 0, offersPending: 0, depositsPending: 0,
            },
          institutionBreakdown: fromJson<AutoFilledSections["institutionBreakdown"]>(report.institutionBreakdown) ?? [],
          priorityApplications: fromJson<AutoFilledSections["priorityApplications"]>(report.priorityApplications) ?? [],
          agentEngagement:
            fromJson<AutoFilledSections["agentEngagement"]>(report.agentEngagement) ?? {
              agentMeetings: 0, newAgentsIdentified: 0, trainingsDelivered: 0, accountPlanning: 0,
            },
          topAgents: fromJson<AutoFilledSections["topAgents"]>(report.topAgents) ?? [],
          atRiskAgents: fromJson<AutoFilledSections["atRiskAgents"]>(report.atRiskAgents) ?? [],
          eventActivities: fromJson<AutoFilledSections["eventActivities"]>(report.eventActivities) ?? [],
        }}
        approvals={report.approvals.map((a) => ({
          id: a.id,
          action: a.action,
          comment: a.comment,
          createdAt: a.createdAt.toISOString(),
          user: a.user.name ?? a.user.email,
        }))}
        returnComment={report.status === "RETURNED" ? lastReturn?.comment ?? null : null}
        editable={editable}
        canDecide={canDecide}
        isOwner={isOwner}
      />
    </div>
  );
}
