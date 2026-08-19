import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Role } from "@/lib/permissions";
import { NO_REGION } from "@/lib/region-scope";

export async function GET(req: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { role, id: userId, regionId: userRegionId } = session.user as {
      role: Role;
      id: string;
      regionId: string | null;
    };

    // Only RM and above can access regional analytics
    const allowedRoles: Role[] = ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER"];
    if (!allowedRoles.includes(role)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = req.nextUrl;
    const regionIdParam = searchParams.get("regionId");

    // Determine region scope.
    //
    // For a Regional Manager this is a scope, not a filter: it is not theirs to
    // widen, and `null` must mean "no region" rather than "every region". It
    // used to fall through to `{}` below, which served a manager with no region
    // the organisation-wide numbers on a screen titled Regional. For the HQ
    // roles the parameter really is an optional filter, and `{}` there
    // correctly means unfiltered. See lib/region-scope.ts.
    let regionId: string | null = null;
    if (role === "REGIONAL_MANAGER") {
      regionId = userRegionId ?? NO_REGION;
    } else if (regionIdParam) {
      regionId = regionIdParam;
    }

    const regionFilter = regionId ? { regionId } : {};

    const now = new Date();
    const ytdStart = new Date(now.getFullYear(), 0, 1);

    type StageRow = { stage: string; _count: { stage: number } };
    type ICRUser = { id: string; name: string | null; email: string };
    type SourceRow = { sourceId: string | null; _count: { sourceId: number } };

    const regionalResults = await Promise.all([
      db.lead.groupBy({ by: ["stage"], where: { ...regionFilter, deletedAt: null }, _count: { stage: true } }),
      db.user.findMany({ where: { role: "ICR", isActive: true, ...(regionId ? { regionId } : {}) }, select: { id: true, name: true, email: true } }),
      db.lead.groupBy({ by: ["sourceId"], where: { ...regionFilter, deletedAt: null, sourceId: { not: null } }, _count: { sourceId: true }, orderBy: { _count: { sourceId: "desc" } }, take: 10 }),
      db.event.findMany({ where: { ...regionFilter, deletedAt: null, date: { gte: now }, status: { in: ["PLANNED", "CONFIRMED"] } }, orderBy: { date: "asc" }, take: 10, select: { id: true, name: true, type: true, date: true, city: true, country: true, status: true } }),
      db.monthlyReport.findMany({ where: { ...(regionId ? { regionId } : {}), status: { in: ["PENDING_REVIEW", "REGIONAL_APPROVED"] }, deletedAt: null }, orderBy: { submittedAt: "asc" }, take: 20, include: { icr: { select: { id: true, name: true } }, institution: { select: { id: true, name: true } } } }),
    ]);

    const pipelineByStageRaw = regionalResults[0] as StageRow[];
    const icrUsers = regionalResults[1] as ICRUser[];
    const sourceGroupsRaw = regionalResults[2] as SourceRow[];
    const upcomingEvents = regionalResults[3];
    const pendingReports = regionalResults[4];

    // ── ICR performance ────────────────────────────────────────────────────
    type ICRGroupBy = { assignedICRId: string | null; _count: { assignedICRId: number } };
    const icrIds = icrUsers.map((u) => u.id);
    const icrResults = await Promise.all([
      db.lead.groupBy({ by: ["assignedICRId"], where: { assignedICRId: { in: icrIds }, deletedAt: null, createdAt: { gte: ytdStart } }, _count: { assignedICRId: true } }),
      db.lead.groupBy({ by: ["assignedICRId"], where: { assignedICRId: { in: icrIds }, deletedAt: null, stage: "ENROLLED", createdAt: { gte: ytdStart } }, _count: { assignedICRId: true } }),
    ]);
    const icrLeads = icrResults[0] as ICRGroupBy[];
    const icrEnrolled = icrResults[1] as ICRGroupBy[];

    const icrLeadsMap: Record<string, number> = {};
    const icrEnrolledMap: Record<string, number> = {};
    for (const l of icrLeads) {
      if (l.assignedICRId) icrLeadsMap[l.assignedICRId] = l._count.assignedICRId;
    }
    for (const e of icrEnrolled) {
      if (e.assignedICRId) icrEnrolledMap[e.assignedICRId] = e._count.assignedICRId;
    }

    const icrPerformance = icrUsers.map((user) => ({
      icrId: user.id,
      name: user.name ?? user.email,
      leads: icrLeadsMap[user.id] ?? 0,
      enrolled: icrEnrolledMap[user.id] ?? 0,
      conversionRate:
        (icrLeadsMap[user.id] ?? 0) > 0
          ? Math.round(((icrEnrolledMap[user.id] ?? 0) / (icrLeadsMap[user.id] ?? 0)) * 100)
          : 0,
    }));

    // ── Source performance formatted ────────────────────────────────────────
    const sourceIds = sourceGroupsRaw.map((g) => g.sourceId).filter(Boolean) as string[];
    const sourcesData = await db.recruitmentPartner.findMany({
      where: { id: { in: sourceIds } },
      select: { id: true, name: true, type: true },
    });
    const sourceMap: Record<string, { name: string; type: string }> = {};
    for (const s of sourcesData) {
      sourceMap[s.id] = { name: s.name, type: s.type };
    }

    type SrcEnrolled = { sourceId: string | null; _count: { sourceId: number } };
    const enrolledBySourceRaw = await db.lead.groupBy({
      by: ["sourceId"],
      where: {
        ...regionFilter,
        deletedAt: null,
        stage: "ENROLLED",
        sourceId: { in: sourceIds },
      },
      _count: { sourceId: true },
    });
    const enrolledBySource = enrolledBySourceRaw as SrcEnrolled[];
    const enrolledSrcMap: Record<string, number> = {};
    for (const e of enrolledBySource) {
      if (e.sourceId) enrolledSrcMap[e.sourceId] = e._count.sourceId;
    }

    const sourcePerformance = sourceGroupsRaw.map((g) => ({
      sourceId: g.sourceId,
      name: g.sourceId ? (sourceMap[g.sourceId]?.name ?? "Unknown") : "Unknown",
      type: g.sourceId ? (sourceMap[g.sourceId]?.type ?? "") : "",
      leads: g._count.sourceId,
      enrolled: g.sourceId ? (enrolledSrcMap[g.sourceId] ?? 0) : 0,
      conversionRate:
        g._count.sourceId > 0
          ? Math.round(((g.sourceId ? (enrolledSrcMap[g.sourceId] ?? 0) : 0) / g._count.sourceId) * 100)
          : 0,
    }));

    // ── Pipeline by stage formatted ────────────────────────────────────────
    const pipelineByStage = pipelineByStageRaw.map((s) => ({
      stage: s.stage,
      count: s._count.stage,
    }));

    return NextResponse.json({
      pipelineByStage,
      icrPerformance,
      sourcePerformance,
      upcomingEvents,
      pendingReports: (pendingReports as Array<{ id: string; reportingMonth: number; reportingYear: number; status: string; submittedAt: Date | null; icr: { id: string; name: string | null }; institution: { id: string; name: string } }>).map((r) => ({
        id: r.id,
        icrName: r.icr.name,
        institutionName: r.institution.name,
        reportingMonth: r.reportingMonth,
        reportingYear: r.reportingYear,
        status: r.status,
        submittedAt: r.submittedAt,
      })),
    });
  } catch (error) {
    console.error("[analytics/regional] GET error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
