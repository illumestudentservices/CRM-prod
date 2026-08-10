"use client";

import * as React from "react";
import {
  UserPlus,
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  Mail,
  Trash2,
  Info,
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
  REQUESTABLE_ROLES,
  EMPLOYMENT_TYPE_LABELS,
  STATUS_LABELS,
  roleLabel,
} from "@/lib/account-requests";

interface AccountRequest {
  id: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  fullName: string;
  email: string;
  jobTitle: string;
  requestedRole: string;
  employmentType: string;
  startDate: string;
  gender: string | null;
  phone: string | null;
  justification: string;
  reviewNotes: string | null;
  reviewedAt: string | null;
  fulfilledAt: string | null;
  createdAt: string;
  requestedBy: { id: string; name: string | null; email: string } | null;
  reviewedBy: { id: string; name: string | null } | null;
  region: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
}

const STATUS_VARIANT: Record<string, "warning" | "success" | "destructive"> = {
  PENDING: "warning",
  APPROVED: "success",
  REJECTED: "destructive",
};

const EMPTY = {
  fullName: "",
  email: "",
  jobTitle: "",
  requestedRole: "EMPLOYEE",
  employmentType: "FULL_TIME",
  startDate: "",
  gender: "none",
  phone: "",
  regionId: "none",
  departmentId: "none",
  justification: "",
};

export function AccountRequests() {
  const { toast } = useToast();
  const [requests, setRequests] = React.useState<AccountRequest[] | null>(null);
  const [canReview, setCanReview] = React.useState(false);
  const [canRequest, setCanRequest] = React.useState(false);
  const [regions, setRegions] = React.useState<{ id: string; name: string }[]>([]);
  const [departments, setDepartments] = React.useState<{ id: string; name: string }[]>([]);

  const [formOpen, setFormOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({ ...EMPTY });

  const [rejecting, setRejecting] = React.useState<AccountRequest | null>(null);
  const [rejectReason, setRejectReason] = React.useState("");
  const [busy, setBusy] = React.useState<string | null>(null);

  const set = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const load = React.useCallback(async () => {
    const res = await fetch("/api/hr/account-requests");
    if (!res.ok) return;
    const data = await res.json();
    setRequests(data.requests ?? []);
    setCanReview(!!data.canReview);
    setCanRequest(!!data.canRequest);
  }, []);

  React.useEffect(() => {
    load();
    fetch("/api/hr/regions")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setRegions(d?.regions ?? []))
      .catch(() => {});
    fetch("/api/hr/departments")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setDepartments(d?.departments ?? []))
      .catch(() => {});
  }, [load]);

  const valid =
    form.fullName.trim().length >= 2 &&
    /\S+@\S+\.\S+/.test(form.email) &&
    form.jobTitle.trim().length >= 2 &&
    !!form.startDate &&
    form.justification.trim().length >= 10;

  async function submit() {
    setSaving(true);
    try {
      const res = await fetch("/api/hr/account-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          gender: form.gender === "none" ? null : form.gender,
          regionId: form.regionId === "none" ? null : form.regionId,
          departmentId: form.departmentId === "none" ? null : form.departmentId,
          phone: form.phone.trim() || null,
          startDate: new Date(`${form.startDate}T00:00:00.000Z`).toISOString(),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: data.error ?? "Could not submit request", variant: "destructive" });
        return;
      }
      toast({
        title: "Request submitted",
        description: "IT has been notified and will set the account up.",
      });
      setFormOpen(false);
      setForm({ ...EMPTY });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function decide(r: AccountRequest, action: "APPROVE" | "REJECT" | "MARK_FULFILLED", notes?: string) {
    setBusy(r.id);
    try {
      const res = await fetch(`/api/hr/account-requests/${r.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(notes ? { reviewNotes: notes } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: data.error ?? "Could not update request", variant: "destructive" });
        return;
      }
      toast({
        title:
          action === "APPROVE"
            ? "Approved — create the account in the Employees tab"
            : action === "REJECT"
              ? "Request declined"
              : "Marked as created",
      });
      setRejecting(null);
      setRejectReason("");
      await load();
    } finally {
      setBusy(null);
    }
  }

  async function withdraw(r: AccountRequest) {
    setBusy(r.id);
    try {
      const res = await fetch(`/api/hr/account-requests/${r.id}`, { method: "DELETE" });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast({ title: d.error ?? "Could not withdraw", variant: "destructive" });
        return;
      }
      toast({ title: "Request withdrawn" });
      await load();
    } finally {
      setBusy(null);
    }
  }

  const pending = (requests ?? []).filter((r) => r.status === "PENDING");
  const decided = (requests ?? []).filter((r) => r.status !== "PENDING");

  const Row = ({ r }: { r: AccountRequest }) => (
    <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 space-y-2.5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{r.fullName}</p>
            <Badge variant={STATUS_VARIANT[r.status]}>{STATUS_LABELS[r.status]}</Badge>
            {r.status === "APPROVED" && !r.fulfilledAt && (
              <Badge variant="secondary">Account not created yet</Badge>
            )}
            {r.fulfilledAt && <Badge variant="success">Account created</Badge>}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {r.jobTitle} · {roleLabel(r.requestedRole)} ·{" "}
            {EMPLOYMENT_TYPE_LABELS[r.employmentType] ?? r.employmentType}
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
          {canReview && r.status === "APPROVED" && !r.fulfilledAt && (
            <Button
              size="sm"
              variant="outline"
              className="h-8"
              disabled={busy === r.id}
              onClick={() => decide(r, "MARK_FULFILLED")}
            >
              Mark as created
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
        <Field label="Work email" value={r.email} />
        <Field label="Start date" value={formatDate(r.startDate)} />
        <Field label="Region" value={r.region?.name ?? "—"} />
        <Field label="Department" value={r.department?.name ?? "—"} />
        {r.phone && <Field label="Phone" value={r.phone} />}
        {r.gender && <Field label="Gender" value={r.gender.toLowerCase()} />}
      </div>

      <div>
        <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide">Justification</p>
        <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 whitespace-pre-wrap">{r.justification}</p>
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
      </p>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            {canReview
              ? "Account requests raised by managers. Approving does not create the account — set it up in the Employees tab."
              : "Ask IT to create a portal account for a new joiner."}
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
            onClick={() => setFormOpen(true)}
          >
            <UserPlus className="h-4 w-4" />
            Request an account
          </Button>
        )}
      </div>

      {requests === null ? (
        <p className="text-sm text-slate-400 dark:text-slate-500 py-8 text-center">Loading…</p>
      ) : requests.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
          <UserPlus className="h-7 w-7 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm text-slate-500 dark:text-slate-400">No account requests yet.</p>
          {canRequest && (
            <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
              Use “Request an account” when you are onboarding someone new.
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

      {/* ── Request form ─────────────────────────────────────────────── */}
      <Dialog open={formOpen} onOpenChange={setFormOpen}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Request a new account</DialogTitle>
          </DialogHeader>

          <div className="flex gap-2 rounded-lg bg-sky-50 border border-sky-200 dark:bg-sky-500/10 dark:border-sky-500/30 p-2.5">
            <Info className="h-4 w-4 text-sky-600 dark:text-sky-300 shrink-0 mt-0.5" />
            <p className="text-xs text-sky-800 dark:text-sky-300">
              This notifies IT — it does not create the account. They will review the
              details and set it up, and the new joiner gets their own onboarding email.
            </p>
          </div>

          <div className="space-y-4 py-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Full name *</Label>
                <Input
                  value={form.fullName}
                  onChange={(e) => set("fullName", e.target.value)}
                  placeholder="Jane Smith"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Work email *</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => set("email", e.target.value)}
                  placeholder="jane@illumestudentservices.ca"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Job title *</Label>
              <Input
                value={form.jobTitle}
                onChange={(e) => set("jobTitle", e.target.value)}
                placeholder="e.g. Student Recruitment Officer"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Role *</Label>
                <Select value={form.requestedRole} onValueChange={(v) => set("requestedRole", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {REQUESTABLE_ROLES.map((r) => (
                      <SelectItem key={r} value={r}>{roleLabel(r)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Super Admin cannot be requested — ask IT directly.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Employment type</Label>
                <Select value={form.employmentType} onValueChange={(v) => set("employmentType", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {Object.entries(EMPLOYMENT_TYPE_LABELS).map(([k, v]) => (
                      <SelectItem key={k} value={k}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Start date *</Label>
                <Input
                  type="date"
                  value={form.startDate}
                  onChange={(e) => set("startDate", e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Gender</Label>
                <Select value={form.gender} onValueChange={(v) => set("gender", v)}>
                  <SelectTrigger><SelectValue placeholder="Not specified" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not specified</SelectItem>
                    <SelectItem value="FEMALE">Female</SelectItem>
                    <SelectItem value="MALE">Male</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
                {/* Says why it is asked, rather than collecting it unexplained. */}
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Sets maternity / paternity leave eligibility.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Region</Label>
                <Select value={form.regionId} onValueChange={(v) => set("regionId", v)}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {regions.map((r) => (
                      <SelectItem key={r.id} value={r.id}>{r.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Department</Label>
                <Select value={form.departmentId} onValueChange={(v) => set("departmentId", v)}>
                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>Phone</Label>
              <Input
                value={form.phone}
                onChange={(e) => set("phone", e.target.value)}
                placeholder="+1 902 555 0100"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Why is this account needed? *</Label>
              <Textarea
                rows={3}
                value={form.justification}
                onChange={(e) => set("justification", e.target.value)}
                placeholder="e.g. Replacing Sarah in the Africa team; starts on the 1st and needs pipeline access from day one."
              />
              <p className="text-xs text-slate-400 dark:text-slate-500">
                At least 10 characters — this is what IT reads when deciding.
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
              Send request
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Decline, with a mandatory reason ─────────────────────────── */}
      <Dialog open={!!rejecting} onOpenChange={(o) => !o && setRejecting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Decline this request</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <p className="text-sm text-slate-600 dark:text-slate-300">
              {rejecting?.requestedBy?.name ?? "The requester"} will be told, so give them
              something they can act on.
            </p>
            <div className="space-y-1.5">
              <Label>Reason *</Label>
              <Textarea
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="e.g. Headcount not approved for this quarter — resubmit after the budget review."
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
              Decline request
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
