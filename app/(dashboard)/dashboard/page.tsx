import { auth } from "@/lib/auth";
import { ALL_STAGES, stageBadgeClass, stageLabel, PIPELINE_STAGES } from "@/lib/lead-pipeline";

/** Live stages where a student is actively being worked. */
const IN_PROGRESS_STAGES = PIPELINE_STAGES.slice(1, -1);
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import Link from "next/link";
import { effectiveHasPermission } from "@/lib/effective-permissions";
import {
  Users,
  GraduationCap,
  Building2,
  CalendarDays,
  TrendingUp,
  ClipboardList,
  Briefcase,
  CheckSquare,
  AlertTriangle,
  Star,
  BarChart3,
  FileText,
  Bell,
  Laptop,
  Sun,
  CalendarCheck,
  Clock,
} from "lucide-react";
import { StatCard } from "@/components/shared/stat-card";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { Role } from "@/lib/permissions";
import { AnnouncementsFeed } from "@/components/shared/announcements-feed";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function startOfMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}
function startOfLastMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth() - 1, 1);
}
function endOfLastMonth(date: Date) {
  return new Date(date.getFullYear(), date.getMonth(), 0, 23, 59, 59, 999);
}
function calcChange(current: number, previous: number): number {
  if (previous === 0) return current > 0 ? 100 : 0;
  return Math.round(((current - previous) / previous) * 100 * 10) / 10;
}

// ─── Stage helpers ────────────────────────────────────────────────────────────

// Stage presentation and ordering come from lib/lead-pipeline.ts so a future
// enum change fails the build here rather than silently rendering nothing.
const stageOrder = ALL_STAGES;

const accountStatusColors: Record<string, string> = {
  ACTIVE: "bg-emerald-100 text-emerald-700",
  RENEWAL_DUE: "bg-amber-100 text-amber-700",
  CHURNED: "bg-red-100 text-red-700",
  PROSPECT: "bg-blue-100 text-blue-700",
};

// ─── Executive data loader ─────────────────────────────────────────────────────

async function getExecutiveDashboardData(regionId?: string | null) {
  const now = new Date();
  const thisMonthStart = startOfMonth(now);
  const lastMonthStart = startOfLastMonth(now);
  const lastMonthEnd = endOfLastMonth(now);
  const currentYear = now.getFullYear();

  const geoFilter = regionId ? { regionId } : {};
  const leadScope = { deletedAt: null as null, ...geoFilter };

  const [
    totalLeads,
    leadsThisMonth,
    leadsLastMonth,
    enrolled,
    enrolledLastMonth,
    activeInstitutions,
    topInstRaw,
    attentionInstitutions,
    topICRsRaw,
    stageGroups,
    recentLeads,
  ] = await Promise.all([
    db.lead.count({ where: leadScope }),
    db.lead.count({ where: { ...leadScope, createdAt: { gte: thisMonthStart } } }),
    db.lead.count({ where: { ...leadScope, createdAt: { gte: lastMonthStart, lte: lastMonthEnd } } }),
    db.lead.count({ where: { ...leadScope, stage: "ENROLLED" } }),
    db.lead.count({ where: { ...leadScope, stage: "ENROLLED", updatedAt: { gte: lastMonthStart, lte: lastMonthEnd } } }),
    db.institution.count({ where: { deletedAt: null, accountStatus: "ACTIVE", ...geoFilter } }),
    // Top institutions by enrolled count
    db.lead.groupBy({
      by: ["institutionId"],
      where: { ...leadScope, stage: "ENROLLED", institutionId: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 6,
    }),
    // Institutions needing attention
    db.institution.findMany({
      where: {
        deletedAt: null,
        ...geoFilter,
        OR: [{ accountStatus: "RENEWAL_DUE" }, { accountStatus: "CHURNED" }],
      },
      select: { id: true, name: true, accountStatus: true, country: true },
      take: 6,
    }),
    // Top ICRs by enrolled count
    db.lead.groupBy({
      by: ["assignedICRId"],
      where: { ...leadScope, stage: "ENROLLED", assignedICRId: { not: null } },
      _count: { id: true },
      orderBy: { _count: { id: "desc" } },
      take: 5,
    }),
    // Stage breakdown
    db.lead.groupBy({
      by: ["stage"],
      where: leadScope,
      _count: { stage: true },
    }),
    // Recent leads
    db.lead.findMany({
      where: leadScope,
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        fullName: true,
        stage: true,
        createdAt: true,
        institution: { select: { name: true } },
        assignedICR: { select: { name: true } },
      },
    }),
  ]);

  // Enrich top institutions
  const instIds = topInstRaw.map((t) => t.institutionId).filter(Boolean) as string[];
  const [instDetails, enrollTargets] = await Promise.all([
    db.institution.findMany({
      where: { id: { in: instIds } },
      select: { id: true, name: true, country: true, accountStatus: true },
    }),
    db.enrollmentTarget.findMany({
      where: { institutionId: { in: instIds }, year: currentYear },
      select: { institutionId: true, target: true, actual: true },
    }),
  ]);

  const topInstitutions = topInstRaw.map((t) => {
    const inst = instDetails.find((i) => i.id === t.institutionId);
    const target = enrollTargets.find((tg) => tg.institutionId === t.institutionId);
    return {
      id: t.institutionId!,
      name: inst?.name ?? "Unknown",
      country: inst?.country ?? "",
      enrolled: t._count.id,
      target: target?.target ?? null,
    };
  });

  // Enrich top ICRs
  const icrIds = topICRsRaw.map((t) => t.assignedICRId).filter(Boolean) as string[];
  const [icrUsers, icrTotalLeads] = await Promise.all([
    db.user.findMany({
      where: { id: { in: icrIds } },
      select: { id: true, name: true },
    }),
    db.lead.groupBy({
      by: ["assignedICRId"],
      where: { ...leadScope, assignedICRId: { in: icrIds } },
      _count: { id: true },
    }),
  ]);

  const topICRs = topICRsRaw.map((t) => {
    const user = icrUsers.find((u) => u.id === t.assignedICRId);
    const totalEntry = icrTotalLeads.find((lt) => lt.assignedICRId === t.assignedICRId);
    const total = totalEntry?._count.id ?? 0;
    return {
      id: t.assignedICRId!,
      name: user?.name ?? "Unknown",
      enrolled: t._count.id,
      total,
      conversionRate: total > 0 ? Math.round((t._count.id / total) * 100) : 0,
    };
  });

  const pipeline = stageGroups.reduce((acc, s) => {
    acc[s.stage] = s._count.stage;
    return acc;
  }, {} as Record<string, number>);

  const conversionRate =
    totalLeads > 0 ? Math.round((enrolled / totalLeads) * 100) : 0;

  return {
    stats: {
      totalLeads,
      leadsThisMonth,
      leadsLastMonth,
      enrolled,
      enrolledLastMonth,
      activeInstitutions,
      conversionRate,
    },
    topInstitutions,
    attentionInstitutions,
    topICRs,
    pipeline,
    recentLeads,
  };
}

// ─── ICR data loader ───────────────────────────────────────────────────────────

async function getICRDashboardData(userId: string) {
  const now = new Date();
  const thisMonthStart = startOfMonth(now);
  const lastMonthStart = startOfLastMonth(now);
  const lastMonthEnd = endOfLastMonth(now);

  const where = { deletedAt: null as null, assignedICRId: userId };

  const [
    totalLeads,
    leadsThisMonth,
    leadsLastMonth,
    enrolled,
    inProgress,
    upcomingEvents,
    stageGroups,
    recentLeads,
    pendingReports,
  ] = await Promise.all([
    db.lead.count({ where }),
    db.lead.count({ where: { ...where, createdAt: { gte: thisMonthStart } } }),
    db.lead.count({ where: { ...where, createdAt: { gte: lastMonthStart, lte: lastMonthEnd } } }),
    db.lead.count({ where: { ...where, stage: "ENROLLED" } }),
    db.lead.count({
      where: {
        ...where,
        stage: { in: IN_PROGRESS_STAGES },
      },
    }),
    db.event.count({
      where: { deletedAt: null, assignedICRId: userId, date: { gte: now }, status: { in: ["PLANNED", "CONFIRMED"] } },
    }),
    db.lead.groupBy({ by: ["stage"], where, _count: { stage: true } }),
    db.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 6,
      select: {
        id: true,
        fullName: true,
        stage: true,
        createdAt: true,
        institution: { select: { name: true } },
      },
    }),
    db.monthlyReport.count({
      where: { icrId: userId, status: { in: ["DRAFT", "PENDING_REVIEW"] } },
    }),
  ]);

  const pipeline = stageGroups.reduce((acc, s) => {
    acc[s.stage] = s._count.stage;
    return acc;
  }, {} as Record<string, number>);

  const conversionRate =
    totalLeads > 0 ? Math.round((enrolled / totalLeads) * 100) : 0;

  return {
    stats: {
      totalLeads,
      leadsThisMonth,
      leadsLastMonth,
      enrolled,
      inProgress,
      upcomingEvents,
      conversionRate,
    },
    pipeline,
    recentLeads,
    pendingReports,
  };
}

// ─── ERP data loader ───────────────────────────────────────────────────────────

async function getERPDashboardData(userId: string, regionId?: string | null) {
  const employee = await db.employee.findUnique({
    where: { userId },
    select: { id: true, jobTitle: true, department: { select: { name: true } } },
  });

  if (!employee) {
    return { employee: null, stats: null, leaveBalances: [], leaveRequests: [], holidays: [], assets: [] };
  }

  const now = new Date();
  const currentYear = now.getFullYear();
  const sixtyDaysOut = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  const [openTasks, pendingLeaves, travelRequests, leaveBalances, leaveRequests, holidays, assets] =
    await Promise.all([
      db.task.count({
        where: { assigneeId: employee.id, status: { in: ["TODO", "IN_PROGRESS"] }, deletedAt: null },
      }),
      db.leaveRequest.count({
        where: { employeeId: employee.id, status: "PENDING" },
      }),
      db.travelRequest.count({
        where: { employeeId: employee.id, status: { in: ["PENDING", "APPROVED"] } },
      }),
      db.leaveBalance.findMany({
        where: { employeeId: employee.id, year: currentYear },
        select: { leaveType: true, totalDays: true, usedDays: true, pendingDays: true },
      }),
      db.leaveRequest.findMany({
        where: { employeeId: employee.id },
        orderBy: { createdAt: "desc" },
        take: 6,
        select: { id: true, leaveType: true, startDate: true, endDate: true, days: true, status: true },
      }),
      db.holiday.findMany({
        where: {
          date: { gte: now, lte: sixtyDaysOut },
          OR: [{ isGlobal: true }, ...(regionId ? [{ regionId }] : [])],
        },
        orderBy: { date: "asc" },
        take: 6,
        select: { id: true, name: true, date: true, isGlobal: true },
      }),
      db.assetAssignment.findMany({
        where: { employeeId: employee.id, returnedAt: null },
        select: {
          id: true,
          assignedAt: true,
          asset: { select: { id: true, name: true, type: true, brand: true, model: true, serialNumber: true } },
        },
      }),
    ]);

  return {
    employee: { jobTitle: employee.jobTitle, department: employee.department?.name },
    stats: { openTasks, pendingLeaves, travelRequests },
    leaveBalances,
    leaveRequests,
    holidays,
    assets,
  };
}

// ─── Personal data loader (for ICR role) ──────────────────────────────────────

async function getPersonalData(userId: string, regionId?: string | null) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const sixtyDaysOut = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);

  const employee = await db.employee.findUnique({
    where: { userId },
    select: { id: true },
  });

  const holidayWhere = {
    date: { gte: now, lte: sixtyDaysOut },
    OR: [{ isGlobal: true }, ...(regionId ? [{ regionId }] : [])],
  };

  if (!employee) {
    const holidays = await db.holiday.findMany({
      where: holidayWhere,
      orderBy: { date: "asc" },
      take: 6,
      select: { id: true, name: true, date: true, isGlobal: true },
    });
    return { leaveBalances: [], leaveRequests: [], holidays, assets: [] };
  }

  const [leaveBalances, leaveRequests, holidays, assets] = await Promise.all([
    db.leaveBalance.findMany({
      where: { employeeId: employee.id, year: currentYear },
      select: { leaveType: true, totalDays: true, usedDays: true, pendingDays: true },
    }),
    db.leaveRequest.findMany({
      where: { employeeId: employee.id },
      orderBy: { createdAt: "desc" },
      take: 6,
      select: { id: true, leaveType: true, startDate: true, endDate: true, days: true, status: true },
    }),
    db.holiday.findMany({
      where: holidayWhere,
      orderBy: { date: "asc" },
      take: 6,
      select: { id: true, name: true, date: true, isGlobal: true },
    }),
    db.assetAssignment.findMany({
      where: { employeeId: employee.id, returnedAt: null },
      select: {
        id: true,
        assignedAt: true,
        asset: { select: { id: true, name: true, type: true, brand: true, model: true, serialNumber: true } },
      },
    }),
  ]);

  return { leaveBalances, leaveRequests, holidays, assets };
}

// ─── Shared UI: Recent Leads card ─────────────────────────────────────────────

function RecentLeadsCard({
  leads,
  showICR = false,
}: {
  leads: {
    id: string;
    fullName: string;
    stage: string;
    createdAt: Date;
    institution: { name: string } | null;
    assignedICR?: { name: string | null } | null;
  }[];
  showICR?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base font-semibold text-slate-900">Recent Leads</CardTitle>
        <Link href="/students" className="text-xs text-[#0EA5E9] hover:underline font-medium">
          View all →
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        <div className="divide-y divide-slate-100">
          {leads.map((lead) => (
            <Link
              key={lead.id}
              href={`/students/${lead.id}`}
              className="flex items-center justify-between px-6 py-3 gap-4 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-8 w-8 rounded-full bg-[#1E3A5F]/10 flex items-center justify-center shrink-0">
                  <span className="text-xs font-semibold text-[#1E3A5F]">
                    {lead.fullName
                      .split(" ")
                      .map((n) => n[0])
                      .slice(0, 2)
                      .join("")
                      .toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">{lead.fullName}</p>
                  <p className="text-xs text-slate-500 truncate">
                    {lead.institution?.name ?? "No institution"}
                    {showICR && lead.assignedICR?.name && (
                      <span className="ml-1 text-slate-400">· {lead.assignedICR.name}</span>
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span
                  className={[
                    "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                    stageBadgeClass(lead.stage) ?? "bg-slate-100 text-slate-700",
                  ].join(" ")}
                >
                  {stageLabel(lead.stage)}
                </span>
                <span className="text-xs text-slate-400 hidden sm:block">{formatDate(lead.createdAt)}</span>
              </div>
            </Link>
          ))}
        </div>
        {leads.length === 0 && (
          <p className="text-sm text-slate-400 text-center py-10">No leads yet</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Pipeline card ─────────────────────────────────────────────────────────────

function PipelineCard({ pipeline, total }: { pipeline: Record<string, number>; total: number }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-slate-400" />
          Pipeline Snapshot
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2.5">
        {stageOrder.map((stage) => {
          const count = pipeline[stage] ?? 0;
          if (count === 0) return null;
          const pct = total > 0 ? Math.round((count / total) * 100) : 0;
          return (
            <Link
              key={stage}
              href={`/students?stage=${stage}`}
              className="block space-y-1 rounded-lg p-1.5 -mx-1.5 hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center justify-between text-xs">
                <span
                  className={[
                    "inline-flex items-center rounded-full px-2 py-0.5 font-medium",
                    stageBadgeClass(stage) ?? "bg-slate-100 text-slate-700",
                  ].join(" ")}
                >
                  {stageLabel(stage)}
                </span>
                <span className="text-slate-600 font-medium tabular-nums">
                  {count} <span className="text-slate-400">({pct}%)</span>
                </span>
              </div>
              <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#1E3A5F]/60 transition-all"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </Link>
          );
        })}
        {Object.keys(pipeline).length === 0 && (
          <p className="text-xs text-slate-400 text-center py-4">No pipeline data</p>
        )}
      </CardContent>
    </Card>
  );
}

// ─── Shared personal UI cards ─────────────────────────────────────────────────

const leaveStatusColors: Record<string, string> = {
  PENDING:  "bg-amber-100 text-amber-700",
  APPROVED: "bg-emerald-100 text-emerald-700",
  REJECTED: "bg-red-100 text-red-700",
  CANCELLED:"bg-gray-100 text-gray-500",
};

function LeaveBalancesCard({
  balances,
}: {
  balances: { leaveType: string; totalDays: number; usedDays: number; pendingDays: number }[];
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
          <CalendarDays className="h-4 w-4 text-slate-400" />
          Leave Balance
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {balances.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-4">No leave balance data</p>
        ) : (
          balances.map((lb) => {
            const remaining = lb.totalDays - lb.usedDays - lb.pendingDays;
            const usedPct = lb.totalDays > 0 ? Math.round(((lb.usedDays + lb.pendingDays) / lb.totalDays) * 100) : 0;
            return (
              <div key={lb.leaveType} className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium text-slate-700 capitalize">
                    {lb.leaveType.replace(/_/g, " ").toLowerCase()} Leave
                  </span>
                  <span className="text-xs text-slate-500 tabular-nums">
                    <span className="font-semibold text-slate-800">{remaining}</span>d left of {lb.totalDays}d
                  </span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className={[
                      "h-full rounded-full transition-all",
                      usedPct >= 80 ? "bg-red-400" : usedPct >= 50 ? "bg-amber-400" : "bg-emerald-400",
                    ].join(" ")}
                    style={{ width: `${usedPct}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400">
                  {lb.usedDays}d used
                  {lb.pendingDays > 0 && <span className="text-amber-500"> · {lb.pendingDays}d pending approval</span>}
                </p>
              </div>
            );
          })
        )}
        <Link href="/hr/leave" className="block text-center text-xs text-[#0EA5E9] hover:underline font-medium pt-1">
          Apply for leave →
        </Link>
      </CardContent>
    </Card>
  );
}

function LeaveRequestsCard({
  requests,
}: {
  requests: { id: string; leaveType: string; startDate: Date; endDate: Date; days: number; status: string }[];
}) {
  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center justify-between">
        <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
          <CalendarCheck className="h-4 w-4 text-slate-400" />
          My Leave Requests
        </CardTitle>
        <Link href="/hr/leave" className="text-xs text-[#0EA5E9] hover:underline font-medium">
          View all →
        </Link>
      </CardHeader>
      <CardContent className="p-0">
        {requests.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-8">No leave requests yet</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {requests.map((req) => (
              <div key={req.id} className="flex items-center justify-between px-6 py-3 gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-900 capitalize">
                    {req.leaveType.replace(/_/g, " ").toLowerCase()} Leave
                  </p>
                  <p className="text-xs text-slate-500">
                    {formatDate(req.startDate)} → {formatDate(req.endDate)}
                    <span className="ml-1 text-slate-400">({req.days}d)</span>
                  </p>
                </div>
                <span className={[
                  "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
                  leaveStatusColors[req.status] ?? "bg-slate-100 text-slate-600",
                ].join(" ")}>
                  {req.status.charAt(0) + req.status.slice(1).toLowerCase()}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function HolidaysCard({
  holidays,
}: {
  holidays: { id: string; name: string; date: Date; isGlobal: boolean }[];
}) {
  const now = new Date();
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
          <Sun className="h-4 w-4 text-amber-400" />
          Upcoming Holidays
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {holidays.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-4">No holidays in the next 60 days</p>
        ) : (
          holidays.map((h) => {
            const daysUntil = Math.ceil((h.date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            return (
              <div key={h.id} className="flex items-center justify-between gap-3 py-1.5">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="h-7 w-7 rounded-lg bg-amber-50 flex items-center justify-center shrink-0">
                    <Sun className="h-3.5 w-3.5 text-amber-500" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-900 truncate">{h.name}</p>
                    <p className="text-xs text-slate-500">{formatDate(h.date)}</p>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  <span className={[
                    "text-xs font-medium",
                    daysUntil <= 7 ? "text-emerald-600" : "text-slate-500",
                  ].join(" ")}>
                    {daysUntil === 0 ? "Today" : daysUntil === 1 ? "Tomorrow" : `${daysUntil}d`}
                  </span>
                  {!h.isGlobal && (
                    <p className="text-xs text-slate-400">Regional</p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}

function AssetsCard({
  assets,
}: {
  assets: {
    id: string;
    assignedAt: Date;
    asset: { id: string; name: string; type: string; brand: string | null; model: string | null; serialNumber: string | null };
  }[];
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
          <Laptop className="h-4 w-4 text-slate-400" />
          My Assets
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {assets.length === 0 ? (
          <p className="text-xs text-slate-400 text-center py-4">No assets assigned</p>
        ) : (
          assets.map(({ id, assignedAt, asset }) => (
            <div key={id} className="flex items-center gap-3 py-1.5">
              <div className="h-8 w-8 rounded-lg bg-[#1E3A5F]/10 flex items-center justify-center shrink-0">
                <Laptop className="h-4 w-4 text-[#1E3A5F]" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-900 truncate">{asset.name}</p>
                <p className="text-xs text-slate-500 truncate">
                  {[asset.brand, asset.model].filter(Boolean).join(" · ")}
                  {asset.serialNumber && (
                    <span className="ml-1 text-slate-400">#{asset.serialNumber}</span>
                  )}
                </p>
              </div>
              <div className="text-right shrink-0">
                <span className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium bg-slate-100 text-slate-700">
                  {asset.type}
                </span>
                <p className="text-xs text-slate-400 mt-0.5">Since {formatDate(assignedAt)}</p>
              </div>
            </div>
          ))
        )}
      </CardContent>
    </Card>
  );
}

// ─── Executive Dashboard UI ────────────────────────────────────────────────────

async function ExecutiveDashboard({
  regionId,
  title,
  description,
  showTabs: _showTabs = true,
}: {
  regionId?: string | null;
  title: string;
  description: string;
  showTabs?: boolean;
}) {
  const data = await getExecutiveDashboardData(regionId);
  const { stats, topInstitutions, attentionInstitutions, topICRs, pipeline, recentLeads } = data;

  const totalLeads = stats.totalLeads;

  return (
    <div className="space-y-6">
      <PageHeader
        title={title}
        description={description}
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Dashboard" }]}
      />

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Total Leads"
          value={stats.totalLeads.toLocaleString()}
          change={calcChange(stats.leadsThisMonth, stats.leadsLastMonth)}
          icon="Users"
          iconColor="text-[#1E3A5F]"
          iconBg="bg-[#1E3A5F]/10"
          href="/students"
        />
        <StatCard
          title="Enrolled"
          value={stats.enrolled.toLocaleString()}
          change={calcChange(stats.enrolled, stats.enrolledLastMonth)}
          icon="GraduationCap"
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50"
          href="/students?stage=ENROLLED"
        />
        <StatCard
          title="Active Institutions"
          value={stats.activeInstitutions.toLocaleString()}
          icon="Building2"
          iconColor="text-violet-600"
          iconBg="bg-violet-50"
          href="/institutions"
        />
        <StatCard
          title="Conversion Rate"
          value={`${stats.conversionRate}%`}
          icon="TrendingUp"
          iconColor="text-[#0EA5E9]"
          iconBg="bg-[#0EA5E9]/10"
        />
      </div>

      {/* Main content: 2-col */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left col (2/3) */}
        <div className="xl:col-span-2 space-y-6">
          {/* Top Performing Institutions */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <Star className="h-4 w-4 text-amber-400" />
                Top Performing Institutions
              </CardTitle>
              <Link href="/institutions" className="text-xs text-[#0EA5E9] hover:underline font-medium">
                View all →
              </Link>
            </CardHeader>
            <CardContent className="p-0">
              {topInstitutions.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-10">No enrollment data yet</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="text-left text-xs font-medium text-slate-500 px-6 py-2.5">#</th>
                        <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5">Institution</th>
                        <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5">Country</th>
                        <th className="text-right text-xs font-medium text-slate-500 px-3 py-2.5">Enrolled</th>
                        <th className="text-right text-xs font-medium text-slate-500 px-6 py-2.5">vs Target</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {topInstitutions.map((inst, i) => {
                        const pctOfTarget =
                          inst.target != null && inst.target > 0
                            ? Math.round((inst.enrolled / inst.target) * 100)
                            : null;
                        return (
                          <tr key={inst.id} className="hover:bg-slate-50 transition-colors">
                            <td className="px-6 py-3 text-xs font-bold text-slate-400">
                              {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                            </td>
                            <td className="px-3 py-3">
                              <Link
                                href={`/institutions/${inst.id}`}
                                className="font-medium text-slate-900 hover:text-[#0EA5E9] transition-colors"
                              >
                                {inst.name}
                              </Link>
                            </td>
                            <td className="px-3 py-3 text-slate-500 text-xs">{inst.country}</td>
                            <td className="px-3 py-3 text-right font-semibold text-slate-900">
                              {inst.enrolled}
                            </td>
                            <td className="px-6 py-3 text-right">
                              {pctOfTarget != null ? (
                                <span
                                  className={[
                                    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
                                    pctOfTarget >= 100
                                      ? "bg-emerald-100 text-emerald-700"
                                      : pctOfTarget >= 60
                                      ? "bg-amber-100 text-amber-700"
                                      : "bg-red-100 text-red-700",
                                  ].join(" ")}
                                >
                                  {pctOfTarget}% of {inst.target}
                                </span>
                              ) : (
                                <span className="text-xs text-slate-400">No target</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Top ICR Performers */}
          <Card>
            <CardHeader className="pb-3 flex flex-row items-center justify-between">
              <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-[#0EA5E9]" />
                Top ICR Performers
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {topICRs.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-10">No ICR data yet</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="text-left text-xs font-medium text-slate-500 px-6 py-2.5">#</th>
                        <th className="text-left text-xs font-medium text-slate-500 px-3 py-2.5">ICR</th>
                        <th className="text-right text-xs font-medium text-slate-500 px-3 py-2.5">Total Leads</th>
                        <th className="text-right text-xs font-medium text-slate-500 px-3 py-2.5">Enrolled</th>
                        <th className="text-right text-xs font-medium text-slate-500 px-6 py-2.5">Conversion</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {topICRs.map((icr, i) => (
                        <tr key={icr.id} className="hover:bg-slate-50 transition-colors group">
                          <td className="px-6 py-3 text-xs font-bold text-slate-400">
                            {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
                          </td>
                          <td className="px-3 py-3 font-medium text-slate-900">
                            <Link href={`/students?icr=${icr.id}`} className="hover:text-[#0EA5E9] transition-colors">
                              {icr.name}
                            </Link>
                          </td>
                          <td className="px-3 py-3 text-right text-slate-600">
                            <Link href={`/students?icr=${icr.id}`} className="block">{icr.total}</Link>
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-emerald-700">
                            <Link href={`/students?icr=${icr.id}&stage=ENROLLED`} className="block hover:underline">{icr.enrolled}</Link>
                          </td>
                          <td className="px-6 py-3 text-right">
                            <div className="flex items-center justify-end gap-1.5">
                              <div className="w-16 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                <div
                                  className="h-full rounded-full bg-emerald-500"
                                  style={{ width: `${Math.min(icr.conversionRate, 100)}%` }}
                                />
                              </div>
                              <span className="text-xs font-medium text-slate-700 tabular-nums w-8 text-right">
                                {icr.conversionRate}%
                              </span>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent Leads */}
          <RecentLeadsCard leads={recentLeads} showICR />
        </div>

        {/* Right col (1/3) */}
        <div className="space-y-6">
          {/* Institutions Needing Attention */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" />
                Needs Attention
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {attentionInstitutions.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-4">All institutions are on track ✓</p>
              ) : (
                attentionInstitutions.map((inst) => (
                  <Link
                    key={inst.id}
                    href={`/institutions/${inst.id}`}
                    className="flex items-center justify-between gap-3 p-3 rounded-lg border border-slate-100 hover:border-slate-200 hover:bg-slate-50 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">{inst.name}</p>
                      <p className="text-xs text-slate-500">{inst.country}</p>
                    </div>
                    <span
                      className={[
                        "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium",
                        accountStatusColors[inst.accountStatus] ?? "bg-slate-100 text-slate-700",
                      ].join(" ")}
                    >
                      {inst.accountStatus.replace(/_/g, " ")}
                    </span>
                  </Link>
                ))
              )}
              <Link
                href="/institutions?status=RENEWAL_DUE"
                className="block text-center text-xs text-[#0EA5E9] hover:underline font-medium pt-1"
              >
                View all at-risk →
              </Link>
            </CardContent>
          </Card>

          {/* Pipeline Snapshot */}
          <PipelineCard pipeline={pipeline} total={totalLeads} />
        </div>
      </div>
    </div>
  );
}

// ─── ICR Dashboard UI ──────────────────────────────────────────────────────────

async function ICRDashboard({ userId, regionId }: { userId: string; regionId?: string | null }) {
  const [data, personal] = await Promise.all([
    getICRDashboardData(userId),
    getPersonalData(userId, regionId),
  ]);
  const { stats, pipeline, recentLeads, pendingReports } = data;
  const { leaveBalances, leaveRequests, holidays, assets } = personal;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Dashboard"
        description="Your leads, pipeline and upcoming activities"
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Dashboard" }]}
      />

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="My Leads"
          value={stats.totalLeads.toLocaleString()}
          change={calcChange(stats.leadsThisMonth, stats.leadsLastMonth)}
          icon="Users"
          iconColor="text-[#1E3A5F]"
          iconBg="bg-[#1E3A5F]/10"
          href="/students"
        />
        <StatCard
          title="New This Month"
          value={stats.leadsThisMonth.toLocaleString()}
          change={calcChange(stats.leadsThisMonth, stats.leadsLastMonth)}
          icon="TrendingUp"
          iconColor="text-[#0EA5E9]"
          iconBg="bg-[#0EA5E9]/10"
        />
        <StatCard
          title="In Progress"
          value={stats.inProgress.toLocaleString()}
          icon="ClipboardList"
          iconColor="text-amber-600"
          iconBg="bg-amber-50"
        />
        <StatCard
          title="Enrolled"
          value={stats.enrolled.toLocaleString()}
          icon="GraduationCap"
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50"
          href="/students?stage=ENROLLED"
        />
      </div>

      {/* Pending reports alert */}
      {pendingReports > 0 && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-amber-50 border border-amber-200">
          <FileText className="h-5 w-5 text-amber-600 shrink-0" />
          <p className="text-sm text-amber-800 font-medium flex-1">
            You have <span className="font-bold">{pendingReports}</span> monthly report{pendingReports > 1 ? "s" : ""} pending submission or review.
          </p>
          <Link href="/reports" className="text-xs font-semibold text-amber-700 underline shrink-0">
            View reports →
          </Link>
        </div>
      )}

      {/* Main content: 2-col */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Left: recent leads */}
        <div className="xl:col-span-2 space-y-6">
          <RecentLeadsCard leads={recentLeads} />
        </div>

        {/* Right: performance + pipeline */}
        <div className="space-y-6">
          {/* My Performance */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
                <BarChart3 className="h-4 w-4 text-slate-400" />
                My Performance
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* Conversion rate */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs text-slate-500">Conversion Rate</span>
                  <span className="text-sm font-bold text-slate-900">{stats.conversionRate}%</span>
                </div>
                <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${Math.min(stats.conversionRate, 100)}%` }}
                  />
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  {stats.enrolled} enrolled of {stats.totalLeads} leads
                </p>
              </div>

              <div className="border-t border-slate-100 pt-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Upcoming Events</span>
                  <span className="text-sm font-semibold text-slate-900">{stats.upcomingEvents}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-slate-500">Active in Pipeline</span>
                  <span className="text-sm font-semibold text-slate-900">{stats.inProgress}</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Pipeline */}
          <PipelineCard pipeline={pipeline} total={stats.totalLeads} />
        </div>
      </div>

      {/* Personal HR section */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <LeaveBalancesCard balances={leaveBalances} />
        <LeaveRequestsCard requests={leaveRequests} />
        <HolidaysCard holidays={holidays} />
      </div>

      {/* Assets */}
      <AssetsCard assets={assets} />

      {/* Announcements */}
      <AnnouncementsFeed />
    </div>
  );
}

// ─── ERP (HR / EMPLOYEE) Dashboard UI ─────────────────────────────────────────

async function ERPDashboard({ userId, regionId }: { userId: string; regionId?: string | null }) {
  const data = await getERPDashboardData(userId, regionId);
  const { employee, stats, leaveBalances, leaveRequests, holidays, assets } = data;

  const annualLeave = leaveBalances.find((lb) => lb.leaveType === "ANNUAL");
  const sickLeave = leaveBalances.find((lb) => lb.leaveType === "SICK");
  const annualRemaining = annualLeave ? annualLeave.totalDays - annualLeave.usedDays : 0;
  const sickRemaining = sickLeave ? sickLeave.totalDays - sickLeave.usedDays : 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="My Workspace"
        description={
          employee
            ? `${employee.jobTitle ?? "Employee"} · ${employee.department ?? "—"}`
            : "Your personal HR dashboard"
        }
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Dashboard" }]}
      />

      {/* KPI row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Open Tasks"
          value={(stats?.openTasks ?? 0).toLocaleString()}
          icon="CheckSquare"
          iconColor="text-[#1E3A5F]"
          iconBg="bg-[#1E3A5F]/10"
          href="/tasks"
        />
        <StatCard
          title="Annual Leave Left"
          value={`${annualRemaining}d`}
          icon="CalendarDays"
          iconColor="text-emerald-600"
          iconBg="bg-emerald-50"
          href="/hr/leave"
        />
        <StatCard
          title="Sick Leave Left"
          value={`${sickRemaining}d`}
          icon="Briefcase"
          iconColor="text-amber-600"
          iconBg="bg-amber-50"
          href="/hr/leave"
        />
        <StatCard
          title="Travel Requests"
          value={(stats?.travelRequests ?? 0).toLocaleString()}
          icon="TrendingUp"
          iconColor="text-violet-600"
          iconBg="bg-violet-50"
          href="/travel"
        />
      </div>

      {/* Pending leaves alert */}
      {stats && stats.pendingLeaves > 0 && (
        <div className="flex items-center gap-3 p-4 rounded-xl bg-blue-50 border border-blue-200">
          <Bell className="h-5 w-5 text-blue-600 shrink-0" />
          <p className="text-sm text-blue-800 font-medium flex-1">
            You have <span className="font-bold">{stats.pendingLeaves}</span> leave request{stats.pendingLeaves > 1 ? "s" : ""} awaiting approval.
          </p>
          <Link href="/hr/leave" className="text-xs font-semibold text-blue-700 underline shrink-0">
            View →
          </Link>
        </div>
      )}

      {/* Leave + requests + holidays */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <LeaveBalancesCard balances={leaveBalances} />
        <LeaveRequestsCard requests={leaveRequests} />
        <HolidaysCard holidays={holidays} />
      </div>

      {/* Assets */}
      <AssetsCard assets={assets} />

      {/* Announcements */}
      <AnnouncementsFeed />
    </div>
  );
}

// ─── Tab Switcher ──────────────────────────────────────────────────────────────

function DashboardViewTabs({ activeView }: { activeView: "executive" | "personal" }) {
  return (
    <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-xl w-fit">
      <Link
        href="/dashboard?view=executive"
        className={[
          "px-5 py-1.5 rounded-lg text-sm font-medium transition-all duration-150",
          activeView === "executive"
            ? "bg-white shadow-sm text-slate-900"
            : "text-slate-500 hover:text-slate-800",
        ].join(" ")}
      >
        Executive
      </Link>
      <Link
        href="/dashboard?view=personal"
        className={[
          "px-5 py-1.5 rounded-lg text-sm font-medium transition-all duration-150",
          activeView === "personal"
            ? "bg-white shadow-sm text-slate-900"
            : "text-slate-500 hover:text-slate-800",
        ].join(" ")}
      >
        Personal
      </Link>
    </div>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────────

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string }>;
}) {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { role, id: userId, regionId } = session.user;
  const { view } = await searchParams;

  const ERP_ROLES: Role[] = ["HR_MANAGER", "EMPLOYEE"];

  // Check if user has access to the executive dashboard (via permission override or role default)
  const canViewExecutive = await effectiveHasPermission(role, "executive_dashboard", "read");

  // Determine which view to show
  // - If user has exec access: default to executive, unless ?view=personal
  // - If user has no exec access: always personal
  const activeView: "executive" | "personal" =
    canViewExecutive && view !== "personal" ? "executive" : "personal";

  const execTitle = role === "REGIONAL_MANAGER" ? "Regional Dashboard" : "Executive Overview";
  const execDesc =
    role === "REGIONAL_MANAGER"
      ? "Performance overview for your region"
      : "Global performance across all regions, institutions, and ICRs";

  // Personal dashboard type depends on role
  const isERP = ERP_ROLES.includes(role);

  return (
    <div className="space-y-6">
      {/* Tab switcher — only show if user can see both */}
      {canViewExecutive && (
        <div className="flex items-center justify-between">
          <DashboardViewTabs activeView={activeView} />
        </div>
      )}

      {activeView === "executive" && canViewExecutive ? (
        <ExecutiveDashboard
          regionId={role === "REGIONAL_MANAGER" ? regionId : undefined}
          title={execTitle}
          description={execDesc}
          showTabs={false}
        />
      ) : isERP ? (
        <ERPDashboard userId={userId} regionId={regionId} />
      ) : (
        <ICRDashboard userId={userId} regionId={regionId} />
      )}
    </div>
  );
}
