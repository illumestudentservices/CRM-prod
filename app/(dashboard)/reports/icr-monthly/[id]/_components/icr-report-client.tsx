"use client";

/**
 * The ICR Monthly Report, laid out section for section as the Word template
 * the reps fill in by hand — 1.1 through 7, same numbers, same order, so a rep
 * moving off the document knows where they are.
 *
 * The difference is which cells are theirs. Anything the CRM knows is rendered
 * as a figure, not a field: a rep should never retype a number the system
 * already holds, and a number they could retype is a number that can disagree
 * with the CRM. Everything the CRM cannot know — judgement, narrative, asks,
 * and the targets — is an input, saved on blur.
 */

import { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2, Check, Send, RefreshCw, ArrowLeft, AlertTriangle,
  ThumbsUp, Undo2, Camera,
} from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AttachmentsPanel } from "@/components/attachments/attachments-panel";
// Locale-stable: toLocaleDateString() formats differently on the server and in
// the browser, which React reports as a hydration mismatch and then re-renders
// past. These format identically in both places.
//
// TIMEZONE is a second, separate source of the same mismatch and is NOT solved
// by the above. date-fns `format()` renders in the runtime's own zone, and the
// server is not in the reader's: production runs Etc/UTC while a reader in
// Asia/Calcutta is +5:30, so the same instant is written "09:21" on the server
// and "14:51" in the browser. React reported that as #418 on production and it
// did not reproduce in development, where the dev server and the browser happen
// to share a zone.
//
// The timestamps below are therefore marked suppressHydrationWarning: the
// reader should keep seeing their own local time, and React should stop
// treating the correct client value as a defect. This is the one case the
// attribute exists for.
import { formatCurrency, formatDate, formatDateTime } from "@/lib/utils";
import type {
  AgentEngagement, AgentRow, AtRiskAgentRow, EventRow,
  InstitutionRow, MonthlyKpiRow, PerformanceRow, PipelineSnapshot,
  PriorityApplicationRow,
} from "@/lib/icr-monthly-report";

const MONTHS = ["", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"];

const ROI_OPTIONS = ["Strong", "Moderate", "Weak", "Too early to tell"];

interface ReportShape {
  id: string;
  reportingMonth: number;
  reportingYear: number;
  status: string;
  intakesCovered: string | null;
  icr: { id: string; name: string | null; email: string };
  region: { id: string; name: string } | null;
  submittedAt: string | null;
  finalApprovedAt: string | null;
  generatedAt: string;
  refreshedAt: string | null;
  keyHighlights: string | null;
  keyChallenges: string | null;
  channelDevelopment: string | null;
  businessDevelopment: string | null;
  demandTrends: string | null;
  competitiveActivity: string | null;
  marketConditions: string | null;
  priorityOne: string | null;
  priorityTwo: string | null;
  priorityThree: string | null;
  supportRequested: string | null;
}

interface Sections {
  performance: PerformanceRow[];
  pipelineSnapshot: PipelineSnapshot;
  institutionBreakdown: InstitutionRow[];
  priorityApplications: PriorityApplicationRow[];
  agentEngagement: AgentEngagement;
  topAgents: AgentRow[];
  atRiskAgents: AtRiskAgentRow[];
  eventActivities: EventRow[];
  monthlyKpi: MonthlyKpiRow[];
}

interface Approval {
  id: string;
  action: string;
  comment: string | null;
  createdAt: string;
  user: string;
}

// ── Small presentational pieces ────────────────────────────────────────────

function SectionHeading({ number, title }: { number: string; title: string }) {
  return (
    <div className="flex items-baseline gap-2.5 pt-2">
      <span className="text-sm font-bold text-[#1E3A5F] dark:text-sky-400 tabular-nums">{number}</span>
      <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">{title}</h3>
    </div>
  );
}

function TableShell({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[#1E3A5F] text-white">
            {head.map((h, i) => (
              <th
                key={h}
                className={`px-3 py-2 font-medium text-xs ${i === 0 ? "text-left" : "text-left"}`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function TrendBadge({ trend }: { trend: string | null }) {
  if (!trend) return <span className="text-slate-400">—</span>;
  const styles: Record<string, string> = {
    UP: "text-emerald-600 dark:text-emerald-400",
    DOWN: "text-red-600 dark:text-red-400",
    FLAT: "text-slate-500 dark:text-slate-400",
    NEW: "text-sky-600 dark:text-sky-400",
  };
  const labels: Record<string, string> = {
    UP: "▲ Up", DOWN: "▼ Down", FLAT: "▬ Flat", NEW: "★ First month",
  };
  return <span className={`text-xs font-medium ${styles[trend] ?? ""}`}>{labels[trend] ?? trend}</span>;
}

/** A narrative section: the template's "Insert Notes Below" blocks. */
function NoteField({
  id, label, hints, value, onChange, onBlur, editable,
}: {
  id: string;
  label: string;
  hints?: string[];
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
  editable: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className="text-sm font-medium text-slate-700 dark:text-slate-300">
        {label}
      </Label>
      {hints?.length ? (
        <p className="text-xs text-slate-400 dark:text-slate-500">{hints.join(" · ")}</p>
      ) : null}
      {editable ? (
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          rows={3}
          className="resize-none"
        />
      ) : (
        <p className="text-sm text-slate-700 dark:text-slate-300 whitespace-pre-wrap rounded-md bg-slate-50 dark:bg-slate-900/40 px-3 py-2 min-h-[42px]">
          {value || <span className="text-slate-400 dark:text-slate-500">Not completed</span>}
        </p>
      )}
    </div>
  );
}

// ── Main ───────────────────────────────────────────────────────────────────

export function IcrReportClient({
  report, sections, approvals, returnComment, editable, canDecide, isOwner,
}: {
  report: ReportShape;
  sections: Sections;
  approvals: Approval[];
  returnComment: string | null;
  editable: boolean;
  canDecide: boolean;
  isOwner: boolean;
}) {
  const router = useRouter();
  const period = `${MONTHS[report.reportingMonth]} ${report.reportingYear}`;

  const [text, setText] = useState({
    intakesCovered: report.intakesCovered ?? "",
    keyHighlights: report.keyHighlights ?? "",
    keyChallenges: report.keyChallenges ?? "",
    channelDevelopment: report.channelDevelopment ?? "",
    businessDevelopment: report.businessDevelopment ?? "",
    demandTrends: report.demandTrends ?? "",
    competitiveActivity: report.competitiveActivity ?? "",
    marketConditions: report.marketConditions ?? "",
    priorityOne: report.priorityOne ?? "",
    priorityTwo: report.priorityTwo ?? "",
    priorityThree: report.priorityThree ?? "",
    supportRequested: report.supportRequested ?? "",
  });

  const [targets, setTargets] = useState<Record<string, string>>(
    Object.fromEntries(sections.performance.map((r) => [r.key, r.target == null ? "" : String(r.target)]))
  );
  const [actions, setActions] = useState<Record<string, string>>(
    Object.fromEntries(sections.priorityApplications.map((r) => [r.leadId, r.requiredAction]))
  );
  const [agentNotes, setAgentNotes] = useState<Record<string, string>>(
    Object.fromEntries(sections.topAgents.map((r) => [r.partnerId, r.note]))
  );
  const [plans, setPlans] = useState<Record<string, string>>(
    Object.fromEntries(sections.atRiskAgents.map((r) => [r.partnerId, r.actionPlan]))
  );
  const [assessments, setAssessments] = useState<Record<string, { roiOutlook: string; quality: string }>>(
    Object.fromEntries(sections.eventActivities.map((r) => [r.eventId, { roiOutlook: r.roiOutlook, quality: r.quality }]))
  );

  const [saving, setSaving] = useState(false);
  const [savedOnce, setSavedOnce] = useState(false);
  const [busy, setBusy] = useState<null | "refresh" | "submit" | "approve" | "return">(null);
  const [error, setError] = useState<string | null>(null);
  const [returnNote, setReturnNote] = useState("");
  const [showReturn, setShowReturn] = useState(false);

  const save = useCallback(
    async (payload: Record<string, unknown>) => {
      setSaving(true);
      setError(null);
      try {
        const res = await fetch(`/api/icr-reports/${report.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j.error ?? "Save failed");
        }
        setSavedOnce(true);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Couldn't save — check your connection.");
      } finally {
        setSaving(false);
      }
    },
    [report.id]
  );

  async function act(action: "SUBMIT" | "APPROVE" | "RETURN", comment?: string) {
    setBusy(action.toLowerCase() as "submit" | "approve" | "return");
    setError(null);
    try {
      // Flush every narrative field first — a rep who types and immediately
      // clicks Send would otherwise submit the version before their last edit.
      if (action === "SUBMIT") await save(text);

      const res = await fetch(`/api/icr-reports/${report.id}/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(comment ? { comment } : {}) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(j.error ?? "That didn't work");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  async function refresh() {
    setBusy("refresh");
    setError(null);
    try {
      const res = await fetch(`/api/icr-reports/${report.id}/refresh`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setError(j.error ?? "Couldn't refresh the CRM figures");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const setT = (k: keyof typeof text) => (v: string) => setText((p) => ({ ...p, [k]: v }));
  const blurT = (k: keyof typeof text) => () => save({ [k]: text[k] });

  const statusLabel: Record<string, string> = {
    DRAFT: "Draft",
    PENDING_REVIEW: "Awaiting your manager's approval",
    FINAL_APPROVED: "Approved",
    RETURNED: "Returned for revision",
  };

  return (
    <div className="space-y-6 max-w-6xl">
      {/* ── Title bar ───────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <Button asChild variant="ghost" size="sm" className="-ml-2 mb-1 text-slate-500 dark:text-slate-400">
            <Link href="/reports/icr-monthly">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              ICR Monthly Reports
            </Link>
          </Button>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">
            In-Country Representative Monthly Report
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5">
            {report.icr.name ?? report.icr.email} · {period}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {editable && (
            <Button variant="outline" onClick={refresh} disabled={busy !== null}>
              {busy === "refresh" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Refresh CRM figures
            </Button>
          )}
          {editable && isOwner && (
            <Button
              onClick={() => act("SUBMIT")}
              disabled={busy !== null}
              className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white"
            >
              {busy === "submit" ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Send className="h-4 w-4 mr-2" />
              )}
              Send to manager
            </Button>
          )}
        </div>
      </div>

      {/* ── Status / review banner ──────────────────────────────────────── */}
      <div className="flex items-center gap-3 flex-wrap text-sm">
        <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-3 py-1 font-medium text-slate-700 dark:text-slate-300">
          {statusLabel[report.status] ?? report.status}
        </span>
        <span className="text-slate-400 dark:text-slate-500 text-xs" suppressHydrationWarning>
          CRM figures as at{" "}
          {formatDateTime(report.refreshedAt ?? report.generatedAt)}
        </span>
      </div>

      {returnComment && (
        <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 p-4">
          <p className="text-sm font-semibold text-red-800 dark:text-red-300 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" /> Returned for revision
          </p>
          <p className="text-sm text-red-700 dark:text-red-400 mt-1 whitespace-pre-wrap">{returnComment}</p>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 dark:border-red-900/50 bg-red-50 dark:bg-red-950/30 px-4 py-2.5">
          <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
        </div>
      )}

      {/* ── Manager's decision ──────────────────────────────────────────── */}
      {canDecide && report.status === "PENDING_REVIEW" && (
        <Card className="border-[#1E3A5F]/30">
          <CardContent className="pt-5 space-y-3">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              This report is waiting for your decision.
            </p>
            <div className="flex items-center gap-2">
              <Button
                onClick={() => act("APPROVE")}
                disabled={busy !== null}
                className="bg-emerald-600 hover:bg-emerald-700 text-white"
              >
                {busy === "approve" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <ThumbsUp className="h-4 w-4 mr-2" />}
                Approve
              </Button>
              <Button variant="outline" onClick={() => setShowReturn((s) => !s)} disabled={busy !== null}>
                <Undo2 className="h-4 w-4 mr-2" />
                Return for revision
              </Button>
            </div>
            {showReturn && (
              <div className="space-y-2">
                <Label htmlFor="returnNote">What needs to change?</Label>
                <Textarea
                  id="returnNote"
                  value={returnNote}
                  onChange={(e) => setReturnNote(e.target.value)}
                  rows={3}
                  placeholder="Required — the rep sees this and works from it."
                />
                <Button
                  variant="destructive"
                  disabled={!returnNote.trim() || busy !== null}
                  onClick={() => act("RETURN", returnNote.trim())}
                >
                  {busy === "return" ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
                  Send back
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Header block ────────────────────────────────────────────────── */}
      <Card>
        <CardContent className="pt-6">
          <dl className="grid gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Institutions covered</dt>
              <dd className="mt-0.5 text-slate-800 dark:text-slate-200">
                {sections.institutionBreakdown.length
                  ? sections.institutionBreakdown.map((i) => i.name).join(", ")
                  : "No institution activity this month"}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Region / Market</dt>
              <dd className="mt-0.5 text-slate-800 dark:text-slate-200">{report.region?.name ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">ICR</dt>
              <dd className="mt-0.5 text-slate-800 dark:text-slate-200">{report.icr.name ?? report.icr.email}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Reporting period</dt>
              <dd className="mt-0.5 text-slate-800 dark:text-slate-200">{period}</dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Intake(s) covered</dt>
              <dd className="mt-0.5">
                {editable ? (
                  <Input
                    value={text.intakesCovered}
                    onChange={(e) => setT("intakesCovered")(e.target.value)}
                    onBlur={blurT("intakesCovered")}
                    placeholder="e.g. Sep 2026 / Jan 2027"
                    className="h-8"
                  />
                ) : (
                  <span className="text-slate-800 dark:text-slate-200">{text.intakesCovered || "—"}</span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-400 dark:text-slate-500">Report submission date</dt>
              <dd className="mt-0.5 text-slate-800 dark:text-slate-200" suppressHydrationWarning>
                {report.submittedAt ? formatDate(report.submittedAt) : "Not yet submitted"}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      {/* ── 1. Executive Summary ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
            1. Executive Summary
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <SectionHeading number="1.1" title="Performance Overview" />
            <TableShell head={["Metric", "Target", "This month", "Previous month", "Trend"]}>
              {sections.performance.map((row) => (
                <tr key={row.key} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">
                    {row.label}
                    {row.notTrackedNote && (
                      <span className="block text-[11px] font-normal text-slate-400 dark:text-slate-500">
                        {row.notTrackedNote}
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {editable ? (
                      <Input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={targets[row.key] ?? ""}
                        onChange={(e) => setTargets((p) => ({ ...p, [row.key]: e.target.value }))}
                        onBlur={() => {
                          const raw = targets[row.key];
                          save({ performanceTargets: { [row.key]: raw === "" ? null : Number(raw) } });
                        }}
                        className="h-8 w-24"
                        placeholder="—"
                      />
                    ) : (
                      <span className="text-slate-700 dark:text-slate-300">{row.target ?? "—"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                    {row.thisMonth ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-slate-600 dark:text-slate-400 tabular-nums">
                    {row.previousMonth ?? "—"}
                  </td>
                  <td className="px-3 py-2"><TrendBadge trend={row.trend} /></td>
                </tr>
              ))}
            </TableShell>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              Counted from the stage history — how many crossed each line during {period}, not how many
              sit at that stage today. Targets are yours to set; the CRM holds only annual,
              institution-level enrolment targets.
            </p>
          </div>

          <div className="space-y-2">
            <SectionHeading number="1.2" title="Application Pipeline Snapshot" />
            <TableShell head={["Stage", "Volume"]}>
              {[
                ["Active leads", sections.pipelineSnapshot.activeLeads],
                ["Applications in progress", sections.pipelineSnapshot.applicationsInProgress],
                ["Offers pending deposit", sections.pipelineSnapshot.offersPending],
                ["Deposits pending enrolment", sections.pipelineSnapshot.depositsPending],
              ].map(([label, value]) => (
                <tr key={String(label)} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <td className="px-3 py-2 text-slate-800 dark:text-slate-200">{label}</td>
                  <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{value}</td>
                </tr>
              ))}
            </TableShell>
          </div>

          {sections.institutionBreakdown.length > 0 && (
            <div className="space-y-2">
              <SectionHeading number="1.2a" title="Breakdown by institution" />
              <TableShell head={["Institution", "Leads", "Applications", "Offers", "Deposits", "Enrolments"]}>
                {sections.institutionBreakdown.map((i) => (
                  <tr key={i.institutionId} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                    <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">{i.name}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700 dark:text-slate-300">{i.leads}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700 dark:text-slate-300">{i.applications}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700 dark:text-slate-300">{i.offers}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700 dark:text-slate-300">{i.deposits}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700 dark:text-slate-300">{i.enrolments}</td>
                  </tr>
                ))}
              </TableShell>
            </div>
          )}

          <div className="space-y-2">
            <SectionHeading number="1.3" title="Priority Applications Requiring Admissions Support" />
            {sections.priorityApplications.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">
                Nothing has stalled — no application has sat in one stage for more than three weeks.
              </p>
            ) : (
              <TableShell head={["Student", "Program", "Stage", "Issue", "Required action"]}>
                {sections.priorityApplications.map((p) => (
                  <tr key={p.leadId} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                    <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">{p.student}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{p.program}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300">{p.stage}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400 text-xs">{p.issue}</td>
                    <td className="px-3 py-2">
                      {editable ? (
                        <Input
                          value={actions[p.leadId] ?? ""}
                          onChange={(e) => setActions((s) => ({ ...s, [p.leadId]: e.target.value }))}
                          onBlur={() =>
                            save({ priorityActions: { [p.leadId]: { requiredAction: actions[p.leadId] ?? "" } } })
                          }
                          placeholder="What you need from Admissions"
                          className="h-8 min-w-[200px]"
                        />
                      ) : (
                        <span className="text-slate-700 dark:text-slate-300">{p.requiredAction || "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </TableShell>
            )}
          </div>

          <NoteField
            id="keyHighlights"
            label="1.4  Key Highlights"
            hints={["Major performance achievements", "Notable agent engagement", "Successful event or campaign", "Deposit acceleration", "Market opportunity identified"]}
            value={text.keyHighlights}
            onChange={setT("keyHighlights")}
            onBlur={blurT("keyHighlights")}
            editable={editable}
          />
          <NoteField
            id="keyChallenges"
            label="1.5  Key Challenges / Risks"
            hints={["Visa delays", "PAL constraints", "Price sensitivity", "Offer turnaround delays", "Competitor promotions"]}
            value={text.keyChallenges}
            onChange={setT("keyChallenges")}
            onBlur={blurT("keyChallenges")}
            editable={editable}
          />
        </CardContent>
      </Card>

      {/* ── 2. Pipeline & Agent Activity ────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
            2. Pipeline &amp; Agent Activity
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <SectionHeading number="2.1" title="Agent Engagement This Month" />
            <TableShell head={["Engagement type", "Volume"]}>
              {[
                ["Agent meetings conducted", sections.agentEngagement.agentMeetings],
                ["New agents identified", sections.agentEngagement.newAgentsIdentified],
                ["Trainings delivered", sections.agentEngagement.trainingsDelivered],
                ["Account planning discussions", sections.agentEngagement.accountPlanning],
              ].map(([label, value]) => (
                <tr key={String(label)} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                  <td className="px-3 py-2 text-slate-800 dark:text-slate-200">{label}</td>
                  <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100 tabular-nums">{value}</td>
                </tr>
              ))}
            </TableShell>
            <p className="text-xs text-slate-400 dark:text-slate-500">
              From your Field Operations activities for {period}.
            </p>
          </div>

          <div className="space-y-2">
            <SectionHeading number="2.2" title="Top Agent Activity" />
            {sections.topAgents.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">
                No agent-sourced leads this month.
              </p>
            ) : (
              <TableShell head={["Agent", "Leads", "Applications", "Deposits", "Notes"]}>
                {sections.topAgents.map((a) => (
                  <tr key={a.partnerId} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                    <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">{a.name}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700 dark:text-slate-300">{a.leads}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700 dark:text-slate-300">{a.applications}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700 dark:text-slate-300">{a.deposits}</td>
                    <td className="px-3 py-2">
                      {editable ? (
                        <Input
                          value={agentNotes[a.partnerId] ?? ""}
                          onChange={(e) => setAgentNotes((s) => ({ ...s, [a.partnerId]: e.target.value }))}
                          onBlur={() => save({ agentNotes: { [a.partnerId]: agentNotes[a.partnerId] ?? "" } })}
                          className="h-8 min-w-[200px]"
                        />
                      ) : (
                        <span className="text-slate-700 dark:text-slate-300">{a.note || "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </TableShell>
            )}
          </div>

          <div className="space-y-2">
            <SectionHeading number="2.3" title="Underperforming / At-Risk Agents" />
            {sections.atRiskAgents.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">
                No agent flagged: everyone who sent leads before sent some this month, and every
                agent who sent leads produced at least one application.
              </p>
            ) : (
              <TableShell head={["Agent", "Issue identified", "Action plan"]}>
                {sections.atRiskAgents.map((a) => (
                  <tr key={a.partnerId} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                    <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">{a.name}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400 text-xs">{a.issue}</td>
                    <td className="px-3 py-2">
                      {editable ? (
                        <Input
                          value={plans[a.partnerId] ?? ""}
                          onChange={(e) => setPlans((s) => ({ ...s, [a.partnerId]: e.target.value }))}
                          onBlur={() => save({ atRiskPlans: { [a.partnerId]: plans[a.partnerId] ?? "" } })}
                          placeholder="What you will do about it"
                          className="h-8 min-w-[220px]"
                        />
                      ) : (
                        <span className="text-slate-700 dark:text-slate-300">{a.actionPlan || "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </TableShell>
            )}
          </div>

          <NoteField
            id="channelDevelopment"
            label="2.4  New Channel Development Notes"
            hints={["New agents onboarded", "Schools engaged", "Corporate or government scholarship discussions", "Alumni ambassador engagement"]}
            value={text.channelDevelopment}
            onChange={setT("channelDevelopment")}
            onBlur={blurT("channelDevelopment")}
            editable={editable}
          />
        </CardContent>
      </Card>

      {/* ── 3. Events & Business Development ────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
            3. Events &amp; Business Development
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <SectionHeading number="3.1" title="Events Conducted" />
            {sections.eventActivities.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">No events recorded for {period}.</p>
            ) : (
              <TableShell head={["Event", "Date", "Cost", "Leads", "Cost / lead", "ROI outlook", "Quality assessment"]}>
                {sections.eventActivities.map((e) => (
                  <tr key={e.eventId} className="border-b border-slate-100 dark:border-slate-800 last:border-0">
                    <td className="px-3 py-2 font-medium text-slate-800 dark:text-slate-200">{e.name}</td>
                    <td className="px-3 py-2 text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      <span suppressHydrationWarning>{formatDate(e.date)}</span>
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-700 dark:text-slate-300">
                      {e.cost > 0 ? formatCurrency(e.cost) : "—"}
                    </td>
                    <td className="px-3 py-2 tabular-nums text-slate-700 dark:text-slate-300">{e.leadsGenerated}</td>
                    <td className="px-3 py-2 tabular-nums text-slate-700 dark:text-slate-300">
                      {formatCurrency(e.costPerLead)}
                    </td>
                    <td className="px-3 py-2">
                      {editable ? (
                        <select
                          value={assessments[e.eventId]?.roiOutlook ?? ""}
                          onChange={(ev) => {
                            const v = ev.target.value;
                            setAssessments((s) => ({ ...s, [e.eventId]: { ...s[e.eventId], roiOutlook: v } }));
                            save({ eventAssessments: { [e.eventId]: { roiOutlook: v } } });
                          }}
                          className="h-8 rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-2 text-sm text-slate-800 dark:text-slate-200"
                        >
                          <option value="">Choose…</option>
                          {ROI_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                        </select>
                      ) : (
                        <span className="text-slate-700 dark:text-slate-300">{e.roiOutlook || "—"}</span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      {editable ? (
                        <Input
                          value={assessments[e.eventId]?.quality ?? ""}
                          onChange={(ev) =>
                            setAssessments((s) => ({ ...s, [e.eventId]: { ...s[e.eventId], quality: ev.target.value } }))
                          }
                          onBlur={() =>
                            save({ eventAssessments: { [e.eventId]: { quality: assessments[e.eventId]?.quality ?? "" } } })
                          }
                          className="h-8 min-w-[180px]"
                        />
                      ) : (
                        <span className="text-slate-700 dark:text-slate-300">{e.quality || "—"}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </TableShell>
            )}
          </div>

          <NoteField
            id="businessDevelopment"
            label="3.2  Business Development Activity Notes"
            hints={["School visits conducted", "Corporate or sponsorship discussions", "Alumni engagement", "Education fairs attended"]}
            value={text.businessDevelopment}
            onChange={setT("businessDevelopment")}
            onBlur={blurT("businessDevelopment")}
            editable={editable}
          />
        </CardContent>
      </Card>

      {/* ── 4. Market Update ────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
            4. Market Update
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <NoteField
            id="demandTrends"
            label="4.1  Student Demand Trends"
            hints={["Most requested programs", "Level of study preference", "Intake interest", "Program preference shifts", "Agent confidence", "Barriers to conversion"]}
            value={text.demandTrends}
            onChange={setT("demandTrends")}
            onBlur={blurT("demandTrends")}
            editable={editable}
          />
          <NoteField
            id="competitiveActivity"
            label="4.2  Competitive Activity"
            hints={["Competitor discounts or scholarships", "Major events in market", "Aggressive marketing campaigns", "Deposit flexibility by competitors"]}
            value={text.competitiveActivity}
            onChange={setT("competitiveActivity")}
            onBlur={blurT("competitiveActivity")}
            editable={editable}
          />
          <NoteField
            id="marketConditions"
            label="4.3  General Market Conditions"
            hints={["Visa environment", "Currency movement", "Government announcements affecting students"]}
            value={text.marketConditions}
            onChange={setT("marketConditions")}
            onBlur={blurT("marketConditions")}
            editable={editable}
          />
        </CardContent>
      </Card>

      {/* ── 5. Priorities ───────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
            5. Top 3 Priorities for Next Month
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {([
            ["priorityOne", "Priority 1"],
            ["priorityTwo", "Priority 2"],
            ["priorityThree", "Priority 3"],
          ] as const).map(([key, label]) => (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={key} className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {label}
              </Label>
              {editable ? (
                <Input
                  id={key}
                  value={text[key]}
                  onChange={(e) => setT(key)(e.target.value)}
                  onBlur={blurT(key)}
                />
              ) : (
                <p className="text-sm text-slate-700 dark:text-slate-300 rounded-md bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
                  {text[key] || <span className="text-slate-400 dark:text-slate-500">Not completed</span>}
                </p>
              )}
            </div>
          ))}
        </CardContent>
      </Card>

      {/* ── 6. Support Requested ────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
            6. Support Requested from Institution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <NoteField
            id="supportRequested"
            label="What you need"
            hints={["Faster offer turnaround", "Scholarship clarity", "Faculty participation in webinars", "Updated brochures", "Deposit deadline extension"]}
            value={text.supportRequested}
            onChange={setT("supportRequested")}
            onBlur={blurT("supportRequested")}
            editable={editable}
          />
        </CardContent>
      </Card>

      {/* ── 7. Snapshots ────────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Camera className="h-4 w-4 text-[#1E3A5F] dark:text-sky-400" />
            7. Snapshots
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-slate-400 dark:text-slate-500">
            Photos from events, school visits or partner meetings during {period}.
          </p>
          <AttachmentsPanel
            parentType="ICR_MONTHLY_REPORT"
            parentId={report.id}
            readOnly={!editable}
          />
        </CardContent>
      </Card>

      {/* ── 8. Monthly KPI ──────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-bold text-slate-900 dark:text-slate-100">
            8. Monthly KPI
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-slate-400 dark:text-slate-500">
            The six mandatory activities, totalled from Weeks 1–4 of {period} in
            Reports → Weekly Activities. Fill the planner in there; this table
            only reports it.
          </p>

          {sections.monthlyKpi.length === 0 ? (
            <p className="text-sm text-slate-500 dark:text-slate-400 rounded-md bg-slate-50 dark:bg-slate-900/40 px-3 py-2">
              No KPI snapshot on this report yet. Use Refresh to pull in the month&apos;s planner.
            </p>
          ) : (
            <TableShell head={["Activity", "Target", "Done", "%", "Detail"]}>
              {sections.monthlyKpi.map((row) => (
                <tr key={row.type} className="border-t border-slate-100 dark:border-slate-800 align-top">
                  <td className="px-3 py-2 text-slate-800 dark:text-slate-200">
                    {row.label}
                    {row.cadence === "MONTHLY" && (
                      <span className="ml-1.5 text-xs text-slate-400 dark:text-slate-500">/ month</span>
                    )}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-slate-600 dark:text-slate-400">{row.target}</td>
                  <td className="px-3 py-2 tabular-nums text-slate-800 dark:text-slate-200">
                    {row.entered ? row.completed : "—"}
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {/*
                      An unfilled planner is not nought per cent. A rep who did
                      the work and skipped the spreadsheet would otherwise be
                      reported as having achieved none of it, and a manager would
                      be approving that as fact.
                    */}
                    {row.pct == null ? (
                      <span className="text-slate-400 dark:text-slate-500">Not entered</span>
                    ) : (
                      <span
                        className={
                          row.pct >= 100
                            ? "font-semibold text-emerald-600 dark:text-emerald-400"
                            : row.pct >= 70
                            ? "font-semibold text-amber-600 dark:text-amber-400"
                            : "font-semibold text-red-600 dark:text-red-400"
                        }
                      >
                        {row.pct}%
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                    {row.detail.length ? row.detail.join(" · ") : "—"}
                  </td>
                </tr>
              ))}
            </TableShell>
          )}
        </CardContent>
      </Card>

      {/* ── Trail ───────────────────────────────────────────────────────── */}
      {approvals.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              History
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {approvals.map((a) => (
              <div key={a.id} className="text-sm flex gap-3">
                <span className="text-slate-400 dark:text-slate-500 whitespace-nowrap" suppressHydrationWarning>
                  {formatDateTime(a.createdAt)}
                </span>
                <span className="text-slate-700 dark:text-slate-300">
                  <span className="font-medium">{a.user}</span> — {a.action.toLowerCase()}
                  {a.comment ? `: ${a.comment}` : ""}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* ── Save indicator ──────────────────────────────────────────────── */}
      {editable && (
        <div className="h-5 text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
          {saving ? (
            <><Loader2 className="h-3 w-3 animate-spin" /> Saving…</>
          ) : savedOnce ? (
            <><Check className="h-3 w-3 text-emerald-500" /> Saved</>
          ) : (
            "Changes save as you go."
          )}
        </div>
      )}
    </div>
  );
}
