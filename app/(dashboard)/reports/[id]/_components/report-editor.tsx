"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Save, Send, Loader2, Users, BookOpen, Globe, Calendar, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ForecastSection } from "./forecast-section";

type ReportStatus = "DRAFT" | "PENDING_REVIEW" | "REGIONAL_APPROVED" | "HQ_REVIEW" | "FINAL_APPROVED" | "RETURNED";

interface LeadData {
  id: string;
  fullName: string;
  email: string;
  stage: string;
  studyLevel: string;
  interestedProgram: string;
  nationality: string;
  createdAt: string;
}

interface ProgramRow {
  program: string;
  count: number;
  levels: Record<string, number>;
}

interface SourceRow {
  name: string;
  leads: number;
  enrolled: number;
}

interface EventRow {
  id: string;
  name: string;
  type: string;
  date: string;
  location: string;
  cost: number;
  leadsGenerated: number;
  roi: number | null;
}

interface KpiSummary {
  totalLeads: number;
  enrolled: number;
  conversionRate: number;
  contactRate: number;
  eventsCount: number;
  totalEventCost: number;
}

interface ReportData {
  id: string;
  icrId: string;
  institutionId: string;
  reportingMonth: number;
  reportingYear: number;
  status: ReportStatus;
  leadsData: LeadData[] | null;
  programBreakdown: ProgramRow[] | null;
  sourcePerformance: SourceRow[] | null;
  eventActivities: EventRow[] | null;
  kpiSummary: KpiSummary | null;
  engagementNotes: string | null;
  challengesOpportunities: string | null;
  nextMonthPlan: string | null;
  icr: { id: string; name: string | null };
  institution: { id: string; name: string };
}

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STAGE_COLORS: Record<string, string> = {
  ENROLLED: "text-[#22C55E]",
  OFFER_ISSUED: "text-[#F59E0B]",
  REJECTED: "text-[#EF4444]",
  LOST: "text-[#EF4444]",
};

export function ReportEditor({ report }: { report: ReportData }) {
  const router = useRouter();

  const [engagementNotes, setEngagementNotes] = useState(report.engagementNotes ?? "");
  const [challengesOpportunities, setChallengesOpportunities] = useState(report.challengesOpportunities ?? "");
  const [nextMonthPlan, setNextMonthPlan] = useState(report.nextMonthPlan ?? "");
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const saveField = useCallback(async (field: string, value: string) => {
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [field]: value }),
      });
      if (!res.ok) throw new Error("Save failed");
      setLastSaved(new Date());
    } catch {
      setSaveError("Auto-save failed. Your changes may not be saved.");
    } finally {
      setSaving(false);
    }
  }, [report.id]);

  async function handleSubmit() {
    setSubmitting(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/reports/${report.id}/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SUBMIT" }),
      });
      if (!res.ok) {
        const err = await res.json();
        setSaveError(err.error ?? "Failed to submit report");
        return;
      }
      router.push(`/reports/${report.id}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  const leads = report.leadsData ?? [];
  const programs = report.programBreakdown ?? [];
  const sources = report.sourcePerformance ?? [];
  const events = report.eventActivities ?? [];
  const kpi = report.kpiSummary;

  return (
    <div className="space-y-6">
      {/* Auto-save status */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          {saving && (
            <>
              <Loader2 className="h-3 w-3 animate-spin" />
              Saving...
            </>
          )}
          {!saving && lastSaved && (
            <>
              <Save className="h-3 w-3 text-[#22C55E]" />
              Saved {lastSaved.toLocaleTimeString()}
            </>
          )}
          {saveError && (
            <span className="text-[#EF4444] flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" /> {saveError}
            </span>
          )}
        </div>
        <Button
          onClick={handleSubmit}
          disabled={submitting}
          className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white"
        >
          {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
          Submit for Review
        </Button>
      </div>

      {/* Section 1: Leads Collected */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <Users className="h-4 w-4 text-[#0EA5E9]" />
            Section 2: Leads Collected
            <span className="text-xs font-normal text-slate-400 ml-1">(auto-populated)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {leads.length === 0 ? (
            <p className="text-sm text-slate-400">No leads recorded for this period.</p>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left font-semibold text-slate-500 py-2 px-3">Name</th>
                    <th className="text-left font-semibold text-slate-500 py-2 px-3">Nationality</th>
                    <th className="text-left font-semibold text-slate-500 py-2 px-3">Program</th>
                    <th className="text-left font-semibold text-slate-500 py-2 px-3">Level</th>
                    <th className="text-left font-semibold text-slate-500 py-2 px-3">Stage</th>
                    <th className="text-left font-semibold text-slate-500 py-2 px-3">Added</th>
                  </tr>
                </thead>
                <tbody>
                  {leads.slice(0, 20).map((lead) => (
                    <tr key={lead.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                      <td className="py-2 px-3 font-medium text-slate-800">{lead.fullName}</td>
                      <td className="py-2 px-3 text-slate-600">{lead.nationality}</td>
                      <td className="py-2 px-3 text-slate-600 max-w-[150px] truncate">{lead.interestedProgram}</td>
                      <td className="py-2 px-3 text-slate-500">{lead.studyLevel}</td>
                      <td className={`py-2 px-3 font-medium ${STAGE_COLORS[lead.stage] ?? "text-slate-600"}`}>
                        {lead.stage.replace(/_/g, " ")}
                      </td>
                      <td className="py-2 px-3 text-slate-400">
                        {new Date(lead.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {leads.length > 20 && (
                <p className="text-xs text-slate-400 text-center py-2 bg-slate-50 border-t border-slate-200">
                  + {leads.length - 20} more leads
                </p>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 3: Program Breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-[#0EA5E9]" />
            Section 3: Program Breakdown
            <span className="text-xs font-normal text-slate-400 ml-1">(auto-populated)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {programs.length === 0 ? (
            <p className="text-sm text-slate-400">No program data available.</p>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left text-xs font-semibold text-slate-500 py-2 px-4">Program</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">Total</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">UG</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">PG</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">Foundation</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">Pathway</th>
                  </tr>
                </thead>
                <tbody>
                  {programs.map((prog) => (
                    <tr key={prog.program} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                      <td className="py-2.5 px-4 font-medium text-slate-800">{prog.program}</td>
                      <td className="py-2.5 px-4 text-right font-bold text-[#1E3A5F]">{prog.count}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">{prog.levels["UNDERGRADUATE"] ?? 0}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">{prog.levels["POSTGRADUATE"] ?? 0}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">{prog.levels["FOUNDATION"] ?? 0}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">{prog.levels["PATHWAY"] ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 4: Source Performance */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <Globe className="h-4 w-4 text-[#0EA5E9]" />
            Section 4: Source Performance
            <span className="text-xs font-normal text-slate-400 ml-1">(auto-populated)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {sources.length === 0 ? (
            <p className="text-sm text-slate-400">No source data available.</p>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left text-xs font-semibold text-slate-500 py-2 px-4">Source</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">Leads</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">Enrolled</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">Conv. Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((src) => (
                    <tr key={src.name} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                      <td className="py-2.5 px-4 font-medium text-slate-800">{src.name}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">{src.leads}</td>
                      <td className="py-2.5 px-4 text-right text-[#22C55E] font-semibold">{src.enrolled}</td>
                      <td className="py-2.5 px-4 text-right text-slate-600">
                        {src.leads > 0 ? `${Math.round((src.enrolled / src.leads) * 100)}%` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 5: Event Activities */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <Calendar className="h-4 w-4 text-[#0EA5E9]" />
            Section 5: Event Activities & ROI
            <span className="text-xs font-normal text-slate-400 ml-1">(auto-populated)</span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {events.length === 0 ? (
            <p className="text-sm text-slate-400">No events during this reporting period.</p>
          ) : (
            <div className="overflow-x-auto border border-slate-200 rounded-lg">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="text-left text-xs font-semibold text-slate-500 py-2 px-4">Event</th>
                    <th className="text-left text-xs font-semibold text-slate-500 py-2 px-3">Type</th>
                    <th className="text-left text-xs font-semibold text-slate-500 py-2 px-3">Location</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-3">Leads</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-3">Cost</th>
                    <th className="text-right text-xs font-semibold text-slate-500 py-2 px-4">ROI</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((event) => (
                    <tr key={event.id} className="border-b border-slate-50 last:border-0 hover:bg-slate-50/50">
                      <td className="py-2.5 px-4 font-medium text-slate-800">{event.name}</td>
                      <td className="py-2.5 px-3 text-xs text-slate-500">{event.type.replace(/_/g, " ")}</td>
                      <td className="py-2.5 px-3 text-slate-600 text-xs">{event.location}</td>
                      <td className="py-2.5 px-3 text-right font-semibold text-[#0EA5E9]">{event.leadsGenerated}</td>
                      <td className="py-2.5 px-3 text-right text-slate-600">
                        {event.cost > 0 ? `$${event.cost.toLocaleString()}` : "—"}
                      </td>
                      <td className="py-2.5 px-4 text-right text-slate-600">
                        {event.roi !== null ? `${event.roi} leads/$` : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Section 6: Engagement Notes (manual) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800">
            Section 6: Engagement & BD Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label className="text-sm text-slate-600">
              Describe key engagement activities, business development efforts, partner meetings, and other relevant activities this month.
            </Label>
            <Textarea
              value={engagementNotes}
              onChange={(e) => setEngagementNotes(e.target.value)}
              onBlur={(e) => saveField("engagementNotes", e.target.value)}
              placeholder="e.g. Attended partner workshop with ABC Agency, conducted campus presentation at XYZ School, met with 3 new agent prospects..."
              rows={5}
              className="resize-none"
            />
          </div>
        </CardContent>
      </Card>

      {/* Section 7: Forecast */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800">
            Section 7: Forecast Summary
          </CardTitle>
        </CardHeader>
        <CardContent>
          <ForecastSection
            reportId={report.id}
            institutionId={report.institutionId}
            readOnly={false}
          />
        </CardContent>
      </Card>

      {/* Section 8: Challenges & Opportunities (manual) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800">
            Section 8: Challenges & Opportunities
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label className="text-sm text-slate-600">
              Describe key challenges faced this month and opportunities identified for growth.
            </Label>
            <Textarea
              value={challengesOpportunities}
              onChange={(e) => setChallengesOpportunities(e.target.value)}
              onBlur={(e) => saveField("challengesOpportunities", e.target.value)}
              placeholder="Challenges: e.g. Visa delays causing drop-offs... Opportunities: e.g. Growing demand for nursing programs..."
              rows={5}
              className="resize-none"
            />
          </div>
        </CardContent>
      </Card>

      {/* Section 9: Next Month Plan (manual) */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-800">
            Section 9: Next Month Plan
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            <Label className="text-sm text-slate-600">
              Outline your planned activities for {MONTH_NAMES[report.reportingMonth === 12 ? 1 : report.reportingMonth + 1]}.
            </Label>
            <Textarea
              value={nextMonthPlan}
              onChange={(e) => setNextMonthPlan(e.target.value)}
              onBlur={(e) => saveField("nextMonthPlan", e.target.value)}
              placeholder="e.g. Attend education fair in Lagos (15-16 Jun), follow up with 12 pending applications, conduct school visits..."
              rows={5}
              className="resize-none"
            />
          </div>
        </CardContent>
      </Card>

      {/* KPI Summary */}
      {kpi && (
        <Card className="border-[#1E3A5F]/20 bg-[#1E3A5F]/5">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold text-[#1E3A5F]">KPI Summary (Auto-Calculated)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
              {[
                { label: "Total Leads", value: kpi.totalLeads },
                { label: "Enrolled", value: kpi.enrolled },
                { label: "Conversion Rate", value: `${kpi.conversionRate}%` },
                { label: "Contact Rate", value: `${kpi.contactRate}%` },
                { label: "Events", value: kpi.eventsCount },
                { label: "Event Cost", value: kpi.totalEventCost > 0 ? `$${kpi.totalEventCost.toLocaleString()}` : "—" },
              ].map((item) => (
                <div key={item.label} className="text-center">
                  <p className="text-xl font-bold text-[#1E3A5F]">{item.value}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{item.label}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Submit button at bottom */}
      <div className="flex justify-end pb-6">
        <Button
          onClick={handleSubmit}
          disabled={submitting}
          className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white"
          size="lg"
        >
          {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
          Submit for Review
        </Button>
      </div>
    </div>
  );
}
