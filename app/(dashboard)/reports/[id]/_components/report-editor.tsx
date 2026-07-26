"use client";

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Send, Loader2, AlertTriangle, Check, Sparkles, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

type ReportStatus = "DRAFT" | "PENDING_REVIEW" | "REGIONAL_APPROVED" | "HQ_REVIEW" | "FINAL_APPROVED" | "RETURNED";

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
  kpiSummary: KpiSummary | null;
  engagementNotes: string | null;
  challengesOpportunities: string | null;
  successStories: string | null;
  marketInsights: string | null;
  nextMonthPlan: string | null;
  icr: { id: string; name: string | null };
  institution: { id: string; name: string };
  returnComment?: string | null;
}

const MONTH_NAMES = ["", "January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export function ReportEditor({ report }: { report: ReportData }) {
  const router = useRouter();

  const [comment, setComment] = useState(report.engagementNotes ?? "");
  const [challengesOpportunities, setChallengesOpportunities] = useState(report.challengesOpportunities ?? "");
  const [successStories, setSuccessStories] = useState(report.successStories ?? "");
  const [marketInsights, setMarketInsights] = useState(report.marketInsights ?? "");
  const [nextMonthPlan, setNextMonthPlan] = useState(report.nextMonthPlan ?? "");
  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const period = `${MONTH_NAMES[report.reportingMonth]} ${report.reportingYear}`;
  const kpi = report.kpiSummary;

  const saveField = useCallback(
    async (field: string, value: string) => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/reports/${report.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ [field]: value }),
        });
        if (!res.ok) throw new Error("Save failed");
        setSavedOnce(true);
      } catch {
        setError("Couldn't save — check your connection.");
      } finally {
        setSaving(false);
      }
    },
    [report.id]
  );

  async function handleSend() {
    setSubmitting(true);
    setError(null);
    try {
      // Persist all sections before sending
      const res1 = await fetch(`/api/reports/${report.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagementNotes: comment,
          challengesOpportunities,
          successStories,
          marketInsights,
          nextMonthPlan,
        }),
      });
      if (!res1.ok) throw new Error("Save failed");

      const res = await fetch(`/api/reports/${report.id}/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "SUBMIT" }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        setError(err.error ?? "Failed to send report");
        return;
      }
      router.push(`/reports/${report.id}`);
      router.refresh();
    } finally {
      setSubmitting(false);
    }
  }

  const stats = kpi
    ? [
        { label: "Leads", value: kpi.totalLeads },
        { label: "Enrolled", value: kpi.enrolled },
        { label: "Conversion", value: `${kpi.conversionRate}%` },
        { label: "Events", value: kpi.eventsCount },
      ]
    : [];

  return (
    <div className="space-y-6 max-w-2xl">
      {/* Returned-for-revision banner */}
      {report.status === "RETURNED" && report.returnComment && (
        <div className="flex items-start gap-3 p-4 rounded-xl bg-red-50 border border-red-200">
          <RotateCcw className="h-5 w-5 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-800">Returned for revision</p>
            <p className="text-sm text-red-700 mt-0.5">{report.returnComment}</p>
          </div>
        </div>
      )}

      {/* Auto-generated summary */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[#0EA5E9]" />
            {period} — auto-generated from your CRM data
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stats.length > 0 ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {stats.map((s) => (
                <div key={s.label} className="text-center rounded-lg bg-slate-50 py-4">
                  <p className="text-2xl font-bold text-[#1E3A5F]">{s.value}</p>
                  <p className="text-xs text-slate-500 mt-0.5">{s.label}</p>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-400">No CRM data for this period yet.</p>
          )}
          <p className="text-xs text-slate-400 mt-3">
            Leads, programs, sources and events are pulled in automatically — nothing to fill in. You can review the full
            breakdown after sending.
          </p>
        </CardContent>
      </Card>

      {/* Report Sections */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base font-semibold text-slate-900">
            Report Sections{" "}
            <span className="text-sm font-normal text-slate-400">(optional)</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* 1. Engagement Notes */}
          <div className="space-y-1.5">
            <Label htmlFor="engagementNotes" className="text-sm font-medium text-slate-700">
              Engagement Notes
            </Label>
            <Textarea
              id="engagementNotes"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onBlur={(e) => saveField("engagementNotes", e.target.value)}
              placeholder="A quick note for your manager — highlights, challenges, or plans for next month."
              rows={3}
              className="resize-none"
            />
          </div>

          {/* 2. Challenges & Opportunities */}
          <div className="space-y-1.5">
            <Label htmlFor="challengesOpportunities" className="text-sm font-medium text-slate-700">
              Challenges &amp; Opportunities
            </Label>
            <Textarea
              id="challengesOpportunities"
              value={challengesOpportunities}
              onChange={(e) => setChallengesOpportunities(e.target.value)}
              onBlur={(e) => saveField("challengesOpportunities", e.target.value)}
              placeholder="Key challenges faced this month and opportunities identified."
              rows={3}
              className="resize-none"
            />
          </div>

          {/* 3. Success Stories */}
          <div className="space-y-1.5">
            <Label htmlFor="successStories" className="text-sm font-medium text-slate-700">
              Success Stories
            </Label>
            <Textarea
              id="successStories"
              value={successStories}
              onChange={(e) => setSuccessStories(e.target.value)}
              onBlur={(e) => saveField("successStories", e.target.value)}
              placeholder="Notable wins, student success stories, or partnership milestones."
              rows={3}
              className="resize-none"
            />
          </div>

          {/* 4. Market Insights */}
          <div className="space-y-1.5">
            <Label htmlFor="marketInsights" className="text-sm font-medium text-slate-700">
              Market Insights
            </Label>
            <Textarea
              id="marketInsights"
              value={marketInsights}
              onChange={(e) => setMarketInsights(e.target.value)}
              onBlur={(e) => saveField("marketInsights", e.target.value)}
              placeholder="Trends, competitor activity, or market conditions worth noting."
              rows={3}
              className="resize-none"
            />
          </div>

          {/* 5. Next Month Plan */}
          <div className="space-y-1.5">
            <Label htmlFor="nextMonthPlan" className="text-sm font-medium text-slate-700">
              Next Month Plan
            </Label>
            <Textarea
              id="nextMonthPlan"
              value={nextMonthPlan}
              onChange={(e) => setNextMonthPlan(e.target.value)}
              onBlur={(e) => saveField("nextMonthPlan", e.target.value)}
              placeholder="Key priorities, goals, and planned activities for next month."
              rows={3}
              className="resize-none"
            />
          </div>

          <div className="h-4 text-xs text-slate-400 flex items-center gap-1">
            {saving ? (
              <>
                <Loader2 className="h-3 w-3 animate-spin" /> Saving…
              </>
            ) : savedOnce ? (
              <>
                <Check className="h-3 w-3 text-emerald-500" /> Saved
              </>
            ) : null}
          </div>
        </CardContent>
      </Card>

      {error && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Send */}
      <div className="flex items-center justify-between gap-4 pb-6">
        <p className="text-xs text-slate-400">
          Sending finalises this report and makes it available to your team.
        </p>
        <Button
          onClick={handleSend}
          disabled={submitting}
          size="lg"
          className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white shrink-0"
        >
          {submitting ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
          Send report
        </Button>
      </div>
    </div>
  );
}
