import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import type {
  AgentRow,
  AtRiskAgentRow,
  EventRow,
  PerformanceRow,
  PriorityApplicationRow,
} from "@/lib/icr-monthly-report";

/**
 * The editable surface of the report.
 *
 * Note what is NOT here: no client may send `performance`, `topAgents` or any
 * other computed array wholesale. The cells a rep is allowed to change are
 * addressed individually by key, and the server merges them into the stored
 * snapshot. Accepting the whole array would let a rep — or anything holding
 * their session — rewrite the CRM-derived figures a manager is about to
 * approve, and the report would silently stop being evidence.
 */
const patchSchema = z.object({
  intakesCovered: z.string().max(200).nullable().optional(),

  keyHighlights: z.string().max(20000).nullable().optional(),
  keyChallenges: z.string().max(20000).nullable().optional(),
  channelDevelopment: z.string().max(20000).nullable().optional(),
  businessDevelopment: z.string().max(20000).nullable().optional(),
  demandTrends: z.string().max(20000).nullable().optional(),
  competitiveActivity: z.string().max(20000).nullable().optional(),
  marketConditions: z.string().max(20000).nullable().optional(),
  priorityOne: z.string().max(5000).nullable().optional(),
  priorityTwo: z.string().max(5000).nullable().optional(),
  priorityThree: z.string().max(5000).nullable().optional(),
  supportRequested: z.string().max(20000).nullable().optional(),

  /** §1.1 — the one column of that table the CRM cannot fill. */
  performanceTargets: z.record(z.string(), z.number().int().min(0).max(1_000_000).nullable()).optional(),
  /** §1.3 — keyed by lead id. */
  priorityActions: z
    .record(
      z.string(),
      z.object({
        issue: z.string().max(2000).optional(),
        requiredAction: z.string().max(2000).optional(),
      })
    )
    .optional(),
  /** §2.2 — keyed by partner id. */
  agentNotes: z.record(z.string(), z.string().max(2000)).optional(),
  /** §2.3 — keyed by partner id. */
  atRiskPlans: z.record(z.string(), z.string().max(2000)).optional(),
  /** §3.1 — keyed by event id. */
  eventAssessments: z
    .record(
      z.string(),
      z.object({
        roiOutlook: z.string().max(100).optional(),
        quality: z.string().max(2000).optional(),
      })
    )
    .optional(),
});

function canRead(
  role: Role,
  userId: string,
  regionId: string | null,
  report: { icrId: string; regionId: string | null }
): boolean {
  if (role === "SUPER_ADMIN" || role === "HQ_EXECUTIVE" || role === "HQ_ANALYTICS" || role === "VP_GLOBAL_SALES") {
    return true;
  }
  if (role === "ICR") return report.icrId === userId;
  if (role === "REGIONAL_MANAGER") return regionId != null && report.regionId === regionId;
  return false;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { role, id: userId, regionId } = session.user as {
      role: Role;
      id: string;
      regionId: string | null;
    };
    if (!(await effectiveHasPermission(role, "reports", "read"))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });
    if (!canRead(role, userId, regionId, report)) {
      // 404 rather than 403 — a rep should not be able to discover that another
      // rep filed a report for a given month by probing ids.
      return NextResponse.json({ error: "Report not found" }, { status: 404 });
    }

    return NextResponse.json(report);
  } catch (error) {
    console.error("[icr-reports/id] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
        id: true,
        icrId: true,
        status: true,
        performance: true,
        priorityApplications: true,
        topAgents: true,
        atRiskAgents: true,
        eventActivities: true,
      },
    });
    if (!report) return NextResponse.json({ error: "Report not found" }, { status: 404 });

    if (report.icrId !== userId && role !== "SUPER_ADMIN") {
      return NextResponse.json({ error: "Only the report owner can edit it" }, { status: 403 });
    }
    // Once submitted the report is a record of what was said, not a document.
    // Editing it while a manager reads it would mean the approval attaches to
    // something other than what was approved.
    if (report.status !== "DRAFT" && report.status !== "RETURNED") {
      return NextResponse.json(
        { error: "This report has been submitted and can no longer be edited" },
        { status: 409 }
      );
    }

    const parsed = patchSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });
    }
    const body = parsed.data;

    const data: Record<string, unknown> = {};
    for (const field of [
      "intakesCovered",
      "keyHighlights", "keyChallenges", "channelDevelopment", "businessDevelopment",
      "demandTrends", "competitiveActivity", "marketConditions",
      "priorityOne", "priorityTwo", "priorityThree", "supportRequested",
    ] as const) {
      if (body[field] !== undefined) data[field] = body[field];
    }

    // ── Merge the editable cells into the stored snapshots ──────────────────
    if (body.performanceTargets) {
      const rows = (report.performance ?? []) as unknown as PerformanceRow[];
      data.performance = rows.map((r) =>
        r.key in body.performanceTargets! ? { ...r, target: body.performanceTargets![r.key] } : r
      );
    }
    if (body.priorityActions) {
      const rows = (report.priorityApplications ?? []) as unknown as PriorityApplicationRow[];
      data.priorityApplications = rows.map((r) => {
        const edit = body.priorityActions![r.leadId];
        return edit ? { ...r, ...edit } : r;
      });
    }
    if (body.agentNotes) {
      const rows = (report.topAgents ?? []) as unknown as AgentRow[];
      data.topAgents = rows.map((r) =>
        r.partnerId in body.agentNotes! ? { ...r, note: body.agentNotes![r.partnerId] } : r
      );
    }
    if (body.atRiskPlans) {
      const rows = (report.atRiskAgents ?? []) as unknown as AtRiskAgentRow[];
      data.atRiskAgents = rows.map((r) =>
        r.partnerId in body.atRiskPlans! ? { ...r, actionPlan: body.atRiskPlans![r.partnerId] } : r
      );
    }
    if (body.eventAssessments) {
      const rows = (report.eventActivities ?? []) as unknown as EventRow[];
      data.eventActivities = rows.map((r) => {
        const edit = body.eventAssessments![r.eventId];
        return edit ? { ...r, ...edit } : r;
      });
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const updated = await db.icrMonthlyReport.update({
      where: { id },
      data,
      select: { id: true, updatedAt: true },
    });
    return NextResponse.json(updated);
  } catch (error) {
    console.error("[icr-reports/id] PATCH error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
