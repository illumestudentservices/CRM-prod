"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButton } from "@/components/shared/export-button";
import { DrillDownSheet } from "./drill-down-sheet";
import { stageLabel, stageHex } from "@/lib/lead-pipeline";
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  ResponsiveContainer,
} from "recharts";

interface RegionalData {
  pipelineByStage: Array<{ stage: string; count: number }>;
  icrPerformance: Array<{ icrId: string; name: string; leads: number; enrolled: number; conversionRate: number }>;
  sourcePerformance: Array<{ sourceId: string | null; name: string; type: string; leads: number; enrolled: number; conversionRate: number }>;
  upcomingEvents: Array<{ id: string; name: string; type: string; date: string; city: string; country: string; status: string }>;
  pendingReports: Array<{ id: string; icrName: string | null; institutionName: string; reportingMonth: number; reportingYear: number; status: string; submittedAt: string | null }>;
}



const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STATUS_BADGE: Record<string, string> = {
  PENDING_REVIEW: "bg-amber-100 dark:bg-amber-500/15 text-amber-800 dark:text-amber-300",
  REGIONAL_APPROVED: "bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300",
  HQ_REVIEW: "bg-indigo-100 dark:bg-indigo-500/15 text-indigo-800 dark:text-indigo-300",
};

interface DrillDown {
  open: boolean;
  title: string;
  description?: string;
  filters: Record<string, string>;
}

const CLOSED_DRILL: DrillDown = { open: false, title: "", filters: {} };

export function RegionalDashboard() {
  const router = useRouter();
  const [data, setData] = useState<RegionalData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillDown>(CLOSED_DRILL);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/analytics/regional");
        if (!res.ok) throw new Error("Failed to load regional analytics");
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError("Failed to load regional analytics");
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const pieData = (data?.pipelineByStage ?? []).map((s) => ({
    name: stageLabel(s.stage),
    value: s.count,
    color: stageHex(s.stage),
    stage: s.stage,
  }));

  // Export data
  const icrExportData = (data?.icrPerformance ?? []).map((i) => ({
    name: i.name,
    leads: i.leads,
    enrolled: i.enrolled,
    conversionRate: `${i.conversionRate}%`,
  }));
  const pipelineExportData = (data?.pipelineByStage ?? []).map((s) => ({
    stage: stageLabel(s.stage),
    count: s.count,
  }));
  const sourceExportData = (data?.sourcePerformance ?? []).map((s) => ({
    source: s.name,
    leads: s.leads,
    enrolled: s.enrolled,
    conversionRate: `${s.conversionRate}%`,
  }));

  return (
    <div className="space-y-6">
      {/* Export button */}
      <div className="flex justify-end">
        <ExportButton
          title="Regional Analytics"
          exports={[
            {
              label: "Pipeline by Stage",
              data: pipelineExportData,
              columns: [
                { key: "stage", header: "Stage" },
                { key: "count", header: "Count" },
              ],
              filename: "regional_pipeline",
            },
            {
              label: "ICR Performance",
              data: icrExportData,
              columns: [
                { key: "name", header: "ICR" },
                { key: "leads", header: "Leads" },
                { key: "enrolled", header: "Enrolled" },
                { key: "conversionRate", header: "Conv. Rate" },
              ],
              filename: "regional_icr_performance",
            },
            {
              label: "Source Performance",
              data: sourceExportData,
              columns: [
                { key: "source", header: "Source" },
                { key: "leads", header: "Leads" },
                { key: "enrolled", header: "Enrolled" },
                { key: "conversionRate", header: "Conv. Rate" },
              ],
              filename: "regional_sources",
            },
          ]}
        />
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Pipeline Donut */}
        <Card className="col-span-12 md:col-span-5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-slate-800 dark:text-slate-200">Pipeline by Stage</CardTitle>
            <p className="text-xs text-slate-500 dark:text-slate-400">Click a slice to view leads at that stage</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={95}
                    paddingAngle={2}
                    dataKey="value"
                    cursor="pointer"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onClick={(entry: any) => {
                      const stage = entry.stage as string;
                      setDrill({
                        open: true,
                        title: `Leads — ${stageLabel(stage)}`,
                        description: "Students currently at this pipeline stage in your region",
                        filters: { stage },
                      });
                    }}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: unknown) => [(value as number).toLocaleString()]}
                    contentStyle={{ fontSize: "12px", border: "1px solid #E2E8F0", borderRadius: "8px" }}
                  />
                  <Legend
                    iconType="circle"
                    iconSize={8}
                    wrapperStyle={{ fontSize: "11px" }}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* ICR Performance */}
        <Card className="col-span-12 md:col-span-7">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-slate-800 dark:text-slate-200">ICR Performance (YTD)</CardTitle>
            <p className="text-xs text-slate-500 dark:text-slate-400">Click a bar to view that ICR's leads</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[260px] w-full" />
            ) : !data?.icrPerformance?.length ? (
              <div className="flex items-center justify-center h-32 text-slate-400 dark:text-slate-500 text-sm">No ICR data available</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={data.icrPerformance}
                  margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                  barSize={14}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                  <XAxis
                    dataKey="name"
                    tick={{ fontSize: 11, fill: "#64748B" }}
                    axisLine={{ stroke: "#E2E8F0" }}
                    tickLine={false}
                    interval={0}
                    angle={-25}
                    textAnchor="end"
                    height={45}
                  />
                  <YAxis tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
                  <Tooltip
                    contentStyle={{ fontSize: "12px", border: "1px solid #E2E8F0", borderRadius: "8px" }}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px" }} />
                  <Bar
                    dataKey="leads"
                    name="Leads"
                    fill="#0EA5E9"
                    radius={[3, 3, 0, 0]}
                    cursor="pointer"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onClick={(entry: any) =>
                      setDrill({
                        open: true,
                        title: `Leads assigned to ${entry.name as string}`,
                        description: "All leads currently assigned to this ICR",
                        filters: { assignedICRId: entry.icrId as string },
                      })
                    }
                  />
                  <Bar
                    dataKey="enrolled"
                    name="Enrolled"
                    fill="#22C55E"
                    radius={[3, 3, 0, 0]}
                    cursor="pointer"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onClick={(entry: any) =>
                      setDrill({
                        open: true,
                        title: `Enrolled leads for ${entry.name as string}`,
                        description: "Enrolled leads currently assigned to this ICR",
                        filters: { assignedICRId: entry.icrId as string, stage: "ENROLLED" },
                      })
                    }
                  />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Source Performance */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold text-slate-800 dark:text-slate-200">Source Performance</CardTitle>
          <p className="text-xs text-slate-500 dark:text-slate-400">Lead generation by source in this region</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[220px] w-full" />
          ) : !data?.sourcePerformance?.length ? (
            <div className="flex items-center justify-center h-24 text-slate-400 dark:text-slate-500 text-sm">No source data</div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={data.sourcePerformance}
                margin={{ top: 5, right: 20, left: 0, bottom: 5 }}
                barSize={18}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "#64748B" }}
                  axisLine={{ stroke: "#E2E8F0" }}
                  tickLine={false}
                  interval={0}
                  angle={-20}
                  textAnchor="end"
                  height={40}
                />
                <YAxis tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{ fontSize: "12px", border: "1px solid #E2E8F0", borderRadius: "8px" }}
                />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: "11px" }} />
                <Bar
                  dataKey="leads"
                  name="Leads"
                  fill="#0EA5E9"
                  radius={[3, 3, 0, 0]}
                  cursor="pointer"
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  onClick={(entry: any) =>
                    setDrill({
                      open: true,
                      title: `Leads from ${entry.name as string}`,
                      description: "Students acquired through this source",
                      filters: { search: entry.name as string },
                    })
                  }
                />
                <Bar
                  dataKey="enrolled"
                  name="Enrolled"
                  fill="#22C55E"
                  radius={[3, 3, 0, 0]}
                  cursor="pointer"
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  onClick={(entry: any) =>
                    setDrill({
                      open: true,
                      title: `Enrolled leads from ${entry.name as string}`,
                      description: "Students enrolled through this source",
                      filters: { search: entry.name as string, stage: "ENROLLED" },
                    })
                  }
                />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-12 gap-4">
        {/* Upcoming Events */}
        <Card className="col-span-12 lg:col-span-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-slate-800 dark:text-slate-200">Upcoming Events</CardTitle>
            <p className="text-xs text-slate-500 dark:text-slate-400">Click to view event details</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : !data?.upcomingEvents?.length ? (
              <div className="text-slate-400 dark:text-slate-500 text-sm text-center py-6">No upcoming events</div>
            ) : (
              <div className="space-y-2">
                {data.upcomingEvents.map((event) => (
                  <button
                    key={event.id}
                    onClick={() => router.push(`/events`)}
                    className="w-full text-left flex items-center justify-between py-2 border-b border-slate-50 dark:border-slate-800 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded px-2 -mx-2 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{event.name}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {new Date(event.date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })} · {event.city}, {event.country}
                      </p>
                    </div>
                    <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 shrink-0 ml-2">
                      {event.type.replace(/_/g, " ")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Pending Reports */}
        <Card className="col-span-12 lg:col-span-6">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-slate-800 dark:text-slate-200">Pending Reports</CardTitle>
            <p className="text-xs text-slate-500 dark:text-slate-400">Click to review a report</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : !data?.pendingReports?.length ? (
              <div className="text-slate-400 dark:text-slate-500 text-sm text-center py-6">No pending reports</div>
            ) : (
              <div className="space-y-2">
                {data.pendingReports.map((report) => (
                  <button
                    key={report.id}
                    onClick={() => router.push(`/reports/${report.id}`)}
                    className="w-full text-left flex items-center justify-between py-2 border-b border-slate-50 dark:border-slate-800 last:border-0 hover:bg-slate-50 dark:hover:bg-slate-800/60 rounded px-2 -mx-2 transition-colors"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{report.institutionName}</p>
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        {report.icrName} · {MONTH_NAMES[report.reportingMonth]} {report.reportingYear}
                      </p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ml-2 font-medium ${STATUS_BADGE[report.status] ?? "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"}`}>
                      {report.status.replace(/_/g, " ")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {error && (
        <div className="p-4 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/30 rounded-lg text-sm text-red-600 dark:text-red-300">
          {error}
        </div>
      )}

      <DrillDownSheet
        open={drill.open}
        onClose={() => setDrill(CLOSED_DRILL)}
        title={drill.title}
        description={drill.description ?? ""}
        filters={drill.filters}
      />
    </div>
  );
}
