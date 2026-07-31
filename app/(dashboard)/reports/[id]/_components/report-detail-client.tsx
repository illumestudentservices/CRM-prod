"use client";

import { useState } from "react";
import Link from "next/link";
import {
  Edit,
  Printer,
  Download,
  Mail,
  Send,
  Loader2,
  Users,
  GraduationCap,
  Target,
  Phone,
  Calendar,
  DollarSign,
  BookOpen,
  Globe,
  CalendarRange,
  MessageSquare,
  BarChart3,
  TrendingUp,
  Lightbulb,
  Compass,
  ClipboardList,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { StatCard } from "@/components/shared/stat-card";
import { EmailSectionButton } from "@/components/shared/email-section-button";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";
import { stageHex } from "@/lib/lead-pipeline";
import { snapshotName, type SnapshotName } from "@/lib/person-name";


const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-slate-100 text-slate-600" },
  PENDING_REVIEW: { label: "Submitted", className: "bg-blue-100 text-blue-800" },
  REGIONAL_APPROVED: { label: "Submitted", className: "bg-blue-100 text-blue-800" },
  HQ_REVIEW: { label: "Submitted", className: "bg-blue-100 text-blue-800" },
  FINAL_APPROVED: { label: "Submitted", className: "bg-blue-100 text-blue-800" },
  RETURNED: { label: "Submitted", className: "bg-blue-100 text-blue-800" },
};

interface Approval {
  id: string;
  action: string;
  comment: string | null;
  createdAt: string;
  user: { name: string | null; role: string };
}

interface ReportDetailClientProps {
  report: {
    id: string;
    icrId: string;
    status: string;
    reportingMonth: number;
    reportingYear: number;
    engagementNotes: string | null;
    challengesOpportunities: string | null;
    successStories: string | null;
    marketInsights: string | null;
    nextMonthPlan: string | null;
    pdfUrl: string | null;
    icr: { id: string; name: string | null; email: string };
    institution: { id: string; name: string; country: string };
    region: { id: string; name: string } | null;
    approvals: Approval[];
  };
  kpi: {
    totalLeads: number;
    enrolled: number;
    conversionRate: number;
    contactRate: number;
    eventsCount: number;
    totalEventCost: number;
  } | null;
  prevKpi: {
    totalLeads: number;
    enrolled: number;
    conversionRate: number;
    contactRate: number;
    eventsCount: number;
    totalEventCost: number;
  } | null;
  leads: Array<SnapshotName & { id: string; nationality: string; interestedProgram: string; studyLevel: string; stage: string }>;
  programs: Array<{ program: string; count: number; levels: Record<string, number> }>;
  sources: Array<{ name: string; leads: number; enrolled: number }>;
  events: Array<{ id: string; name: string; type: string; location: string; cost: number; leadsGenerated: number; roi: number | null }>;
  weeklyByType: Array<{ type: string; label: string; weeks: Record<number, number>; totalTarget: number }>;
  sectionHtmls: {
    kpi: string;
    leads: string;
    programs: string;
    sources: string;
    events: string;
    weeklyActivities: string;
  };
  canEdit: boolean;
  userRole: string;
  monthName: string;
}

function trendPercent(current: number, prev: number | undefined): number | undefined {
  if (prev === undefined || prev === 0) return undefined;
  return ((current - prev) / prev) * 100;
}

export function ReportDetailClient({
  report,
  kpi,
  prevKpi,
  leads,
  programs,
  sources,
  events,
  weeklyByType,
  sectionHtmls,
  canEdit,
  monthName,
}: ReportDetailClientProps) {
  const { toast } = useToast();
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailTo, setEmailTo] = useState("");
  const [emailMsg, setEmailMsg] = useState("");
  const [emailSending, setEmailSending] = useState(false);

  const period = `${monthName} ${report.reportingYear}`;
  const icrName = report.icr.name ?? report.icr.email;
  const statusCfg = STATUS_CONFIG[report.status] ?? STATUS_CONFIG["DRAFT"];

  const stageData = leads.reduce<Record<string, number>>((acc, l) => {
    acc[l.stage] = (acc[l.stage] ?? 0) + 1;
    return acc;
  }, {});
  const stageChartData = Object.entries(stageData).map(([stage, count]) => ({
    name: stage.replace(/_/g, " "),
    value: count,
    fill: stageHex(stage),
  }));

  const sourceChartData = sources.slice(0, 8).map((s) => ({
    name: s.name.length > 15 ? s.name.slice(0, 15) + "..." : s.name,
    Leads: s.leads,
    Enrolled: s.enrolled,
  }));

  async function handleSendReport() {
    if (!emailTo.trim()) return;
    setEmailSending(true);
    try {
      const res = await fetch("/api/email/send-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reportId: report.id,
          to: emailTo.trim(),
          message: emailMsg.trim() || undefined,
        }),
      });
      if (!res.ok) throw new Error("Failed to send");
      toast({ title: "Report emailed", description: `Sent to ${emailTo}` });
      setEmailOpen(false);
      setEmailTo("");
      setEmailMsg("");
    } catch {
      toast({ title: "Failed to send", variant: "destructive" });
    } finally {
      setEmailSending(false);
    }
  }

  const textSections = [
    { key: "engagement", label: "Engagement Notes", icon: MessageSquare, value: report.engagementNotes },
    { key: "challenges", label: "Challenges & Opportunities", icon: Compass, value: report.challengesOpportunities },
    { key: "success", label: "Success Stories", icon: Lightbulb, value: report.successStories },
    { key: "market", label: "Market Insights", icon: BarChart3, value: report.marketInsights },
    { key: "plan", label: "Next Month Plan", icon: ClipboardList, value: report.nextMonthPlan },
  ].filter((s) => s.value);

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-8">
      {/* ── Professional Header Banner ── */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-[#1E3A5F] via-[#1E3A5F] to-[#0369A1] p-8 text-white shadow-lg">
        <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -translate-y-1/2 translate-x-1/2" />
        <div className="absolute bottom-0 left-0 w-48 h-48 bg-white/5 rounded-full translate-y-1/2 -translate-x-1/2" />
        <div className="relative z-10">
          <div className="flex items-start justify-between flex-wrap gap-4">
            <div>
              <p className="text-xs font-medium text-white/50 uppercase tracking-widest mb-1">Monthly Report</p>
              <h1 className="text-2xl font-bold tracking-tight">{report.institution.name}</h1>
              <p className="mt-1 text-sm text-white/70">
                {period} &middot; ICR: {icrName} &middot; Region: {report.region?.name ?? "N/A"}
              </p>
            </div>
            <span className={`px-3 py-1 rounded-full text-xs font-semibold ${statusCfg.className}`}>
              {statusCfg.label}
            </span>
          </div>
          <div className="flex items-center gap-2 mt-6 flex-wrap">
            {canEdit && (
              <Button asChild size="sm" className="bg-white/15 hover:bg-white/25 text-white border-0">
                <Link href={`/reports/${report.id}/edit`}>
                  <Edit className="h-4 w-4 mr-1.5" /> Edit
                </Link>
              </Button>
            )}
            <Button asChild size="sm" variant="ghost" className="text-white hover:bg-white/15">
              <a href={`/api/reports/${report.id}/pdf`} target="_blank" rel="noopener noreferrer">
                <Printer className="h-4 w-4 mr-1.5" /> Print / PDF
              </a>
            </Button>
            {report.pdfUrl && (
              <Button asChild size="sm" variant="ghost" className="text-white hover:bg-white/15">
                <a href={report.pdfUrl} target="_blank" rel="noopener noreferrer">
                  <Download className="h-4 w-4 mr-1.5" /> Download
                </a>
              </Button>
            )}
            <Button
              size="sm"
              className="bg-white/15 hover:bg-white/25 text-white border-0"
              onClick={() => setEmailOpen(true)}
            >
              <Mail className="h-4 w-4 mr-1.5" /> Email Report
            </Button>
          </div>
        </div>
      </div>

      {/* ── KPI Section ── */}
      {kpi && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-800 flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-[#0EA5E9]" />
              Key Performance Indicators
            </h2>
            <EmailSectionButton
              sectionTitle="KPI Summary"
              sectionHtml={sectionHtmls.kpi}
              defaultSubject={`KPI Summary — ${report.institution.name} — ${period}`}
            />
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
            <StatCard title="Total Leads" value={kpi.totalLeads} icon={Users} change={trendPercent(kpi.totalLeads, prevKpi?.totalLeads)} iconColor="text-[#1E3A5F]" iconBg="bg-[#1E3A5F]/10" />
            <StatCard title="Enrolled" value={kpi.enrolled} icon={GraduationCap} change={trendPercent(kpi.enrolled, prevKpi?.enrolled)} iconColor="text-[#22C55E]" iconBg="bg-[#22C55E]/10" />
            <StatCard title="Conversion Rate" value={`${kpi.conversionRate}%`} icon={Target} change={prevKpi ? kpi.conversionRate - prevKpi.conversionRate : undefined} iconColor="text-[#0369A1]" iconBg="bg-[#0369A1]/10" />
            <StatCard title="Contact Rate" value={`${kpi.contactRate}%`} icon={Phone} change={prevKpi ? kpi.contactRate - prevKpi.contactRate : undefined} iconColor="text-[#8B5CF6]" iconBg="bg-[#8B5CF6]/10" />
            <StatCard title="Events" value={kpi.eventsCount} icon={Calendar} change={trendPercent(kpi.eventsCount, prevKpi?.eventsCount)} iconColor="text-[#F59E0B]" iconBg="bg-[#F59E0B]/10" />
            <StatCard title="Event Cost" value={kpi.totalEventCost > 0 ? `$${kpi.totalEventCost.toLocaleString()}` : "—"} icon={DollarSign} iconColor="text-[#64748b]" iconBg="bg-slate-100" />
          </div>
        </div>
      )}

      {/* ── Visual Charts ── */}
      {(stageChartData.length > 0 || sourceChartData.length > 0) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {stageChartData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-700">Lead Stage Distribution</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={stageChartData} layout="vertical" margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: "#64748b" }} width={100} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize: "12px", borderRadius: "8px", border: "1px solid #e2e8f0" }} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} barSize={16}>
                      {stageChartData.map((entry, idx) => (
                        <Cell key={idx} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
          {sourceChartData.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-slate-700">Source Performance</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={sourceChartData} margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 11, fill: "#94a3b8" }} axisLine={false} tickLine={false} />
                    <Tooltip contentStyle={{ fontSize: "12px", borderRadius: "8px", border: "1px solid #e2e8f0" }} />
                    <Bar dataKey="Leads" fill="#0EA5E9" radius={[4, 4, 0, 0]} barSize={14} />
                    <Bar dataKey="Enrolled" fill="#22C55E" radius={[4, 4, 0, 0]} barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* ── Leads Table ── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
              <Users className="h-4 w-4 text-[#0EA5E9]" />
              Leads Collected
              <span className="text-xs font-normal text-slate-400">({leads.length})</span>
            </CardTitle>
            <EmailSectionButton
              sectionTitle={`Leads Collected (${leads.length})`}
              sectionHtml={sectionHtmls.leads}
              defaultSubject={`Leads — ${report.institution.name} — ${period}`}
            />
          </div>
        </CardHeader>
        <CardContent>
          {leads.length === 0 ? (
            <p className="text-sm text-slate-400">No leads recorded for this period.</p>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-[#1E3A5F] text-white">
                    <th className="text-left font-semibold py-2.5 px-4">Name</th>
                    <th className="text-left font-semibold py-2.5 px-3">Nationality</th>
                    <th className="text-left font-semibold py-2.5 px-3">Program</th>
                    <th className="text-left font-semibold py-2.5 px-3">Level</th>
                    <th className="text-left font-semibold py-2.5 px-3">Stage</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.slice(0, 20).map((lead, i) => (
                    <tr key={lead.id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                      <td className="py-2 px-4 font-medium text-slate-800">{snapshotName(lead)}</td>
                      <td className="py-2 px-3 text-slate-600">{lead.nationality}</td>
                      <td className="py-2 px-3 text-slate-600 max-w-[140px] truncate">{lead.interestedProgram}</td>
                      <td className="py-2 px-3 text-slate-500">{lead.studyLevel}</td>
                      <td className="py-2 px-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold" style={{ background: `${stageHex(lead.stage)}15`, color: stageHex(lead.stage) }}>
                          {lead.stage.replace(/_/g, " ")}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {leads.length > 20 && (
                <p className="text-xs text-slate-400 text-center py-2 bg-slate-50 border-t border-slate-200">+ {leads.length - 20} more leads</p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Program Breakdown ── */}
      {programs.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <BookOpen className="h-4 w-4 text-[#0EA5E9]" /> Program Breakdown
              </CardTitle>
              <EmailSectionButton sectionTitle="Program Breakdown" sectionHtml={sectionHtmls.programs} defaultSubject={`Programs — ${report.institution.name} — ${period}`} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#1E3A5F] text-white">
                    <th className="text-left text-xs font-semibold py-2.5 px-4">Program</th>
                    <th className="text-right text-xs font-semibold py-2.5 px-4">Total</th>
                    <th className="text-right text-xs font-semibold py-2.5 px-4">UG</th>
                    <th className="text-right text-xs font-semibold py-2.5 px-4">PG</th>
                    <th className="text-right text-xs font-semibold py-2.5 px-4">Foundation</th>
                    <th className="text-right text-xs font-semibold py-2.5 px-4">Pathway</th>
                  </tr>
                </thead>
                <tbody>
                  {programs.map((prog, i) => (
                    <tr key={prog.program} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                      <td className="py-2.5 px-4 font-medium text-slate-800">{prog.program}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-[#1E3A5F]">{prog.count}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">{prog.levels?.["UNDERGRADUATE"] ?? 0}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">{prog.levels?.["POSTGRADUATE"] ?? 0}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">{prog.levels?.["FOUNDATION"] ?? 0}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">{prog.levels?.["PATHWAY"] ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Source Performance ── */}
      {sources.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <Globe className="h-4 w-4 text-[#0EA5E9]" /> Source Performance
              </CardTitle>
              <EmailSectionButton sectionTitle="Source Performance" sectionHtml={sectionHtmls.sources} defaultSubject={`Sources — ${report.institution.name} — ${period}`} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#1E3A5F] text-white">
                    <th className="text-left text-xs font-semibold py-2.5 px-4">Source</th>
                    <th className="text-right text-xs font-semibold py-2.5 px-4">Leads</th>
                    <th className="text-right text-xs font-semibold py-2.5 px-4">Enrolled</th>
                    <th className="text-right text-xs font-semibold py-2.5 px-4">Conversion</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((src, i) => (
                    <tr key={src.name} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                      <td className="py-2.5 px-4 font-medium text-slate-800">{src.name}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">{src.leads}</td>
                      <td className="py-2.5 px-4 text-right text-[#22C55E] font-semibold">{src.enrolled}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">{src.leads > 0 ? `${Math.round((src.enrolled / src.leads) * 100)}%` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Events ── */}
      {events.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <Calendar className="h-4 w-4 text-[#0EA5E9]" /> Event Activities & ROI
              </CardTitle>
              <EmailSectionButton sectionTitle="Event Activities & ROI" sectionHtml={sectionHtmls.events} defaultSubject={`Events — ${report.institution.name} — ${period}`} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#1E3A5F] text-white">
                    <th className="text-left text-xs font-semibold py-2.5 px-4">Event</th>
                    <th className="text-left text-xs font-semibold py-2.5 px-3">Location</th>
                    <th className="text-right text-xs font-semibold py-2.5 px-3">Leads</th>
                    <th className="text-right text-xs font-semibold py-2.5 px-3">Cost</th>
                    <th className="text-right text-xs font-semibold py-2.5 px-4">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event, i) => (
                    <tr key={event.id} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                      <td className="py-2.5 px-4 font-medium text-slate-800">{event.name}</td>
                      <td className="py-2.5 px-3 text-slate-600 text-xs">{event.location}</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-[#0EA5E9]">{event.leadsGenerated}</td>
                      <td className="py-2.5 px-3 text-right text-slate-600">{event.cost > 0 ? `$${event.cost.toLocaleString()}` : "—"}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">{event.roi !== null ? event.roi : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Weekly Activities ── */}
      {weeklyByType.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <CalendarRange className="h-4 w-4 text-[#0EA5E9]" /> Weekly Activities Summary
              </CardTitle>
              <EmailSectionButton sectionTitle="Weekly Activities Summary" sectionHtml={sectionHtmls.weeklyActivities} defaultSubject={`Weekly Activities — ${report.institution.name} — ${period}`} />
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-[#1E3A5F] text-white">
                    <th className="text-left text-xs font-semibold py-2.5 px-4">Activity</th>
                    <th className="text-right text-xs font-semibold py-2.5 px-3">Wk 1</th>
                    <th className="text-right text-xs font-semibold py-2.5 px-3">Wk 2</th>
                    <th className="text-right text-xs font-semibold py-2.5 px-3">Wk 3</th>
                    <th className="text-right text-xs font-semibold py-2.5 px-3">Wk 4</th>
                    <th className="text-right text-xs font-semibold py-2.5 px-3">Total</th>
                    <th className="text-right text-xs font-semibold py-2.5 px-4">Target</th>
                  </tr>
                </thead>
                <tbody>
                  {weeklyByType.map((entry, i) => {
                    const w1 = entry.weeks[1] ?? 0;
                    const w2 = entry.weeks[2] ?? 0;
                    const w3 = entry.weeks[3] ?? 0;
                    const w4 = entry.weeks[4] ?? 0;
                    const total = w1 + w2 + w3 + w4;
                    const met = total >= entry.totalTarget;
                    return (
                      <tr key={entry.type} className={i % 2 === 0 ? "bg-white" : "bg-slate-50/50"}>
                        <td className="py-2.5 px-4 font-medium text-slate-800">{entry.label}</td>
                        <td className="py-2.5 px-3 text-right text-slate-600">{w1}</td>
                        <td className="py-2.5 px-3 text-right text-slate-600">{w2}</td>
                        <td className="py-2.5 px-3 text-right text-slate-600">{w3}</td>
                        <td className="py-2.5 px-3 text-right text-slate-600">{w4}</td>
                        <td className={`py-2.5 px-3 text-right font-bold ${met ? "text-[#22C55E]" : "text-[#EF4444]"}`}>{total}</td>
                        <td className="py-2.5 px-4 text-right text-slate-500">{entry.totalTarget}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Text Sections ── */}
      {textSections.map((section) => (
        <Card key={section.key}>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
                <section.icon className="h-4 w-4 text-[#0EA5E9]" /> {section.label}
              </CardTitle>
              <EmailSectionButton
                sectionTitle={section.label}
                sectionHtml={`<div style="border-left:3px solid #1E3A5F;padding:12px 18px;background:#f8fafc;border-radius:0 8px 8px 0;"><p style="margin:0;font-size:13px;color:#334155;line-height:1.7;white-space:pre-wrap;">${section.value!.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>")}</p></div>`}
                defaultSubject={`${section.label} — ${report.institution.name} — ${period}`}
              />
            </div>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-slate-700 whitespace-pre-wrap leading-relaxed">{section.value}</p>
          </CardContent>
        </Card>
      ))}

      {/* ── Email Full Report Dialog ── */}
      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-[#1E3A5F]" />
              Email Full Report
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label>Recipient Email</Label>
              <Input type="email" placeholder="ceo@company.com" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Message <span className="text-slate-400 font-normal">(optional)</span></Label>
              <Textarea placeholder="Add a personal note..." rows={3} value={emailMsg} onChange={(e) => setEmailMsg(e.target.value)} />
            </div>
            <div className="p-3 bg-slate-50 rounded-lg">
              <p className="text-xs text-slate-500">
                Sending: <span className="font-semibold text-slate-700">{report.institution.name} — {period} Monthly Report</span>
              </p>
              <p className="text-xs text-slate-400 mt-1">Includes KPI summary, highlights, and a link to the full report.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEmailOpen(false)}>Cancel</Button>
            <Button onClick={handleSendReport} disabled={!emailTo.trim() || emailSending} className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white">
              {emailSending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              Send Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
