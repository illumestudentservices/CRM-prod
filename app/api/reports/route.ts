import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

const createReportSchema = z.object({
  institutionId: z.string().min(1),
  reportingMonth: z.number().int().min(1).max(12),
  reportingYear: z.number().int().min(2020).max(2035),
});

function buildReportScopeFilter(role: Role, userId: string, regionId: string | null) {
  switch (role) {
    case "ICR":
      return { icrId: userId };
    case "REGIONAL_MANAGER":
      return regionId ? { regionId } : {};
    default:
      return {};
  }
}

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId, regionId } = session.user as {
      role: Role;
      id: string;
      regionId: string | null;
    };

    if (!await effectiveHasPermission(role, "reports", "read")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = req.nextUrl;
    const statusParam = searchParams.get("status");
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1"));
    const limit = Math.min(50, parseInt(searchParams.get("limit") ?? "20"));
    const skip = (page - 1) * limit;

    const scopeFilter = buildReportScopeFilter(role, userId, regionId);

    // For HQ roles viewing the queue, filter to relevant statuses
    let statusFilter = {};
    if (statusParam) {
      statusFilter = { status: statusParam };
    } else if (role === "REGIONAL_MANAGER") {
      statusFilter = { status: { in: ["PENDING_REVIEW", "REGIONAL_APPROVED", "RETURNED", "DRAFT", "HQ_REVIEW", "FINAL_APPROVED"] } };
    } else if (role === "HQ_EXECUTIVE" || role === "HQ_ANALYTICS") {
      statusFilter = { status: { in: ["REGIONAL_APPROVED", "HQ_REVIEW", "FINAL_APPROVED", "RETURNED"] } };
    }

    const where = { ...scopeFilter, ...statusFilter, deletedAt: null };

    const [reports, total] = await Promise.all([
      db.monthlyReport.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        include: {
          icr: { select: { id: true, name: true, email: true } },
          institution: { select: { id: true, name: true } },
          region: { select: { id: true, name: true } },
          approvals: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { user: { select: { name: true } } },
          },
        },
      }),
      db.monthlyReport.count({ where }),
    ]);

    // ── Status summary counts ───────────────────────────────────────────────
    const summaryBase = buildReportScopeFilter(role, userId, regionId);
    const [draft, pendingReview, approved, returned] = await Promise.all([
      db.monthlyReport.count({ where: { ...summaryBase, status: "DRAFT", deletedAt: null } }),
      db.monthlyReport.count({ where: { ...summaryBase, status: "PENDING_REVIEW", deletedAt: null } }),
      db.monthlyReport.count({ where: { ...summaryBase, status: "FINAL_APPROVED", deletedAt: null } }),
      db.monthlyReport.count({ where: { ...summaryBase, status: "RETURNED", deletedAt: null } }),
    ]);

    return NextResponse.json({
      reports,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      summary: { draft, pendingReview, approved, returned },
    });
  } catch (error) {
    console.error("[reports] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId, regionId } = session.user as {
      role: Role;
      id: string;
      regionId: string | null;
    };

    if (!await effectiveHasPermission(role, "reports", "write")) {
      return NextResponse.json({ error: "You do not have permission to create reports" }, { status: 403 });
    }

    const body = await req.json();
    const parsed = createReportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: "Invalid data", details: parsed.error.flatten() }, { status: 400 });
    }

    const { institutionId, reportingMonth, reportingYear } = parsed.data;

    // Check for duplicate
    const existing = await db.monthlyReport.findFirst({
      where: { icrId: userId, institutionId, reportingMonth, reportingYear, deletedAt: null },
    });
    if (existing) {
      return NextResponse.json(
        { error: "A report for this institution and period already exists", reportId: existing.id },
        { status: 409 }
      );
    }

    // Pre-populate data
    const periodStart = new Date(reportingYear, reportingMonth - 1, 1);
    const periodEnd = new Date(reportingYear, reportingMonth, 0, 23, 59, 59);

    const leads = await db.lead.findMany({
      where: {
        ...(role === "ICR" ? { assignedICRId: userId } : {}),
        institutionId,
        deletedAt: null,
        createdAt: { gte: periodStart, lte: periodEnd },
      },
      select: {
        id: true,
        fullName: true,
        email: true,
        stage: true,
        studyLevel: true,
        interestedProgram: true,
        nationality: true,
        countryOfResidence: true,
        createdAt: true,
        source: { select: { id: true, name: true } },
      },
    });

    type LeadSelectRow = { id: string; fullName: string; email: string; stage: string; studyLevel: string; interestedProgram: string; nationality: string; countryOfResidence: string; createdAt: Date; source: { id: string; name: string } | null };
    const typedLeadsForBreakdown = leads as LeadSelectRow[];

    // Program breakdown
    const programMap: Record<string, { count: number; levels: Record<string, number> }> = {};
    for (const lead of typedLeadsForBreakdown) {
      const prog = lead.interestedProgram;
      if (!programMap[prog]) programMap[prog] = { count: 0, levels: {} };
      programMap[prog].count++;
      const lvl = lead.studyLevel;
      programMap[prog].levels[lvl] = (programMap[prog].levels[lvl] ?? 0) + 1;
    }

    // Source performance
    const sourcePerf: Record<string, { name: string; leads: number; enrolled: number }> = {};
    for (const lead of typedLeadsForBreakdown) {
      if (lead.source) {
        const sid = lead.source.id;
        if (!sourcePerf[sid]) sourcePerf[sid] = { name: lead.source.name, leads: 0, enrolled: 0 };
        sourcePerf[sid].leads++;
        if (lead.stage === "ENROLLED") sourcePerf[sid].enrolled++;
      }
    }

    // Event activities
    const events = await db.event.findMany({
      where: {
        ...(role === "ICR" ? { assignedICRId: userId } : {}),
        deletedAt: null,
        date: { gte: periodStart, lte: periodEnd },
      },
      select: {
        id: true,
        name: true,
        type: true,
        date: true,
        city: true,
        country: true,
        totalCost: true,
        leads: { select: { id: true } },
      },
    });

    type EventRow = { id: string; name: string; type: string; date: Date; city: string; country: string; totalCost: number; leads: { id: string }[] };
    const typedEvents = events as EventRow[];

    const eventActivities = typedEvents.map((e) => ({
      id: e.id,
      name: e.name,
      type: e.type,
      date: e.date,
      location: `${e.city}, ${e.country}`,
      cost: e.totalCost,
      leadsGenerated: e.leads.length,
      roi: e.totalCost > 0 ? parseFloat((e.leads.length / e.totalCost).toFixed(4)) : null,
    }));

    // KPI summary
    type LeadRow = { id: string; fullName: string; email: string; stage: string; studyLevel: string; interestedProgram: string; nationality: string; countryOfResidence: string; createdAt: Date; source: { id: string; name: string } | null };
    const typedLeads = leads as LeadRow[];
    const totalLeads = typedLeads.length;
    const enrolled = typedLeads.filter((l) => l.stage === "ENROLLED").length;
    const contacted = typedLeads.filter((l) => l.stage !== "NEW").length;

    const kpiSummary = {
      totalLeads,
      enrolled,
      conversionRate: totalLeads > 0 ? parseFloat(((enrolled / totalLeads) * 100).toFixed(1)) : 0,
      contactRate: totalLeads > 0 ? parseFloat(((contacted / totalLeads) * 100).toFixed(1)) : 0,
      eventsCount: typedEvents.length,
      totalEventCost: typedEvents.reduce((sum: number, e: EventRow) => sum + e.totalCost, 0),
    };

    const report = await db.monthlyReport.create({
      data: {
        icrId: userId,
        institutionId,
        regionId: regionId ?? undefined,
        reportingMonth,
        reportingYear,
        status: "DRAFT",
        leadsData: typedLeadsForBreakdown as unknown as object,
        programBreakdown: Object.entries(programMap).map(([program, data]) => ({
          program,
          ...data,
        })) as unknown as object,
        sourcePerformance: Object.values(sourcePerf) as unknown as object,
        eventActivities: eventActivities as unknown as object,
        kpiSummary: kpiSummary as unknown as object,
      },
    });

    return NextResponse.json(report, { status: 201 });
  } catch (error) {
    console.error("[reports] POST error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
