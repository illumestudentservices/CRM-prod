import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import {
  Users,
  GraduationCap,
  Building2,
  CalendarDays,
  TrendingUp,
  ClipboardList,
  Briefcase,
  CheckSquare,
} from "lucide-react";
import { StatCard } from "@/components/shared/stat-card";
import { PageHeader } from "@/components/shared/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDate } from "@/lib/utils";
import type { Role } from "@/lib/permissions";
import { AnnouncementsFeed } from "@/components/shared/announcements-feed";

type RecentLead = {
  id: string;
  fullName: string;
  stage: string;
  createdAt: Date;
  institution: { name: string } | null;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

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
  return ((current - previous) / previous) * 100;
}

// ─── Role-gated dashboard loaders ────────────────────────────────────────────

async function getExecutiveStats() {
  const now = new Date();
  const thisMonthStart = startOfMonth(now);
  const lastMonthStart = startOfLastMonth(now);
  const lastMonthEnd = endOfLastMonth(now);

  const [
    totalLeads,
    leadsThisMonth,
    leadsLastMonth,
    enrolled,
    enrolledLastMonth,
    totalInstitutions,
    institutionsLastMonth,
    totalEvents,
    eventsThisMonth,
    recentLeads,
  ] = await Promise.all([
    db.lead.count({ where: { deletedAt: null } }),
    db.lead.count({ where: { deletedAt: null, createdAt: { gte: thisMonthStart } } }),
    db.lead.count({ where: { deletedAt: null, createdAt: { gte: lastMonthStart, lte: lastMonthEnd } } }),
    db.lead.count({ where: { deletedAt: null, stage: "ENROLLED" } }),
    db.lead.count({ where: { deletedAt: null, stage: "ENROLLED", updatedAt: { gte: lastMonthStart, lte: lastMonthEnd } } }),
    db.institution.count({ where: { deletedAt: null } }),
    db.institution.count({ where: { deletedAt: null, createdAt: { lte: lastMonthEnd } } }),
    db.event.count({ where: { deletedAt: null } }),
    db.event.count({ where: { deletedAt: null, createdAt: { gte: thisMonthStart } } }),
    db.lead.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true, fullName: true, stage: true, createdAt: true,
        institution: { select: { name: true } },
      },
    }),
  ]);

  return {
    stats: [
      { title: "Total Leads", value: totalLeads.toLocaleString(), change: calcChange(leadsThisMonth, leadsLastMonth), icon: "Users", iconColor: "text-[#1E3A5F]", iconBg: "bg-[#1E3A5F]/10", href: "/students" },
      { title: "Enrolled", value: enrolled.toLocaleString(), change: calcChange(enrolled, enrolledLastMonth), icon: "GraduationCap", iconColor: "text-emerald-600", iconBg: "bg-emerald-50", href: "/students?stage=ENROLLED" },
      { title: "Institutions", value: totalInstitutions.toLocaleString(), change: calcChange(totalInstitutions, institutionsLastMonth), icon: "Building2", iconColor: "text-violet-600", iconBg: "bg-violet-50", href: "/institutions" },
      { title: "Events This Month", value: eventsThisMonth.toLocaleString(), change: calcChange(eventsThisMonth, totalEvents - eventsThisMonth), icon: "CalendarDays", iconColor: "text-[#0EA5E9]", iconBg: "bg-[#0EA5E9]/10", href: "/events" },
    ],
    recentLeads: recentLeads as RecentLead[],
    dashboardTitle: "Executive Overview",
    dashboardDescription: "Global performance across all regions and ICRs",
  };
}

async function getRegionalStats(regionId: string) {
  const now = new Date();
  const thisMonthStart = startOfMonth(now);
  const lastMonthStart = startOfLastMonth(now);
  const lastMonthEnd = endOfLastMonth(now);

  const where = { deletedAt: null, regionId };

  const [
    totalLeads,
    leadsThisMonth,
    leadsLastMonth,
    enrolled,
    activeInstitutions,
    upcomingEvents,
    recentLeads,
  ] = await Promise.all([
    db.lead.count({ where }),
    db.lead.count({ where: { ...where, createdAt: { gte: thisMonthStart } } }),
    db.lead.count({ where: { ...where, createdAt: { gte: lastMonthStart, lte: lastMonthEnd } } }),
    db.lead.count({ where: { ...where, stage: "ENROLLED" } }),
    db.institution.count({ where: { deletedAt: null, regionId, accountStatus: "ACTIVE" } }),
    db.event.count({ where: { deletedAt: null, regionId, date: { gte: now }, status: { in: ["PLANNED", "CONFIRMED"] } } }),
    db.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true, fullName: true, stage: true, createdAt: true,
        institution: { select: { name: true } },
      },
    }),
  ]);

  return {
    stats: [
      { title: "Regional Leads", value: totalLeads.toLocaleString(), change: calcChange(leadsThisMonth, leadsLastMonth), icon: "Users", iconColor: "text-[#1E3A5F]", iconBg: "bg-[#1E3A5F]/10" },
      { title: "New This Month", value: leadsThisMonth.toLocaleString(), change: calcChange(leadsThisMonth, leadsLastMonth), icon: "TrendingUp", iconColor: "text-[#0EA5E9]", iconBg: "bg-[#0EA5E9]/10" },
      { title: "Enrolled", value: enrolled.toLocaleString(), icon: "GraduationCap", iconColor: "text-emerald-600", iconBg: "bg-emerald-50" },
      { title: "Upcoming Events", value: upcomingEvents.toLocaleString(), icon: "CalendarDays", iconColor: "text-amber-600", iconBg: "bg-amber-50" },
    ],
    recentLeads: recentLeads as RecentLead[],
    dashboardTitle: "Regional Dashboard",
    dashboardDescription: "Performance overview for your region",
  };
}

async function getICRStats(userId: string) {
  const now = new Date();
  const thisMonthStart = startOfMonth(now);
  const lastMonthStart = startOfLastMonth(now);
  const lastMonthEnd = endOfLastMonth(now);

  const where = { deletedAt: null, assignedICRId: userId };

  const [
    totalLeads,
    leadsThisMonth,
    leadsLastMonth,
    enrolled,
    inProgress,
    myEvents,
    recentLeads,
  ] = await Promise.all([
    db.lead.count({ where }),
    db.lead.count({ where: { ...where, createdAt: { gte: thisMonthStart } } }),
    db.lead.count({ where: { ...where, createdAt: { gte: lastMonthStart, lte: lastMonthEnd } } }),
    db.lead.count({ where: { ...where, stage: "ENROLLED" } }),
    db.lead.count({ where: { ...where, stage: { in: ["CONTACTED", "APPLICATION_SENT", "DOCUMENTS_RECEIVED", "OFFER_ISSUED"] } } }),
    db.event.count({ where: { deletedAt: null, assignedICRId: userId, date: { gte: now } } }),
    db.lead.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 5,
      select: {
        id: true, fullName: true, stage: true, createdAt: true,
        institution: { select: { name: true } },
      },
    }),
  ]);

  return {
    stats: [
      { title: "My Leads", value: totalLeads.toLocaleString(), change: calcChange(leadsThisMonth, leadsLastMonth), icon: "Users", iconColor: "text-[#1E3A5F]", iconBg: "bg-[#1E3A5F]/10" },
      { title: "New This Month", value: leadsThisMonth.toLocaleString(), change: calcChange(leadsThisMonth, leadsLastMonth), icon: "TrendingUp", iconColor: "text-[#0EA5E9]", iconBg: "bg-[#0EA5E9]/10" },
      { title: "In Progress", value: inProgress.toLocaleString(), icon: "ClipboardList", iconColor: "text-amber-600", iconBg: "bg-amber-50" },
      { title: "Enrolled", value: enrolled.toLocaleString(), icon: "GraduationCap", iconColor: "text-emerald-600", iconBg: "bg-emerald-50" },
    ],
    recentLeads: recentLeads as RecentLead[],
    dashboardTitle: "My Dashboard",
    dashboardDescription: "Your leads and upcoming activities",
  };
}

async function getERPStats(userId: string) {
  const employee = await db.employee.findUnique({
    where: { userId },
    select: { id: true },
  });

  if (!employee) {
    return {
      stats: [
        { title: "My Tasks", value: "—", icon: "CheckSquare", iconColor: "text-[#1E3A5F]", iconBg: "bg-[#1E3A5F]/10" },
        { title: "Leave Balance", value: "—", icon: "CalendarDays", iconColor: "text-emerald-600", iconBg: "bg-emerald-50" },
        { title: "Travel Requests", value: "—", icon: "Briefcase", iconColor: "text-amber-600", iconBg: "bg-amber-50" },
        { title: "Pending Reviews", value: "—", icon: "ClipboardList", iconColor: "text-violet-600", iconBg: "bg-violet-50" },
      ],
      recentLeads: [],
      dashboardTitle: "My Workspace",
      dashboardDescription: "Your personal dashboard",
    };
  }

  const now = new Date();
  const currentYear = now.getFullYear();

  const [openTasks, annualLeave, pendingTravel] = await Promise.all([
    db.task.count({ where: { deletedAt: null, assigneeId: employee.id, status: { in: ["TODO", "IN_PROGRESS"] } } }),
    db.leaveBalance.findFirst({ where: { employeeId: employee.id, leaveType: "ANNUAL", year: currentYear }, select: { totalDays: true, usedDays: true } }),
    db.travelRequest.count({ where: { employeeId: employee.id, status: { in: ["PENDING", "APPROVED"] } } }),
  ]);

  const remainingLeave = annualLeave ? annualLeave.totalDays - annualLeave.usedDays : 0;

  return {
    stats: [
      { title: "Open Tasks", value: openTasks.toLocaleString(), icon: "CheckSquare", iconColor: "text-[#1E3A5F]", iconBg: "bg-[#1E3A5F]/10" },
      { title: "Annual Leave Left", value: `${remainingLeave}d`, icon: "CalendarDays", iconColor: "text-emerald-600", iconBg: "bg-emerald-50" },
      { title: "Travel Requests", value: pendingTravel.toLocaleString(), icon: "Briefcase", iconColor: "text-amber-600", iconBg: "bg-amber-50" },
      { title: "Pending Reviews", value: "—", icon: "ClipboardList", iconColor: "text-violet-600", iconBg: "bg-violet-50" },
    ],
    recentLeads: [],
    dashboardTitle: "My Workspace",
    dashboardDescription: "Your personal ERP dashboard",
  };
}

// ─── Stage badge helpers ──────────────────────────────────────────────────────

const stageColors: Record<string, string> = {
  NEW: "bg-slate-100 text-slate-700",
  CONTACTED: "bg-blue-100 text-blue-700",
  APPLICATION_SENT: "bg-violet-100 text-violet-700",
  DOCUMENTS_RECEIVED: "bg-amber-100 text-amber-700",
  OFFER_ISSUED: "bg-orange-100 text-orange-700",
  ENROLLED: "bg-emerald-100 text-emerald-700",
  DEFERRED: "bg-yellow-100 text-yellow-700",
  REJECTED: "bg-red-100 text-red-700",
  LOST: "bg-gray-100 text-gray-600",
};

function stageLabel(stage: string) {
  return stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function DashboardPage() {
  const session = await auth();
  if (!session?.user) redirect("/login");

  const { role, id: userId, regionId } = session.user;

  const CRM_EXEC_ROLES: Role[] = ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS"];
  const ERP_ROLES: Role[] = ["HR_MANAGER", "EMPLOYEE"];

  let data;

  if (CRM_EXEC_ROLES.includes(role)) {
    data = await getExecutiveStats();
  } else if (role === "REGIONAL_MANAGER") {
    data = regionId
      ? await getRegionalStats(regionId)
      : await getExecutiveStats();
  } else if (role === "ICR") {
    data = await getICRStats(userId);
  } else if (ERP_ROLES.includes(role)) {
    data = await getERPStats(userId);
  } else {
    data = await getExecutiveStats();
  }

  const { stats, recentLeads, dashboardTitle, dashboardDescription } = data;

  return (
    <div className="space-y-6">
      <PageHeader
        title={dashboardTitle}
        description={dashboardDescription}
        breadcrumbs={[{ label: "Home", href: "/" }, { label: "Dashboard" }]}
      />

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((stat) => (
          <StatCard
            key={stat.title}
            title={stat.title}
            value={stat.value}
            change={"change" in stat ? (stat.change as number) : undefined}
            icon={stat.icon}
            iconColor={stat.iconColor}
            iconBg={stat.iconBg}
            href={"href" in stat ? (stat.href as string) : undefined}
          />
        ))}
      </div>

      {/* Recent activity */}
      {recentLeads.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-slate-900">
              Recent Leads
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y divide-slate-100">
              {recentLeads.map((lead) => (
                <div
                  key={lead.id}
                  className="flex items-center justify-between py-3 gap-4"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="h-8 w-8 rounded-full bg-[#1E3A5F]/10 flex items-center justify-center shrink-0">
                      <span className="text-xs font-semibold text-[#1E3A5F]">
                        {lead.fullName
                          .split(" ")
                          .map((n: string) => n[0])
                          .slice(0, 2)
                          .join("")
                          .toUpperCase()}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-900 truncate">
                        {lead.fullName}
                      </p>
                      <p className="text-xs text-slate-500 truncate">
                        {lead.institution?.name ?? "No institution"}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <span
                      className={[
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                        stageColors[lead.stage] ?? "bg-slate-100 text-slate-700",
                      ].join(" ")}
                    >
                      {stageLabel(lead.stage)}
                    </span>
                    <span className="text-xs text-slate-400 hidden sm:block">
                      {formatDate(lead.createdAt)}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            {recentLeads.length === 5 && (
              <div className="mt-3 pt-3 border-t border-slate-100">
                <a
                  href="/students"
                  className="text-xs font-medium text-[#0EA5E9] hover:underline"
                >
                  View all leads &rarr;
                </a>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Announcements — all roles except INSTITUTION_CLIENT */}
      {role !== "INSTITUTION_CLIENT" && <AnnouncementsFeed />}

      {/* ERP-only empty state */}
      {recentLeads.length === 0 && ERP_ROLES.includes(role) && (
        <Card>
          <CardContent className="py-12 flex flex-col items-center gap-3 text-center">
            <div className="h-12 w-12 rounded-xl bg-[#1E3A5F]/10 flex items-center justify-center">
              <CheckSquare className="h-6 w-6 text-[#1E3A5F]" />
            </div>
            <p className="text-sm font-medium text-slate-700">
              You&apos;re all caught up
            </p>
            <p className="text-xs text-slate-400 max-w-xs">
              No outstanding tasks or activities. Check your leaves, travel
              requests, and worklogs from the HR menu.
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
