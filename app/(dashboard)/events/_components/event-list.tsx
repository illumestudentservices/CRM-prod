"use client";

import * as React from "react";
import { type ColumnDef } from "@tanstack/react-table";
import { useRouter } from "next/navigation";
import { type EventType, type EventStatus } from "@prisma/client";
import { DataTable } from "@/components/shared/data-table";
import { formatDate, formatCurrency, formatPercent, cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { StatCard } from "@/components/shared/stat-card";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface EventRow {
  id: string;
  name: string;
  type: EventType;
  date: Date | string;
  city: string;
  country: string;
  status: EventStatus;
  budget: number | null;
  totalCost: number;
  leadsCount: number;
  enrollmentsCount: number;
  roi: number | null;
  institutionNames: string[];
}

interface EventStats {
  total: number;
  upcoming: number;
  totalLeadsFromEvents: number;
  avgROI: number | null;
}

interface EventListProps {
  events: EventRow[];
  stats: EventStats;
}

// ─── Badge configs ─────────────────────────────────────────────────────────

const EVENT_TYPE_BADGE: Record<EventType, string> = {
  EDUCATION_FAIR: "bg-blue-100 text-blue-700 border-blue-200",
  SCHOOL_FAIR: "bg-sky-100 text-sky-700 border-sky-200",
  SCHOOL_VISIT: "bg-cyan-100 text-cyan-700 border-cyan-200",
  CAMPUS_VISIT: "bg-indigo-100 text-indigo-700 border-indigo-200",
  WEBINAR: "bg-violet-100 text-violet-700 border-violet-200",
  OPEN_DAY: "bg-emerald-100 text-emerald-700 border-emerald-200",
  AGENT_WORKSHOP: "bg-amber-100 text-amber-800 border-amber-200",
  AGENT_TRAINING: "bg-amber-100 text-amber-700 border-amber-200",
  STUDENT_SEMINAR: "bg-lime-100 text-lime-700 border-lime-200",
  EXHIBITION: "bg-rose-100 text-rose-700 border-rose-200",
  CONVERSION_EVENT: "bg-fuchsia-100 text-fuchsia-700 border-fuchsia-200",
  APPLICATION_DAY: "bg-purple-100 text-purple-700 border-purple-200",
  SCHOOL_PRESENTATION: "bg-teal-100 text-teal-700 border-teal-200",
  OTHER: "bg-slate-100 text-slate-600 border-slate-200",
};

const EVENT_TYPE_LABEL: Record<EventType, string> = {
  EDUCATION_FAIR: "Education Fair",
  SCHOOL_FAIR: "School Fair",
  SCHOOL_VISIT: "School Visit",
  CAMPUS_VISIT: "Campus Visit",
  WEBINAR: "Webinar",
  OPEN_DAY: "Open Day",
  AGENT_WORKSHOP: "Agent Workshop",
  AGENT_TRAINING: "Agent Training",
  STUDENT_SEMINAR: "Student Seminar",
  EXHIBITION: "Exhibition",
  CONVERSION_EVENT: "Conversion Event",
  APPLICATION_DAY: "Application Day",
  SCHOOL_PRESENTATION: "School Presentation",
  OTHER: "Other",
};

const EVENT_STATUS_BADGE: Record<EventStatus, string> = {
  PLANNED: "bg-slate-100 text-slate-600 border-slate-200",
  CONFIRMED: "bg-blue-100 text-blue-700 border-blue-200",
  IN_PROGRESS: "bg-violet-100 text-violet-700 border-violet-200",
  COMPLETED: "bg-green-100 text-green-700 border-green-200",
  CLOSED: "bg-emerald-100 text-emerald-800 border-emerald-200",
  CANCELLED: "bg-red-100 text-red-700 border-red-200",
};

const EVENT_STATUS_LABEL: Record<EventStatus, string> = {
  PLANNED: "Planned",
  CONFIRMED: "Confirmed",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

// ─── Columns ───────────────────────────────────────────────────────────────

const columns: ColumnDef<EventRow>[] = [
  {
    accessorKey: "name",
    header: "Name",
    cell: ({ row }) => (
      <span className="font-medium text-slate-900">{row.original.name}</span>
    ),
  },
  {
    accessorKey: "type",
    header: "Type",
    cell: ({ row }) => (
      <span
        className={cn(
          "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border",
          EVENT_TYPE_BADGE[row.original.type]
        )}
      >
        {EVENT_TYPE_LABEL[row.original.type]}
      </span>
    ),
  },
  {
    accessorKey: "date",
    header: "Date",
    cell: ({ row }) => (
      <span className="text-sm text-slate-700">{formatDate(row.original.date)}</span>
    ),
  },
  {
    id: "location",
    header: "City / Country",
    cell: ({ row }) => (
      <div className="text-sm">
        <p className="text-slate-900">{row.original.city}</p>
        <p className="text-slate-500 text-xs">{row.original.country}</p>
      </div>
    ),
  },
  {
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <span
        className={cn(
          "inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border",
          EVENT_STATUS_BADGE[row.original.status]
        )}
      >
        {EVENT_STATUS_LABEL[row.original.status]}
      </span>
    ),
  },
  {
    accessorKey: "budget",
    header: "Budget",
    cell: ({ row }) => (
      <span className="text-sm">{formatCurrency(row.original.budget)}</span>
    ),
  },
  {
    accessorKey: "leadsCount",
    header: "Leads",
    cell: ({ row }) => (
      <span className="text-sm font-medium">{row.original.leadsCount}</span>
    ),
  },
  {
    id: "roi",
    header: "ROI",
    cell: ({ row }) => {
      const roi = row.original.roi;
      if (roi === null) return <span className="text-slate-400 text-sm">—</span>;
      return (
        <span
          className={cn(
            "text-sm font-semibold",
            roi >= 0 ? "text-green-600" : "text-red-600"
          )}
        >
          {roi >= 0 ? "+" : ""}
          {formatPercent(roi)}
        </span>
      );
    },
  },
];

// ─── Component ─────────────────────────────────────────────────────────────

export function EventList({ events, stats }: EventListProps) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = React.useState("all");
  const [typeFilter, setTypeFilter] = React.useState("all");

  const statCards = [
    { title: "Total Events",            value: stats.total,                                           icon: "CalendarDays" as const, iconColor: "text-[#1E3A5F]",  iconBg: "bg-[#1E3A5F]/10", status: "all" },
    { title: "Upcoming",                value: stats.upcoming,                                        icon: "Clock" as const,        iconColor: "text-blue-600",   iconBg: "bg-blue-50",      status: "PLANNED" },
    { title: "Total Leads from Events", value: stats.totalLeadsFromEvents,                            icon: "Users" as const,        iconColor: "text-violet-600", iconBg: "bg-violet-50",    status: "COMPLETED" },
    { title: "Avg ROI",                 value: stats.avgROI !== null ? formatPercent(stats.avgROI) : "—", icon: "TrendingUp" as const, iconColor: "text-green-600", iconBg: "bg-green-50",  status: "" },
  ];

  const filtered = React.useMemo(() => {
    return events.filter((e) => {
      if (statusFilter !== "all" && e.status !== statusFilter) return false;
      if (typeFilter !== "all" && e.type !== typeFilter) return false;
      return true;
    });
  }, [events, statusFilter, typeFilter]);

  return (
    <div className="space-y-4">
      {/* Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <StatCard
            key={card.title}
            title={card.title}
            value={card.value}
            icon={card.icon}
            iconColor={card.iconColor}
            iconBg={card.iconBg}
            className={cn(
              card.status ? "cursor-pointer transition-all" : "",
              statusFilter === card.status && card.status && "ring-2 ring-[#1E3A5F] ring-offset-1"
            )}
            onClick={card.status ? () => setStatusFilter(statusFilter === card.status ? "all" : card.status) : undefined}
          />
        ))}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="h-9 w-[140px] text-sm">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="PLANNED">Planned</SelectItem>
            <SelectItem value="CONFIRMED">Confirmed</SelectItem>
            <SelectItem value="COMPLETED">Completed</SelectItem>
            <SelectItem value="CANCELLED">Cancelled</SelectItem>
          </SelectContent>
        </Select>

        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="h-9 w-[180px] text-sm">
            <SelectValue placeholder="Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            <SelectItem value="EDUCATION_FAIR">Education Fair</SelectItem>
            <SelectItem value="CAMPUS_VISIT">Campus Visit</SelectItem>
            <SelectItem value="WEBINAR">Webinar</SelectItem>
            <SelectItem value="AGENT_TRAINING">Agent Training</SelectItem>
            <SelectItem value="SCHOOL_PRESENTATION">School Presentation</SelectItem>
            <SelectItem value="EXHIBITION">Exhibition</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        searchKey="name"
        searchPlaceholder="Search events..."
        onRowClick={(row) => router.push(`/events/${row.id}`)}
        emptyTitle="No events found"
        emptyDescription="Create your first event to start tracking ROI."
      />
    </div>
  );
}
