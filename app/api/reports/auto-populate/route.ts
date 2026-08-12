import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { threeCountLine, pipelineByStage } from "@/lib/report-metrics";

/// Spec §10 — Monthly Report auto-populated numbers, per ICR × institution ×
/// reporting month. The response is the raw computed payload; the caller
/// stitches this into a MonthlyReport row (or a preview) and adds narrative.
const schema = z.object({
  icrId: z.string().optional(),
  institutionId: z.string().optional(),
  reportingMonth: z.number().int().min(1).max(12),
  reportingYear: z.number().int().min(2020).max(2035),
});

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const { role, id: userId } = session.user;
    if (!(await effectiveHasPermission(role as Role, "reports", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Composes an ICR's monthly performance figures, and accepts an arbitrary
    // icrId. INSTITUTION_CLIENT holds reports:read, so the module permission let a
    // partner university generate any ICR's metrics. Report authoring is internal.
    if (role === "INSTITUTION_CLIENT") {
      return NextResponse.json(
        { error: "Report drafting is not available to institution accounts" },
        { status: 403 }
      );
    }

    let body: unknown;
    try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten() }, { status: 422 });
    }

    const icrId = parsed.data.icrId ?? userId;
    const { institutionId, reportingMonth, reportingYear } = parsed.data;

    const from = new Date(reportingYear, reportingMonth - 1, 1);
    const to = new Date(reportingYear, reportingMonth, 0, 23, 59, 59);

    // Recruitment counts
    const scope = { assignedICRId: icrId, institutionId, from, to };
    const [threeCount, byStage, activitiesPlanned, activitiesCompleted, activitiesOverdue, schoolVisits, agentMeetings, events, weekly] = await Promise.all([
      threeCountLine(scope),
      pipelineByStage(scope),
      db.activity.count({ where: { userId: icrId, date: { gte: from, lte: to }, deletedAt: null } }),
      db.activity.count({ where: { userId: icrId, date: { gte: from, lte: to }, deletedAt: null, outcomes: { not: null } } }),
      db.activity.count({ where: { userId: icrId, date: { lt: from }, deletedAt: null, outcomes: null } }),
      db.activity.count({ where: { userId: icrId, type: "SCHOOL_VISIT", date: { gte: from, lte: to }, deletedAt: null } }),
      db.activity.count({ where: { userId: icrId, type: "AGENT_MEETING", date: { gte: from, lte: to }, deletedAt: null } }),
      db.event.count({ where: { date: { gte: from, lte: to }, assignedICRId: icrId, deletedAt: null } }),
      db.weeklyActivity.findMany({ where: { icrId, month: reportingMonth, year: reportingYear } }),
    ]);

    const completionRate = activitiesPlanned > 0 ? Math.round((activitiesCompleted / activitiesPlanned) * 100) : 0;

    return NextResponse.json({
      icrId, institutionId, reportingMonth, reportingYear,
      window: { from, to },
      recruitment: threeCount,
      pipelineByStage: byStage,
      serviceDelivery: {
        activitiesPlanned, activitiesCompleted, activitiesOverdue,
        completionRate,
        schoolVisits, agentMeetings, events,
      },
      weeklyActivities: weekly,
      note: "Numbers auto-generated from CRM data. Add narrative before submitting.",
    });
  } catch (err) {
    console.error("[POST /api/reports/auto-populate]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
