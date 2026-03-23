"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Users, TrendingUp, GraduationCap, ListChecks } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatCard } from "@/components/shared/stat-card";
import { Skeleton } from "@/components/ui/skeleton";
import { ExportButton } from "@/components/shared/export-button";
import { DrillDownSheet } from "./drill-down-sheet";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

interface OverviewData {
  totalLeadsYTD: number;
  enrollmentsYTD: number;
  stageBreakdown: Record<string, number>;
}

interface LeadAttention {
  id: string;
  fullName: string;
  stage: string;
  lastContactedAt: string | null;
  lastProgressedAt: string | null;
  institution?: { name: string } | null;
}

interface ReportStatus {
  id: string;
  reportingMonth: number;
  reportingYear: number;
  status: string;
  institution: { name: string };
}

interface SourceRow {
  name: string;
  leads: number;
}

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STAGE_COLORS: Record<string, string> = {
  NEW: "#1E3A5F",
  CONTACTED: "#0EA5E9",
  APPLICATION_SENT: "#0369A1",
  DOCUMENTS_RECEIVED: "#38BDF8",
  OFFER_ISSUED: "#F59E0B",
  ENROLLED: "#22C55E",
  DEFERRED: "#94A3B8",
  REJECTED: "#EF4444",
  LOST: "#CBD5E1",
};

interface DrillDown {
  open: boolean;
  title: string;
  description?: string;
  filters: Record<string, string>;
}

const CLOSED_DRILL: DrillDown = { open: false, title: "", filters: {} };

export function ICRDashboard() {
  const router = useRouter();
  const [overview, setOverview] = useState<OverviewData | null>(null);
  const [attentionLeads, setAttentionLeads] = useState<LeadAttention[]>([]);
  const [reports, setReports] = useState<ReportStatus[]>([]);
  const [sources, setSources] = useState<SourceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drill, setDrill] = useState<DrillDown>(CLOSED_DRILL);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);
      try {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];
        const today = now.toISOString().split("T")[0];

        const [overviewRes, leadsRes, reportsRes] = await Promise.all([
          fetch(`/api/analytics/overview?startDate=${monthStart}&endDate=${today}`),
          fetch(`/api/leads?limit=100&sortBy=lastContactedAt&sortOrder=asc`),
          fetch(`/api/reports?limit=10`),
        ]);

        if (!overviewRes.ok) throw new Error("Failed to load overview");
        const overviewJson = await overviewRes.json();
        setOverview(overviewJson);

        if (leadsRes.ok) {
          const leadsJson = await leadsRes.json();
          const now48h = Date.now() - 48 * 60 * 60 * 1000;
          const now7d = Date.now() - 7 * 24 * 60 * 60 * 1000;

          const needsAttention = (leadsJson.leads ?? []).filter((lead: LeadAttention) => {
            const lastContact = lead.lastContactedAt ? new Date(lead.lastContactedAt).getTime() : 0;
            const lastProgress = lead.lastProgressedAt ? new Date(lead.lastProgressedAt).getTime() : 0;
            const notContacted48h = lastContact < now48h;
            const noProgress7d = lastProgress < now7d;
            return (notContacted48h || noProgress7d) && !["ENROLLED", "REJECTED", "LOST"].includes(lead.stage);
          });
          setAttentionLeads(needsAttention.slice(0, 10));

          const srcMap: Record<string, number> = {};
          for (const lead of leadsJson.leads ?? []) {
            if (lead.source?.name) {
              srcMap[lead.source.name] = (srcMap[lead.source.name] ?? 0) + 1;
            }
          }
          const srcRows = Object.entries(srcMap)
            .map(([name, leads]) => ({ name, leads }))
            .sort((a, b) => b.leads - a.leads)
            .slice(0, 5);
          setSources(srcRows);
        }

        if (reportsRes.ok) {
          const reportsJson = await reportsRes.json();
          setReports(reportsJson.reports ?? []);
        }
      } catch (e) {
        setError("Failed to load dashboard data");
        console.error(e);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  const stages = overview?.stageBreakdown ?? {};
  const newLeads = stages["NEW"] ?? 0;
  const inProgress = (stages["CONTACTED"] ?? 0) + (stages["APPLICATION_SENT"] ?? 0) + (stages["DOCUMENTS_RECEIVED"] ?? 0) + (stages["OFFER_ISSUED"] ?? 0);
  const enrolled = stages["ENROLLED"] ?? 0;
  const totalLeads = overview?.totalLeadsYTD ?? 0;

  const pipelineData = Object.entries(stages)
    .filter(([stage]) => !["REJECTED", "LOST"].includes(stage))
    .map(([stage, count]) => ({
      stage: stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      key: stage,
      count,
    }));

  const reportStatusBadge: Record<string, string> = {
    DRAFT: "bg-slate-100 text-slate-600",
    PENDING_REVIEW: "bg-amber-100 text-amber-800",
    REGIONAL_APPROVED: "bg-blue-100 text-blue-800",
    HQ_REVIEW: "bg-indigo-100 text-indigo-800",
    FINAL_APPROVED: "bg-green-100 text-green-800",
    RETURNED: "bg-red-100 text-red-800",
  };

  // Export data
  const stageExportData = pipelineData.map((p) => ({ stage: p.stage, count: p.count }));
  const attentionExportData = attentionLeads.map((l) => ({
    name: l.fullName,
    stage: l.stage.replace(/_/g, " "),
    lastContact: l.lastContactedAt
      ? new Date(l.lastContactedAt).toLocaleDateString("en-GB")
      : "Never",
    institution: l.institution?.name ?? "",
  }));

  return (
    <div className="space-y-6">
      {/* Export */}
      <div className="flex justify-end">
        <ExportButton
          title="My Analytics"
          exports={[
            {
              label: "Pipeline Stages",
              data: stageExportData,
              columns: [
                { key: "stage", header: "Stage" },
                { key: "count", header: "Count" },
              ],
              filename: "my_pipeline_stages",
            },
            {
              label: "Leads Needing Attention",
              data: attentionExportData,
              columns: [
                { key: "name", header: "Name" },
                { key: "stage", header: "Stage" },
                { key: "lastContact", header: "Last Contact" },
                { key: "institution", header: "Institution" },
              ],
              filename: "leads_needing_attention",
            },
          ]}
        />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="New This Month" value={loading ? "—" : newLeads} icon={Users} iconColor="text-[#0EA5E9]" iconBg="bg-[#0EA5E9]/10" loading={loading} />
        <StatCard title="In Progress" value={loading ? "—" : inProgress} icon={TrendingUp} iconColor="text-[#F59E0B]" iconBg="bg-[#F59E0B]/10" loading={loading} />
        <StatCard title="Enrolled" value={loading ? "—" : enrolled} icon={GraduationCap} iconColor="text-[#22C55E]" iconBg="bg-[#22C55E]/10" loading={loading} />
        <StatCard title="Total (YTD)" value={loading ? "—" : totalLeads} icon={ListChecks} iconColor="text-[#1E3A5F]" iconBg="bg-[#1E3A5F]/10" loading={loading} />
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Mini pipeline chart */}
        <Card className="col-span-12 lg:col-span-5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-slate-800">My Pipeline</CardTitle>
            <p className="text-xs text-slate-500">Click a bar to view leads at that stage</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-[200px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart
                  data={pipelineData}
                  layout="vertical"
                  margin={{ top: 0, right: 30, left: 0, bottom: 0 }}
                  barSize={14}
                >
                  <XAxis type="number" tick={{ fontSize: 11, fill: "#64748B" }} axisLine={false} tickLine={false} />
                  <YAxis
                    type="category"
                    dataKey="stage"
                    width={100}
                    tick={{ fontSize: 10, fill: "#64748B" }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <Tooltip
                    contentStyle={{ fontSize: "12px", border: "1px solid #E2E8F0", borderRadius: "8px" }}
                    formatter={(v: unknown) => [v as number, "Leads"]}
                  />
                  <Bar
                    dataKey="count"
                    radius={[0, 4, 4, 0]}
                    cursor="pointer"
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    onClick={(entry: any) =>
                      setDrill({
                        open: true,
                        title: `My Leads — ${entry.stage as string}`,
                        description: "Your leads currently at this stage",
                        filters: { stage: entry.key as string },
                      })
                    }
                  >
                    {pipelineData.map((entry) => (
                      <Cell key={entry.key} fill={STAGE_COLORS[entry.key] ?? "#0EA5E9"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Leads Needing Attention */}
        <Card className="col-span-12 lg:col-span-7">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-slate-800">Leads Needing Attention</CardTitle>
            <p className="text-xs text-slate-500">Click a row to open the lead</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : !attentionLeads.length ? (
              <div className="text-center py-8 text-slate-400 text-sm">All caught up! No leads needing immediate attention.</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left text-xs font-semibold text-slate-500 py-2 pr-3">Name</th>
                      <th className="text-left text-xs font-semibold text-slate-500 py-2 px-3">Stage</th>
                      <th className="text-left text-xs font-semibold text-slate-500 py-2 px-3">Last Contact</th>
                      <th className="text-left text-xs font-semibold text-slate-500 py-2 pl-3">Institution</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attentionLeads.map((lead) => {
                      const lastContact = lead.lastContactedAt ? new Date(lead.lastContactedAt) : null;
                      const daysSince = lastContact
                        ? Math.floor((Date.now() - lastContact.getTime()) / (1000 * 60 * 60 * 24))
                        : null;
                      return (
                        <tr
                          key={lead.id}
                          className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer transition-colors"
                          onClick={() => router.push(`/students/${lead.id}`)}
                        >
                          <td className="py-2.5 pr-3 font-medium text-slate-800 hover:text-[#1E3A5F]">{lead.fullName}</td>
                          <td className="py-2.5 px-3">
                            <span className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
                              {lead.stage.replace(/_/g, " ")}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-xs text-slate-500">
                            {daysSince !== null ? (
                              <span className={daysSince >= 7 ? "text-[#EF4444] font-semibold" : daysSince >= 2 ? "text-[#F59E0B] font-semibold" : ""}>
                                {daysSince === 0 ? "Today" : `${daysSince}d ago`}
                              </span>
                            ) : (
                              <span className="text-[#EF4444] font-semibold">Never</span>
                            )}
                          </td>
                          <td className="py-2.5 pl-3 text-xs text-slate-500 truncate max-w-[120px]">
                            {lead.institution?.name ?? "—"}
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
      </div>

      <div className="grid grid-cols-12 gap-4">
        {/* Report submissions */}
        <Card className="col-span-12 lg:col-span-7">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-slate-800">My Reports</CardTitle>
            <p className="text-xs text-slate-500">Click a row to open the report</p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array(4).fill(0).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
              </div>
            ) : !reports.length ? (
              <div className="text-center py-6 text-slate-400 text-sm">No reports yet</div>
            ) : (
              <div className="space-y-2">
                {reports.map((report) => (
                  <button
                    key={report.id}
                    onClick={() => router.push(`/reports/${report.id}`)}
                    className="w-full text-left flex items-center justify-between py-2 border-b border-slate-50 last:border-0 hover:bg-slate-50 rounded px-2 -mx-2 transition-colors"
                  >
                    <div>
                      <p className="text-sm font-medium text-slate-800">{report.institution.name}</p>
                      <p className="text-xs text-slate-500">{MONTH_NAMES[report.reportingMonth]} {report.reportingYear}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${reportStatusBadge[report.status] ?? "bg-slate-100 text-slate-600"}`}>
                      {report.status.replace(/_/g, " ")}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Top sources */}
        <Card className="col-span-12 lg:col-span-5">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold text-slate-800">My Top Sources</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                {Array(5).fill(0).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
              </div>
            ) : !sources.length ? (
              <div className="text-center py-6 text-slate-400 text-sm">No source data</div>
            ) : (
              <div className="space-y-3">
                {sources.map((src, i) => (
                  <button
                    key={src.name}
                    onClick={() =>
                      setDrill({
                        open: true,
                        title: `Leads from ${src.name}`,
                        description: "Your leads acquired through this source",
                        filters: { search: src.name },
                      })
                    }
                    className="w-full text-left flex items-center gap-3 hover:bg-slate-50 rounded px-1 -mx-1 py-1 transition-colors"
                  >
                    <span className="text-xs font-bold text-slate-400 w-4">#{i + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-slate-700 truncate">{src.name}</span>
                        <span className="text-xs font-bold text-slate-800 ml-2">{src.leads}</span>
                      </div>
                      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#0EA5E9]"
                          style={{ width: `${(src.leads / (sources[0]?.leads ?? 1)) * 100}%` }}
                        />
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

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
