"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { TrendingUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/shared/stat-card";
import { ExportButton } from "@/components/shared/export-button";
import { LeadsTrendChart } from "./leads-trend-chart";
import { ConversionFunnel } from "./conversion-funnel";
import { DrillDownSheet } from "./drill-down-sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";

interface AnalyticsOverview {
  totalLeadsYTD: number;
  totalLeadsLastYear: number;
  enrollmentsYTD: number;
  activePartners: number;
  eventsThisYear: number;
  leadsByMonth: Array<{ month: string; current: number; lastYear: number }>;
  stageBreakdown: Record<string, number>;
  topMarkets: Array<{ country: string; leads: number; enrolled: number; conversionRate: number }>;
  topSources: Array<{ sourceId: string | null; name: string; leads: number; enrolled: number; conversionRate: number }>;
  institutionTargets: Array<{ institutionId: string; name: string; target: number; actual: number; attainment: number }>;
}

const DATE_RANGES = [
  { label: "Last 30 Days", value: "30d" },
  { label: "Last 3 Months", value: "3m" },
  { label: "Last 6 Months", value: "6m" },
  { label: "Year to Date", value: "ytd" },
  { label: "Last Year", value: "1y" },
];

function getDateRange(range: string): { startDate: string; endDate: string } {
  const now = new Date();
  const endDate = now.toISOString().split("T")[0];
  let startDate: Date;

  switch (range) {
    case "30d":
      startDate = new Date(now);
      startDate.setDate(now.getDate() - 30);
      break;
    case "3m":
      startDate = new Date(now);
      startDate.setMonth(now.getMonth() - 3);
      break;
    case "6m":
      startDate = new Date(now);
      startDate.setMonth(now.getMonth() - 6);
      break;
    case "1y":
      startDate = new Date(now.getFullYear() - 1, 0, 1);
      break;
    case "ytd":
    default:
      startDate = new Date(now.getFullYear(), 0, 1);
  }

  return { startDate: startDate.toISOString().split("T")[0], endDate };
}

const MARKET_COLORS = ["#1E3A5F", "#0E4F8A", "#0369A1", "#0EA5E9", "#38BDF8", "#7DD3FC", "#BAE6FD", "#0EA5E9", "#0369A1", "#1E3A5F"];

interface DrillDown {
  open: boolean;
  title: string;
  description?: string;
  filters: Record<string, string>;
}

const CLOSED_DRILL: DrillDown = { open: false, title: "", filters: {} };

export function ExecutiveDashboard() {
  const router = useRouter();
  const [dateRange, setDateRange] = useState("ytd");
  const [data, setData] = useState<AnalyticsOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillDown>(CLOSED_DRILL);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const { startDate, endDate } = getDateRange(dateRange);
        const res = await fetch(`/api/analytics/overview?startDate=${startDate}&endDate=${endDate}`);
        if (!res.ok) throw new Error("Failed to load analytics");
        const json = await res.json();
        setData(json);
      } catch (e) {
        setError("Failed to load analytics data");
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, [dateRange]);

  const ytdChange =
    data && data.totalLeadsLastYear > 0
      ? ((data.totalLeadsYTD - data.totalLeadsLastYear) / data.totalLeadsLastYear) * 100
      : undefined;

  // Export data
  const marketsExportData = (data?.topMarkets ?? []).map((m) => ({
    country: m.country,
    leads: m.leads,
    enrolled: m.enrolled,
    conversionRate: `${m.conversionRate}%`,
  }));
  const sourcesExportData = (data?.topSources ?? []).map((s) => ({
    source: s.name,
    leads: s.leads,
    enrolled: s.enrolled,
    conversionRate: `${s.conversionRate}%`,
  }));
  const targetsExportData = (data?.institutionTargets ?? []).map((t) => ({
    institution: t.name,
    target: t.target,
    actual: t.actual,
    attainment: `${t.attainment}%`,
  }));
  const trendExportData = (data?.leadsByMonth ?? []).map((m) => ({
    month: m.month,
    thisYear: m.current,
    lastYear: m.lastYear,
  }));

  const combinedExportData = [
    ...trendExportData,
    ...marketsExportData.map((m) => ({ month: "", thisYear: 0, lastYear: 0, ...m })),
  ];

  return (
    <div className="space-y-6">
      {/* Header controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <ExportButton
          title="Executive Analytics"
          exports={[
            {
              label: "Monthly Trend",
              data: trendExportData,
              columns: [
                { key: "month", header: "Month" },
                { key: "thisYear", header: "This Year" },
                { key: "lastYear", header: "Last Year" },
              ],
              filename: "analytics_monthly_trend",
            },
            {
              label: "Top Markets",
              data: marketsExportData,
              columns: [
                { key: "country", header: "Country" },
                { key: "leads", header: "Leads" },
                { key: "enrolled", header: "Enrolled" },
                { key: "conversionRate", header: "Conv. Rate" },
              ],
              filename: "analytics_top_markets",
            },
            {
              label: "Top Sources",
              data: sourcesExportData,
              columns: [
                { key: "source", header: "Source" },
                { key: "leads", header: "Leads" },
                { key: "enrolled", header: "Enrolled" },
                { key: "conversionRate", header: "Conv. Rate" },
              ],
              filename: "analytics_top_sources",
            },
            {
              label: "Institution Targets",
              data: targetsExportData,
              columns: [
                { key: "institution", header: "Institution" },
                { key: "target", header: "Target" },
                { key: "actual", header: "Actual" },
                { key: "attainment", header: "Attainment" },
              ],
              filename: "analytics_institution_targets",
            },
          ]}
        />
        <Select value={dateRange} onValueChange={setDateRange}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DATE_RANGES.map((r) => (
              <SelectItem key={r.value} value={r.value}>
                {r.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          title="Total Leads YTD"
          value={loading ? "—" : (data?.totalLeadsYTD ?? 0).toLocaleString()}
          change={ytdChange}
          changeLabel="vs last year"
          icon="Users"
          iconColor="text-[#0EA5E9]"
          iconBg="bg-[#0EA5E9]/10"
          loading={loading}
          onClick={() => setDrill({
            open: true,
            title: "All Leads",
            description: "Every lead currently in the pipeline",
            filters: {},
          })}
        />
        <StatCard
          title="Enrollments YTD"
          value={loading ? "—" : (data?.enrollmentsYTD ?? 0).toLocaleString()}
          icon="GraduationCap"
          iconColor="text-[#22C55E]"
          iconBg="bg-[#22C55E]/10"
          loading={loading}
          onClick={() => setDrill({
            open: true,
            title: "Enrolled Students",
            description: "Leads that have reached the Enrolled stage",
            filters: { stage: "ENROLLED" },
          })}
        />
        <StatCard
          title="Active Partners"
          value={loading ? "—" : (data?.activePartners ?? 0).toLocaleString()}
          icon="Handshake"
          iconColor="text-[#F59E0B]"
          iconBg="bg-[#F59E0B]/10"
          loading={loading}
          onClick={() => router.push("/institutions")}
        />
        <StatCard
          title="Events This Year"
          value={loading ? "—" : (data?.eventsThisYear ?? 0).toLocaleString()}
          icon="CalendarDays"
          iconColor="text-[#1E3A5F]"
          iconBg="bg-[#1E3A5F]/10"
          loading={loading}
          onClick={() => router.push("/events")}
        />
      </div>

      {/* Row 1: Trend + Funnel */}
      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 lg:col-span-8">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-slate-800">Lead Volume Trend</CardTitle>
            <p className="text-xs text-slate-500">Monthly comparison — this year vs last year</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : (
              <LeadsTrendChart data={data?.leadsByMonth ?? []} />
            )}
          </CardContent>
        </Card>

        <Card className="col-span-12 lg:col-span-4">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-slate-800">Enrollment Funnel</CardTitle>
            <p className="text-xs text-slate-500">Click a stage to view leads</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {Array(6).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : (
              <ConversionFunnel
                stageBreakdown={data?.stageBreakdown ?? {}}
                onStageClick={(stage) =>
                  setDrill({
                    open: true,
                    title: `Leads — ${stage.replace(/_/g, " ")}`,
                    description: "Students currently at this pipeline stage",
                    filters: { stage },
                  })
                }
              />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Top Markets + Top Sources */}
      <div className="grid grid-cols-12 gap-4">
        <Card className="col-span-12 lg:col-span-7">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-slate-800">Top 10 Markets</CardTitle>
            <p className="text-xs text-slate-500">Click a bar to view leads from that country</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={data?.topMarkets ?? []}
                  layout="vertical"
                  margin={{ top: 0, right: 50, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "#64748B" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="country"
                    width={110}
                    tick={{ fontSize: 11, fill: "#64748B" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(value, name) => [
                      value,
                      name === "leads" ? "Leads" : "Enrolled",
                    ]}
                    contentStyle={{
                      fontSize: "12px",
                      border: "1px solid #E2E8F0",
                      borderRadius: "8px",
                      cursor: "pointer",
                    }}
                  />
                  <Bar
                    dataKey="leads"
                    radius={[0, 4, 4, 0]}
                    maxBarSize={20}
                    cursor="pointer"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onClick={(entry: any) =>
                      setDrill({
                        open: true,
                        title: `Leads from ${entry.country as string}`,
                        description: "Students with country of residence matching this market",
                        filters: { country: entry.country as string },
                      })
                    }
                  >
                    {(data?.topMarkets ?? []).map((_, index) => (
                      <Cell key={index} fill={MARKET_COLORS[index % MARKET_COLORS.length]} />
                    ))}
                    <LabelList
                      dataKey="conversionRate"
                      position="right"
                      style={{ fontSize: "10px", fill: "#22C55E", fontWeight: 600 }}
                      formatter={(v: unknown) => `${v}%`}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card className="col-span-12 lg:col-span-5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-slate-800">Top 5 Sources</CardTitle>
            <p className="text-xs text-slate-500">Click a bar to view leads from that source</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[280px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart
                  data={data?.topSources ?? []}
                  layout="vertical"
                  margin={{ top: 0, right: 50, left: 0, bottom: 0 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" horizontal={false} />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11, fill: "#64748B" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={90}
                    tick={{ fontSize: 11, fill: "#64748B" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    formatter={(value, name) => [
                      name === "conversionRate" ? `${value}%` : value,
                      name === "leads" ? "Leads" : name === "enrolled" ? "Enrolled" : "Conv. Rate",
                    ]}
                    contentStyle={{
                      fontSize: "12px",
                      border: "1px solid #E2E8F0",
                      borderRadius: "8px",
                    }}
                  />
                  <Bar
                    dataKey="leads"
                    fill="#0EA5E9"
                    radius={[0, 4, 4, 0]}
                    maxBarSize={20}
                    cursor="pointer"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onClick={(entry: any) =>
                      setDrill({
                        open: true,
                        title: `Leads from ${entry.name as string}`,
                        description: "Students acquired through this source",
                        filters: entry.sourceId
                          ? { sourceId: entry.sourceId as string }
                          : { search: entry.name as string },
                      })
                    }
                  >
                    <LabelList
                      dataKey="conversionRate"
                      position="right"
                      style={{ fontSize: "10px", fill: "#22C55E", fontWeight: 600 }}
                      formatter={(v: unknown) => `${v}%`}
                    />
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Row 3: Institution Targets */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-[#1E3A5F]" />
            <CardTitle className="text-base font-semibold text-slate-800">
              Enrollment Target vs Actual — by Institution
            </CardTitle>
          </div>
          <p className="text-xs text-slate-500">Click a row to view institution details</p>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-[220px] w-full" />
          ) : !data?.institutionTargets?.length ? (
            <div className="flex items-center justify-center h-32 text-slate-400 text-sm">
              No institution targets configured
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="text-left text-xs font-semibold text-slate-500 py-2 pr-4">Institution</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">Target</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">Actual</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 pl-4">Attainment</th>
                    <th className="w-40 text-xs font-semibold text-slate-500 py-2 pl-6">Progress</th>
                  </tr>
                </thead>
                <tbody>
                  {data.institutionTargets.map((inst) => (
                    <tr
                      key={inst.institutionId}
                      className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer transition-colors"
                      onClick={() => router.push(`/institutions/${inst.institutionId}`)}
                    >
                      <td className="py-3 pr-4 font-medium text-slate-800 hover:text-[#1E3A5F]">{inst.name}</td>
                      <td className="py-3 px-4 text-right text-slate-600">{inst.target}</td>
                      <td className="py-3 px-4 text-right font-semibold text-[#1E3A5F]">{inst.actual}</td>
                      <td className="py-3 pl-4 text-right">
                        <span
                          className={`text-xs font-bold ${
                            inst.attainment >= 100
                              ? "text-[#22C55E]"
                              : inst.attainment >= 70
                              ? "text-[#F59E0B]"
                              : "text-[#EF4444]"
                          }`}
                        >
                          {inst.attainment}%
                        </span>
                      </td>
                      <td className="py-3 pl-6">
                        <div className="w-full bg-slate-100 rounded-full h-2">
                          <div
                            className="h-2 rounded-full transition-all duration-700"
                            style={{
                              width: `${Math.min(100, inst.attainment)}%`,
                              backgroundColor:
                                inst.attainment >= 100
                                  ? "#22C55E"
                                  : inst.attainment >= 70
                                  ? "#F59E0B"
                                  : "#EF4444",
                            }}
                          />
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

      {error && (
        <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
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
