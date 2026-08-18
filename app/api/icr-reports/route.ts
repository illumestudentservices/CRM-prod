import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import { computeAutoFilledSections, asJson } from "@/lib/icr-monthly-report";

const createSchema = z.object({
  reportingMonth: z.number().int().min(1).max(12),
  reportingYear: z.number().int().min(2020).max(2035),
  intakesCovered: z.string().max(200).optional(),
});

/**
 * Who may see whose report.
 *
 * Fails closed: a role that is not named here sees nothing, rather than seeing
 * everything. Adding a role to the system should not silently hand it every
 * rep's monthly report.
 */
function scopeFilter(role: Role, userId: string, regionId: string | null) {
  switch (role) {
    case "ICR":
      return { icrId: userId };
    case "REGIONAL_MANAGER":
      // A manager with no region set sees nothing rather than everything.
      return { regionId: regionId ?? "__no_region__" };
    case "SUPER_ADMIN":
    case "HQ_EXECUTIVE":
    case "HQ_ANALYTICS":
    case "VP_GLOBAL_SALES":
      return {};
    default:
      return { id: "__no_access__" };
  }
}

export async function GET(req: NextRequest) {
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

    const { searchParams } = req.nextUrl;
    const status = searchParams.get("status");
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
    const limit = Math.min(50, parseInt(searchParams.get("limit") ?? "20"));

    const where = {
      ...scopeFilter(role, userId, regionId),
      ...(status ? { status: status as never } : {}),
      deletedAt: null,
    };

    const [reports, total] = await Promise.all([
      db.icrMonthlyReport.findMany({
        where,
        skip: (page - 1) * limit,
        take: limit,
        orderBy: [{ reportingYear: "desc" }, { reportingMonth: "desc" }],
        select: {
          id: true,
          reportingMonth: true,
          reportingYear: true,
          status: true,
          intakesCovered: true,
          submittedAt: true,
          finalApprovedAt: true,
          updatedAt: true,
          icr: { select: { id: true, name: true, email: true } },
          region: { select: { id: true, name: true } },
        },
      }),
      db.icrMonthlyReport.count({ where }),
    ]);

    return NextResponse.json({
      reports,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    });
  } catch (error) {
    console.error("[icr-reports] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { role, id: userId, regionId } = session.user as {
      role: Role;
      id: string;
      regionId: string | null;
    };

    if (!(await effectiveHasPermission(role, "reports", "write"))) {
      return NextResponse.json({ error: "You do not have permission to create reports" }, { status: 403 });
    }
    // The report is the rep's own account of their month, so only the rep files
    // it. A manager creating one on someone's behalf would put words in their
    // mouth and then ask them to approve it.
    if (role !== "ICR" && role !== "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "Only an ICR can file an ICR monthly report" },
        { status: 403 }
      );
    }

    const parsed = createSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });
    }
    const { reportingMonth, reportingYear, intakesCovered } = parsed.data;

    // A period that has not finished cannot be reported on honestly — the
    // figures would change after the manager read them.
    const now = new Date();
    const periodStart = new Date(reportingYear, reportingMonth - 1, 1);
    if (periodStart > now) {
      return NextResponse.json(
        { error: "That reporting period has not started yet" },
        { status: 400 }
      );
    }

    const existing = await db.icrMonthlyReport.findFirst({
      where: { icrId: userId, reportingMonth, reportingYear, deletedAt: null },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: "You already have a report for this period", reportId: existing.id },
        { status: 409 }
      );
    }

    const sections = await computeAutoFilledSections(userId, reportingYear, reportingMonth);

    const report = await db.icrMonthlyReport.create({
      data: {
        icrId: userId,
        regionId: regionId ?? undefined,
        reportingMonth,
        reportingYear,
        intakesCovered: intakesCovered ?? null,
        status: "DRAFT",
        performance: asJson(sections.performance),
        pipelineSnapshot: asJson(sections.pipelineSnapshot),
        institutionBreakdown: asJson(sections.institutionBreakdown),
        priorityApplications: asJson(sections.priorityApplications),
        agentEngagement: asJson(sections.agentEngagement),
        topAgents: asJson(sections.topAgents),
        atRiskAgents: asJson(sections.atRiskAgents),
        eventActivities: asJson(sections.eventActivities),
      },
      select: { id: true },
    });

    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    console.error("[icr-reports] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
