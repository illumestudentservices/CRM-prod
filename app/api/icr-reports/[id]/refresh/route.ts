import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import {
  computeAutoFilledSections,
  mergeRepEdits,
  asJson,
  fromJson,
  type AutoFilledSections,
} from "@/lib/icr-monthly-report";

/**
 * Re-read the CRM into the report.
 *
 * The stored figures are a snapshot taken when the report was generated. A rep
 * who then goes and tidies up their pipeline needs a way to pull the corrected
 * numbers in — but only while the report is still theirs. Once it is with a
 * manager the numbers are frozen, because a figure that moves after it was
 * submitted makes the approval meaningless.
 *
 * The rep's own typing survives the refresh (see mergeRepEdits): targets,
 * required actions, agent notes and event assessments are carried across.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { role, id: userId } = session.user as { role: Role; id: string };
    if (!(await effectiveHasPermission(role, "reports", "write"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { id } = await params;
    const report = await db.icrMonthlyReport.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true, icrId: true, status: true, reportingMonth: true, reportingYear: true,
        performance: true, priorityApplications: true, topAgents: true,
        atRiskAgents: true, eventActivities: true,
      },
    });
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    if (report.icrId !== userId && role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Only the report owner can refresh it" }, { status: 403 });
    }
    if (report.status !== "DRAFT" && report.status !== "RETURNED") {
      return NextResponse.json(
        { error: "A submitted report's figures are frozen and cannot be refreshed" },
        { status: 409 }
      );
    }

    const fresh = await computeAutoFilledSections(
      report.icrId,
      report.reportingYear,
      report.reportingMonth
    );
    const merged = mergeRepEdits(fresh, {
      performance: fromJson<AutoFilledSections["performance"]>(report.performance),
      priorityApplications: fromJson<AutoFilledSections["priorityApplications"]>(report.priorityApplications),
      topAgents: fromJson<AutoFilledSections["topAgents"]>(report.topAgents),
      atRiskAgents: fromJson<AutoFilledSections["atRiskAgents"]>(report.atRiskAgents),
      eventActivities: fromJson<AutoFilledSections["eventActivities"]>(report.eventActivities),
    });

    await db.icrMonthlyReport.update({
      where: { id },
      data: {
        performance: asJson(merged.performance),
        pipelineSnapshot: asJson(merged.pipelineSnapshot),
        institutionBreakdown: asJson(merged.institutionBreakdown),
        priorityApplications: asJson(merged.priorityApplications),
        agentEngagement: asJson(merged.agentEngagement),
        topAgents: asJson(merged.topAgents),
        atRiskAgents: asJson(merged.atRiskAgents),
        eventActivities: asJson(merged.eventActivities),
        refreshedAt: new Date(),
      },
    });

    return NextResponse.json({ refreshed: true, refreshedAt: new Date().toISOString() });
  } catch (error) {
    console.error("[icr-reports/id/refresh] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
