"use client";

import * as React from "react";
import {
  UserMinus,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Mail,
  Trash2,
  Info,
  AlertTriangle,
  ShieldOff,
  ArrowRightLeft,
  Users,
  ShieldAlert,
} from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  OFFBOARDING_REASONS,
  STATUS_LABELS,
  reasonLabel,
  daysUntil,
} from "@/lib/offboarding-requests";

interface Candidate {
  id: string;
  employeeId: string;
  name: string;
  email: string;
  jobTitle: string;
  department: string | null;
}

interface OffboardingRequest {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  reason: string;
  lastWorkingDay: string;
  forwardingEmail: string | null;
  notes: string;
  reviewNotes: string | null;
  reviewedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  employee: {
    id: string;
    employeeId: string;
    jobTitle: string;
    department: { id: string; name: string } | null;
    user: {
      id: string;
      name: string | null;
      firstName: string | null;
      lastName: string | null;
      email: string;
      role: string;
      isActive: boolean;
      region: { id: string; name: string } | null;
    };
  };
  requestedBy: { id: string; name: string | null; email: string } | null;
  reviewedBy: { id: string; name: string | null } | null;
}

/** Mirrors WorkloadSummary in lib/workload-reassignment.ts. */
interface WorkloadSummary {
  total: number;
  isClear: boolean;
  taskCountUnavailable: boolean;
  buckets: { key: string; label: string; scopeNote: string; count: number }[];
}

interface ReassignTarget {
  id: string;
  name: string;
  email: string;
  role: string;
  region: string | null;
  currentLiveLeads: number;
}

/** "34 students, 7 open tasks" — only the buckets that actually have something. */
function describeWorkload(w: WorkloadSummary): string {
  const parts = w.buckets.filter((b) => b.count > 0).map((b) => `${b.count} ${b.label}`);
  if (parts.length === 0) return "nothing outstanding";
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

const STATUS_VARIANT: Record<string, "warning" | "success" | "destructive"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "destructive",
};

const EMPTY = {
  employeeId: "",
  reason: "RESIGNATION",
  lastWorkingDay: "",
  forwardingEmail: "",
  notes: "",
};

export function OffboardingRequests() {
  const { toast } = useToast();
  const [requests, setRequests] = React.useState<OffboardingRequest[] | null>(null);
  const [canReview, setCanReview] = React.useState(false);
  const [canRequest, setCanRequest] = React.useState(false);
  const [steps, setSteps] = React.useState<string[]>([]);

  // null = not fetched yet, [] = fetched and genuinely nobody. Distinguished
  // because collapsing the two made the form claim "Nobody available" for the
  // moment before the request landed — alarming, and untrue.
  const [candidates, setCandidates] = React.useState<Candidate[] | null>(null);
  const [candidateNotice, setCandidateNotice] = React.useState<string | null>(null);

  const [formOpen, setFormOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({ ...EMPTY });

  const [rejecting, setRejecting] = React.useState<OffboardingRequest | null>(null);
  const [rejectReason, setRejectReason] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);

  // ── Reassignment ─────────────────────────────────────────────────────────
  // Keyed by request id, and only populated for approved-but-not-revoked rows —
  // the API computes it for exactly that set, because it is the only state where
  // the number changes what the operator is allowed to do.
  const [workloads, setWorkloads] = React.useState<Record<string, WorkloadSummary>>({});
  const [canReassign, setCanReassign] = React.useState(false);

  const [reassigning, setReassigning] = React.useState<OffboardingRequest | null>(null);
  // null vs [] carries the same distinction as `candidates` above.
  const [targets, setTargets] = React.useState<ReassignTarget[] | null>(null);
  const [targetNotice, setTargetNotice] = React.useState<string | null>(null);
  const [reassignTo, setReassignTo] = React.useState("");

  const [overriding, setOverriding] = React.useState<OffboardingRequest | null>(null);
  const [overrideReason, setOverrideReason] = React.useState("");

  const set = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const load = React.useCallback(async () => {
    const res = await fetch("/api/hr/offboarding-requests");
    if (!res.ok) return;
    const data = await res.json();
    setRequests(data.requests ?? []);
    setWorkloads(data.workloads ?? {});
    setCanReview(!!data.canReview);
    setCanRequest(!!data.canRequest);
    setCanReassign(!!data.canReassign);
    setSteps(data.revocationSteps ?? []);
  }, []);

  /** Reloaded each time the dialog opens so a colleague who left in the meantime
   *  is not still offered as a recipient. */
  const loadTargets = React.useCallback(
    async (excludeUserId: string) => {
      setTargets(null);
      setTargetNotice(null);
      const res = await fetch(
        `/api/hr/reassignment/targets?excludeUserId=${encodeURIComponent(excludeUserId)}`
      );
      if (!res.ok) {
        toast({ title: "Could not load colleagues", variant: "destructive" });
        return;
      }
      const data = await res.json();
      setTargets(data.targets ?? []);
      setTargetNotice(data.reason ?? null);
    },
    [toast]
  );

  async function doReassign() {
    if (!reassigning || !reassignTo) return;
    setBusy(reassigning.id);
    try {
      const res = await fetch("/api/hr/reassignment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromUserId: reassigning.employee.user.id,
          toUserId: reassignTo,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: data.error ?? "Could not reassign", variant: "destructive" });
        return;
      }
      toast({
        title: `${data.total} record${data.total === 1 ? "" : "s"} moved to ${data.to?.name ?? "them"}`,
        description: data.skipped?.length
          ? data.skipped.map((s: { reason: string }) => s.reason).join(" ")
          : "Their access can now be revoked.",
      });
      setReassigning(null);
      setReassignTo("");
      await load();
    } finally {
      setBusy(null);
    }
  }

  // Candidates are reloaded whenever the form opens, not once on mount: someone
  // queued in another tab should not still be offerable here.
  const loadCandidates = React.useCallback(async () => {
    setCandidates(null);
    setCandidateNotice(null);
    const res = await fetch("/api/hr/offboarding-requests/candidates");
    if (!res.ok) {
      // Leave it at null rather than [] — an empty array here would read as
      // "nobody is leavable" when the truth is the request failed.
      toast({ title: "Could not load the employee list", variant: "destructive" });
      return;
    }
    const data = await res.json();
    setCandidates(data.candidates ?? []);
    setCandidateNotice(data.reason ?? null);
  }, [toast]);

  React.useEffect(() => {
    load();
  }, [load]);

  const valid =
    !!form.employeeId &&
    !!form.lastWorkingDay &&
    form.notes.trim().length >= 10 &&
    (form.forwardingEmail.trim() === "" || /\S+@\S+\.\S+/.test(form.forwardingEmail));

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch("/api/hr/offboarding-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: form.employeeId,
          reason: form.reason,
          notes: form.notes,
          forwardingEmail: form.forwardingEmail.trim() || null,
          lastWorkingDay: new Date(`${form.lastWorkingDay}T00:00:00.000Z`).toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: data.error ?? "Could not submit request", variant: "destructive" });
        return;
      }
      toast({
        title: "Departure raised",
        description: "IT has been notified and will revoke access.",
      });
      setFormOpen(false);
      setForm({ ...EMPTY });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function decide(
    r: OffboardingRequest,
    action: "APPROVE" | "REJECT" | "MARK_COMPLETE",
    notes?: string,
    override?: { reason: string }
  ) {
    setBusy(r.id);
    try {
      const res = await fetch(`/api/hr/offboarding-requests/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          ...(notes ? { reviewNotes: notes } : {}),
          ...(override ? { override: true, overrideReason: override.reason } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // The server refuses to revoke access while live work is still owned.
        // Refresh from its numbers rather than the stale ones on screen — the
        // block is authoritative there, and the counts may have moved.
        if (data.blocked === "UNREASSIGNED_WORKLOAD" && data.workload) {
          setWorkloads((w) => ({ ...w, [r.id]: data.workload }));
          toast({
            title: "Reassign their workload first",
            description: `They still own ${describeWorkload(data.workload)}.`,
            variant: "destructive",
          });
          return;
        }
        toast({ title: data.error ?? "Could not update request", variant: "destructive" });
        return;
      }
      setOverriding(null);
      setOverrideReason("");
      toast({
        title:
          action === "APPROVE"
            ? "Approved — their access is still live until you revoke it"
            : action === "REJECT"
              ? "Departure declined"
              : override
                ? "Access revoked with unassigned work left behind"
                : "Marked as complete",
        description: override
          ? "The override and its reason are on the audit trail. Reassign the records when you can."
          : undefined,
        variant: override ? "destructive" : undefined,
      });
      setRejecting(null);
      setRejectReason("");
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function withdraw(r: OffboardingRequest) {
    setBusy(r.id);
    try {
      const res = await fetch(`/api/hr/offboarding-requests/${r.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast({ title: d.error ?? "Could not withdraw", variant: "destructive" });
        return;
      }
      toast({ title: "Departure withdrawn" });
      await load();
    } finally {
      setBusy(null);
    }
  }

  const pending = (requests ?? []).filter((r) => r.status === "PENDING");
  const decided = (requests ?? []).filter((r) => r.status !== "PENDING");

  /**
   * Approved, last day gone, access never revoked — the one state in this queue
   * that is actively a security problem, so it is called out rather than left as
   * a date the reviewer has to compare in their head.
   */
  const overdue = (requests ?? []).filter(
    (r) => r.status === "APPROVED" && !r.completedAt && daysUntil(r.lastWorkingDay) < 0
  );

  const Row = ({ r }: { r: OffboardingRequest }) => {
    const days = daysUntil(r.lastWorkingDay);
    const stillLive = r.status === "APPROVED" && !r.completedAt;
    const isOverdue = stillLive && days < 0;
    const name = r.employee.user.name?.trim() || r.employee.user.email;

    // Only present for approved-and-not-revoked rows; undefined everywhere else.
    const workload = workloads[r.id];
    const blocked = stillLive && !!workload && !workload.isClear;

    return (
      <div
        className={
          "rounded-lg border p-3.5 space-y-2.5 " +
          (isOverdue
            ? "border-red-300 bg-red-50/50 dark:border-red-500/40 dark:bg-red-500/5"
            : "border-slate-200 dark:border-slate-800")
        }
      >
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{name}</p>
              <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABELS[r.status]}</Badge>
              <Badge variant="outline">{reasonLabel(r.reason)}</Badge>
              {stillLive && <Badge variant="secondary">Access not revoked yet</Badge>}
              {r.completedAt && <Badge variant="success">Access revoked</Badge>}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {r.employee.employeeId} · {r.employee.jobTitle}
              {r.employee.department ? ` · ${r.employee.department.name}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {canReview && r.status === "PENDING" && (
              <>
                <Button
                  size="sm"
                  className="h-8 bg-green-600 hover:bg-green-700 text-white gap-1.5"
                  disabled={busy === r.id}
                  onClick={() => decide(r, "APPROVE")}
                >
                  {busy === r.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-red-600 border-red-200 hover:bg-red-50 dark:text-red-300 dark:border-red-500/30 dark:hover:bg-red-500/10 gap-1.5"
                  disabled={busy === r.id}
                  onClick={() => { setRejecting(r); setRejectReason(""); }}
                >
                  <XCircle className="h-3.5 w-3.5" />
                  Decline
                </Button>
              </>
            )}
            {canReassign && blocked && (
              <Button
                size="sm"
                className="h-8 bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white gap-1.5"
                disabled={busy === r.id}
                onClick={() => {
                  setReassigning(r);
                  setReassignTo("");
                  loadTargets(r.employee.user.id);
                }}
              >
                <ArrowRightLeft className="h-3.5 w-3.5" />
                Reassign workload
              </Button>
            )}
            {canReview && stillLive && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 gap-1.5"
                // Hard block: the button stays visible but inert while they
                // still own live work, so the reason is discoverable rather
                // than the action just silently failing on click.
                disabled={busy === r.id || blocked}
                title={
                  blocked
                    ? `Blocked — ${name} still owns ${describeWorkload(workload)}.`
                    : undefined
                }
                onClick={() => decide(r, "MARK_COMPLETE")}
              >
                <ShieldOff className="h-3.5 w-3.5" />
                Mark access revoked
              </Button>
            )}
            {canReview && blocked && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 gap-1.5"
                disabled={busy === r.id}
                onClick={() => { setOverriding(r); setOverrideReason(""); }}
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                Override
              </Button>
            )}
            {!canReview && r.status === "PENDING" && (
              <Button
                size="sm"
                variant="ghost"
                className="h-8 text-slate-400 dark:text-slate-500 hover:text-red-600 dark:hover:text-red-400"
                disabled={busy === r.id}
                onClick={() => withdraw(r)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1.5 text-xs">
          <Field
            label="Last working day"
            value={
              formatDate(r.lastWorkingDay) +
              (r.status === "PENDING" && days >= 0
                ? days === 0
                  ? " (today)"
                  : ` (in ${days}d)`
                : "")
            }
          />
          <Field label="Work email" value={r.employee.user.email} />
          <Field label="Forwarding email" value={r.forwardingEmail ?? "—"} />
          <Field label="Region" value={r.employee.user.region?.name ?? "—"} />
        </div>

        {isOverdue && (
          <div className="flex gap-2 rounded-md bg-red-50 border border-red-200 dark:bg-red-500/10 dark:border-red-500/30 p-2.5">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
            <p className="text-xs text-red-800 dark:text-red-300">
              Their last day was {Math.abs(days)} day{Math.abs(days) === 1 ? "" : "s"} ago and their
              access has not been marked revoked.
              {r.employee.user.isActive
                ? " Their portal login is still active."
                : " Their portal login is already inactive — mark this revoked to close it off."}
            </p>
          </div>
        )}

        {blocked && (
          <div className="flex gap-2 rounded-md bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30 p-2.5">
            <Users className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-xs text-amber-900 dark:text-amber-200">
                <strong>Still owns {describeWorkload(workload)}.</strong> Access cannot be
                marked revoked until this is handed over, so nothing is left pointing at a
                dead account.
              </p>
              <p className="text-[11px] text-amber-700 dark:text-amber-300/80 mt-1">
                Enrolled students, closed journeys and finished tasks stay with them —
                only live work moves.
                {workload.taskCountUnavailable && " They have no employee record, so they hold no tasks."}
              </p>
            </div>
          </div>
        )}

        {stillLive && workload?.isClear && (
          <p className="text-xs text-emerald-700 dark:text-emerald-400 flex items-center gap-1.5">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            No live work outstanding — safe to revoke access.
          </p>
        )}

        <div>
          <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide">Context</p>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 whitespace-pre-wrap">{r.notes}</p>
        </div>

        {r.reviewNotes && (
          <div className="rounded-md bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 p-2.5">
            <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide">
              Reviewer notes
            </p>
            <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 whitespace-pre-wrap">{r.reviewNotes}</p>
          </div>
        )}

        <p className="text-[11px] text-slate-400 dark:text-slate-500">
          Raised by {r.requestedBy?.name ?? "Unknown"} on {formatDate(r.createdAt)}
          {r.reviewedBy && r.reviewedAt
            ? ` · reviewed by ${r.reviewedBy.name ?? "Unknown"} on ${formatDate(r.reviewedAt)}`
            : ""}
          {r.completedAt ? ` · access revoked ${formatDate(r.completedAt)}` : ""}
        </p>
      </div>
    );
  };

  const selected = (candidates ?? []).find((c) => c.id === form.employeeId) ?? null;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {canReview
              ? "Departures raised by managers. Approving does not revoke anything — disable the login yourself, then mark it revoked."
              : "Tell IT that someone is leaving so their access can be closed."}
          </p>
          {pending.length > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-300 font-medium mt-1 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              {pending.length} awaiting review
            </p>
          )}
        </div>
        {canRequest && (
          <Button
            className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 gap-1.5"
            onClick={() => { setFormOpen(true); loadCandidates(); }}
          >
            <UserMinus className="h-4 w-4" />
            Raise a departure
          </Button>
        )}
      </div>

      {/* The security-relevant state, surfaced above the list rather than left for
          the reviewer to spot by reading dates. */}
      {overdue.length > 0 && (
        <div className="flex gap-2 rounded-lg bg-red-50 border border-red-200 dark:bg-red-500/10 dark:border-red-500/30 p-3">
          <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
          <p className="text-xs text-red-800 dark:text-red-300">
            <strong>
              {overdue.length} approved departure{overdue.length === 1 ? "" : "s"} past the last
              working day
            </strong>{" "}
            with access not marked revoked. Check each login is disabled.
          </p>
        </div>
      )}

      {requests === null ? (
        <p className="text-sm text-slate-400 dark:text-slate-500 py-8 text-center">Loading…</p>
      ) : requests.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
          <UserMinus className="h-7 w-7 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm text-slate-500 dark:text-slate-400">No departures recorded.</p>
          {canRequest && (
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              Use “Raise a departure” when someone resigns or their contract ends.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {pending.length > 0 && (
            <div className="space-y-2.5">
              {pending.map((r) => <Row key={r.id} r={r} />)}
            </div>
          )}
          {decided.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">
                Decided
              </p>
              <div className="space-y-2.5">
                {decided.map((r) => <Row key={r.id} r={r} />)}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Reminder of what approval does NOT do. Only shown to the reviewer,
          because they are the one who has to do it. */}
      {canReview && steps.length > 0 && (
        <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3">
          <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 mb-1.5">
            After approving, IT still does this by hand
          </p>
          <ul className="text-xs text-slate-500 dark:text-slate-400 space-y-1 list-disc pl-4">
            {steps.map((s) => <li key={s}>{s}</li>)}
          </ul>
        </div>
      )}

      {/* ── Departure form ───────────────────────────────────────────── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Raise a departure</DialogTitle>
          </DialogHeader>

          <div className="flex gap-2 rounded-lg bg-sky-50 border border-sky-200 dark:bg-sky-500/10 dark:border-sky-500/30 p-2.5">
            <Info className="h-4 w-4 text-sky-600 dark:text-sky-300 shrink-0 mt-0.5" />
            <p className="text-xs text-sky-800 dark:text-sky-300">
              This notifies IT — it does not close any access. Their login keeps working
              until IT disables it. If this is urgent, tell IT directly as well.
            </p>
          </div>

          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Who is leaving? *</Label>
              {candidateNotice ? (
                <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                  {candidateNotice}
                </p>
              ) : (
                <Select
                  value={form.employeeId}
                  onValueChange={(v) => set("employeeId", v)}
                  disabled={candidates === null || candidates.length === 0}
                >
                  <SelectTrigger>
                    <SelectValue
                      placeholder={candidates === null ? "Loading employees…" : "Select an employee"}
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {(candidates ?? []).map((c) => (
                      <SelectItem key={c.id} value={c.id}>
                        {c.name} · {c.jobTitle}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {selected && (
                <p className="text-xs text-muted-foreground">
                  {selected.employeeId} · {selected.email}
                  {selected.department ? ` · ${selected.department}` : ""}
                </p>
              )}
              {/* Only once the list has actually arrived — see the state comment. */}
              {!candidateNotice && candidates !== null && candidates.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Nobody available — anyone already queued for departure is excluded.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Reason *</Label>
                <Select value={form.reason} onValueChange={(v) => set("reason", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {OFFBOARDING_REASONS.map((r) => (
                      <SelectItem key={r} value={r}>{reasonLabel(r)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Last working day *</Label>
                <Input
                  type="date"
                  value={form.lastWorkingDay}
                  onChange={(e) => set("lastWorkingDay", e.target.value)}
                />
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  A past date is allowed — someone may already have gone.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Forwarding email</Label>
              <Input
                type="email"
                value={form.forwardingEmail}
                onChange={(e) => set("forwardingEmail", e.target.value)}
                placeholder="jane.smith@gmail.com"
              />
              <p className="text-xs text-muted-foreground">
                Personal address for final payslips and references — their Illume mailbox
                is about to stop working.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label>Circumstances *</Label>
              <Textarea
                rows={3}
                value={form.notes}
                onChange={(e) => set("notes", e.target.value)}
                placeholder="e.g. Resigned on the 3rd, serving four weeks' notice. Handing the Vietnam agent accounts to Ahmed."
              />
              <p className="text-xs text-slate-400 dark:text-slate-500">
                At least 10 characters — this is what IT reads when deciding how quickly
                to cut access.
              </p>
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)}>Cancel</Button>
            <Button
              disabled={!valid || saving}
              onClick={submit}
              className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white gap-1.5"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
              Send to IT
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Decline, with a mandatory reason ─────────────────────────── */}
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Decline this departure</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {rejecting?.requestedBy?.name ?? "The requester"} will be told, so give them
              something they can act on. Nothing about the employee&apos;s access changes.
            </p>
            <div className="space-y-1.5">
              <Label>Reason *</Label>
              <Textarea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. They have withdrawn their resignation — no longer leaving."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRejecting(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={rejectReason.trim().length < 5 || busy === rejecting?.id}
              onClick={() => rejecting && decide(rejecting, "REJECT", rejectReason.trim())}
            >
              {busy === rejecting?.id && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Decline departure
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Reassign workload ────────────────────────────────────────── */}
      <Dialog open={!!reassigning} onOpenChange={(o) => !o && setReassigning(null)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Reassign workload</DialogTitle>
          </DialogHeader>

          {reassigning && (
            <div className="space-y-4 py-1">
              <p className="text-sm text-slate-600 dark:text-slate-300">
                Move everything{" "}
                <strong>
                  {reassigning.employee.user.name?.trim() || reassigning.employee.user.email}
                </strong>{" "}
                is still working on to a colleague. This does not change their access.
              </p>

              {/* Itemised rather than a single total: an operator handing over 34
                  students and 7 tasks should see both before confirming. */}
              {workloads[reassigning.id] && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 divide-y divide-slate-200 dark:divide-slate-800">
                  {workloads[reassigning.id].buckets
                    .filter((b) => b.count > 0)
                    .map((b) => (
                      <div key={b.key} className="flex items-baseline justify-between gap-3 p-2.5">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-700 dark:text-slate-200 capitalize">
                            {b.label}
                          </p>
                          <p className="text-[11px] text-slate-400 dark:text-slate-500">{b.scopeNote}</p>
                        </div>
                        <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 shrink-0">
                          {b.count}
                        </span>
                      </div>
                    ))}
                </div>
              )}

              <div className="space-y-1.5">
                <Label>Hand over to *</Label>
                {targetNotice ? (
                  <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                    {targetNotice}
                  </p>
                ) : (
                  <Select
                    value={reassignTo}
                    onValueChange={setReassignTo}
                    disabled={targets === null || targets.length === 0}
                  >
                    <SelectTrigger>
                      <SelectValue
                        placeholder={targets === null ? "Loading colleagues…" : "Select a colleague"}
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {(targets ?? []).map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} · {t.role.replace(/_/g, " ").toLowerCase()} ·{" "}
                          {t.currentLiveLeads} live
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {!targetNotice && targets !== null && targets.length === 0 && (
                  <p className="text-xs text-muted-foreground">
                    Nobody available — only active ICRs and regional managers can hold a
                    caseload.
                  </p>
                )}
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  The number beside each name is how many live students they already carry.
                </p>
              </div>

              <div className="flex gap-2 rounded-lg bg-sky-50 border border-sky-200 dark:bg-sky-500/10 dark:border-sky-500/30 p-2.5">
                <Info className="h-4 w-4 text-sky-600 dark:text-sky-300 shrink-0 mt-0.5" />
                <p className="text-xs text-sky-800 dark:text-sky-300">
                  Enrolled students, closed journeys, finished tasks and completed events stay
                  with {reassigning.employee.user.firstName?.trim() || "them"} — moving those
                  would transfer credit for work they did.
                </p>
              </div>
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setReassigning(null)}>Cancel</Button>
            <Button
              disabled={!reassignTo || busy === reassigning?.id}
              onClick={doReassign}
              className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white gap-1.5"
            >
              {busy === reassigning?.id ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <ArrowRightLeft className="h-4 w-4" />
              )}
              Reassign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Override the block, with a mandatory reason ───────────────── */}
      <Dialog open={!!overriding} onOpenChange={(o) => !o && setOverriding(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Revoke access anyway</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div className="flex gap-2 rounded-lg bg-red-50 border border-red-200 dark:bg-red-500/10 dark:border-red-500/30 p-2.5">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-red-800 dark:text-red-300">
                {overriding && workloads[overriding.id] && (
                  <>
                    <strong>{describeWorkload(workloads[overriding.id])}</strong> will be left
                    owned by an account nobody can sign into.{" "}
                  </>
                )}
                Students will not appear on anyone&apos;s list until you reassign them.
              </p>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300">
              Use this when access has to be cut now — a dismissal, or a security concern.
              Your reason is recorded on the audit trail with your name and IP.
            </p>
            <div className="space-y-1.5">
              <Label>Why can this not wait? *</Label>
              <Textarea
                rows={3}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="e.g. Dismissed for cause this morning; access must be cut today. Caseload will be reassigned by Friday."
              />
              <p className="text-xs text-slate-400 dark:text-slate-500">At least 10 characters.</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOverriding(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={overrideReason.trim().length < 10 || busy === overriding?.id}
              onClick={() =>
                overriding &&
                decide(overriding, "MARK_COMPLETE", undefined, {
                  reason: overrideReason.trim(),
                })
              }
            >
              {busy === overriding?.id && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Revoke and leave work unassigned
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide">{label}</p>
      <p className="text-xs text-slate-700 dark:text-slate-300 truncate">{value}</p>
    </div>
  );
}
