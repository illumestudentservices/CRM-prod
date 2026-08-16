"use client";

import * as React from "react";
import { Loader2, Plus, AlertOctagon, CheckCircle2 } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/**
 * Client issues.
 *
 * The ClientIssue model, its categories, severities and full status workflow
 * were implemented and tested, and had no user interface — so no issue could
 * ever be raised. This is that interface.
 *
 * The category and severity lists mirror the API's zod enums exactly. They are
 * duplicated here rather than imported because the route file is server-only;
 * if they drift, the form offers something the API rejects, which is the same
 * class of bug that made eleven of fourteen field activity types unsaveable.
 * Any change to one must be made to the other.
 */

const CATEGORIES = [
  { value: "CLIENT_RELATIONSHIP", label: "Client relationship" },
  { value: "SERVICE_DELIVERY", label: "Service delivery" },
  { value: "RECRUITMENT_PERFORMANCE", label: "Recruitment performance" },
  { value: "STAFFING", label: "Staffing" },
  { value: "CONTRACT", label: "Contract" },
  { value: "FINANCE", label: "Finance" },
  { value: "COMPLIANCE", label: "Compliance" },
  { value: "TECHNOLOGY", label: "Technology" },
  { value: "STUDENT_CASE", label: "Student case" },
  { value: "OTHER", label: "Other" },
] as const;

const SEVERITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;

const STATUSES = [
  { value: "OPEN", label: "Open" },
  { value: "IN_PROGRESS", label: "In progress" },
  { value: "AWAITING_CLIENT", label: "Awaiting client" },
  { value: "AWAITING_INTERNAL_ACTION", label: "Awaiting internal action" },
  { value: "RESOLVED", label: "Resolved" },
  { value: "CLOSED", label: "Closed" },
] as const;

const SEVERITY_VARIANT: Record<string, "secondary" | "warning" | "destructive"> = {
  LOW: "secondary", MEDIUM: "secondary", HIGH: "warning", CRITICAL: "destructive",
};

/** Statuses that mean the issue still needs somebody to do something. */
const OPEN_STATUSES = ["OPEN", "IN_PROGRESS", "AWAITING_CLIENT", "AWAITING_INTERNAL_ACTION"];

interface Issue {
  id: string;
  title: string;
  description: string | null;
  category: string;
  severity: string;
  status: string;
  targetResolutionAt: string | null;
  resolutionNotes: string | null;
  createdAt: string;
  owner?: { id: string; name: string | null } | null;
}

const EMPTY = {
  title: "", description: "", category: "SERVICE_DELIVERY",
  severity: "MEDIUM", ownerId: "none", targetResolutionAt: "",
};

export function ClientIssuesPanel({
  institutionId,
  canWrite,
}: {
  institutionId: string;
  canWrite: boolean;
}) {
  const { toast } = useToast();
  const [issues, setIssues] = React.useState<Issue[] | null>(null);
  const [owners, setOwners] = React.useState<{ id: string; name: string }[]>([]);
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [form, setForm] = React.useState({ ...EMPTY });

  const set = (k: keyof typeof EMPTY, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const load = React.useCallback(async () => {
    const res = await fetch(`/api/institutions/${institutionId}/issues`);
    if (!res.ok) { setIssues([]); return; }
    const d = await res.json();
    setIssues(Array.isArray(d) ? d : (d.issues ?? d.data ?? []));
  }, [institutionId]);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    if (!open) return;
    // /api/users does not exist — it was invented, so this fetch 404'd and the
    // picker sat empty with only its placeholder. owner-options is a narrow
    // endpoint added for exactly this, readable by anyone who can open a client.
    fetch("/api/institutions/owner-options")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = Array.isArray(d) ? d : (d?.data ?? []);
        setOwners(list.map((u: { id: string; name: string }) => ({ id: u.id, name: u.name })));
      })
      .catch(() => {});
  }, [open]);

  const valid = form.title.trim().length >= 3 && form.ownerId !== "none";

  async function create() {
    setSaving(true);
    try {
      const res = await fetch(`/api/institutions/${institutionId}/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: form.title.trim(),
          description: form.description.trim() || undefined,
          category: form.category,
          severity: form.severity,
          ownerId: form.ownerId,
          targetResolutionAt: form.targetResolutionAt
            ? new Date(`${form.targetResolutionAt}T00:00:00.000Z`).toISOString()
            : undefined,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: d.error ?? "Could not raise the issue", variant: "destructive" });
        return;
      }
      toast({ title: "Issue raised" });
      setOpen(false);
      setForm({ ...EMPTY });
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function setStatus(issue: Issue, status: string) {
    setBusy(issue.id);
    try {
      const res = await fetch(`/api/institutions/${institutionId}/issues/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: d.error ?? "Could not update the issue", variant: "destructive" });
        return;
      }
      await load();
    } finally {
      setBusy(null);
    }
  }

  const openIssues = (issues ?? []).filter((i) => OPEN_STATUSES.includes(i.status));
  const closed = (issues ?? []).filter((i) => !OPEN_STATUSES.includes(i.status));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Problems raised against this client, who owns them and when they are due.
          </p>
          {openIssues.length > 0 && (
            <p className="text-xs text-amber-600 dark:text-amber-300 font-medium mt-1">
              {openIssues.length} still open
            </p>
          )}
        </div>
        {canWrite && (
          <Button className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 gap-1.5" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            Raise an issue
          </Button>
        )}
      </div>

      {issues === null ? (
        <p className="text-sm text-slate-400 dark:text-slate-500 py-8 text-center">Loading…</p>
      ) : issues.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
          <CheckCircle2 className="h-7 w-7 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm text-slate-500 dark:text-slate-400">No issues raised against this client.</p>
        </div>
      ) : (
        <div className="space-y-5">
          {openIssues.length > 0 && (
            <div className="space-y-2.5">
              {openIssues.map((i) => (
                <Row key={i.id} i={i} canWrite={canWrite} busy={busy === i.id} onStatus={setStatus} />
              ))}
            </div>
          )}
          {closed.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">
                Resolved and closed
              </p>
              <div className="space-y-2.5">
                {closed.map((i) => (
                  <Row key={i.id} i={i} canWrite={canWrite} busy={busy === i.id} onStatus={setStatus} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <Dialog open={open} onOpenChange={(o) => !o && setOpen(false)}>
        <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Raise an issue</DialogTitle></DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <Label>Title *</Label>
              <Input value={form.title} onChange={(e) => set("title", e.target.value)}
                placeholder="e.g. Offer turnaround slipping past ten working days" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Category *</Label>
                <Select value={form.category} onValueChange={(v) => set("category", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Severity *</Label>
                <Select value={form.severity} onValueChange={(v) => set("severity", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SEVERITIES.map((s) => (
                      <SelectItem key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase()}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label>Owner *</Label>
                <Select value={form.ownerId} onValueChange={(v) => set("ownerId", v)}>
                  <SelectTrigger><SelectValue placeholder="Choose" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Choose an owner</SelectItem>
                    {owners.map((o) => (
                      <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  An issue with nobody named against it does not get fixed.
                </p>
              </div>
              <div className="space-y-1.5">
                <Label>Target resolution</Label>
                <Input type="date" value={form.targetResolutionAt}
                  onChange={(e) => set("targetResolutionAt", e.target.value)} />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Description</Label>
              <Textarea rows={3} value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="What is happening, and what has already been tried?" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button disabled={!valid || saving} onClick={create}
              className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white gap-1.5">
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              Raise issue
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({
  i, canWrite, busy, onStatus,
}: {
  i: Issue; canWrite: boolean; busy: boolean;
  onStatus: (i: Issue, s: string) => void;
}) {
  const overdue =
    !!i.targetResolutionAt &&
    OPEN_STATUSES.includes(i.status) &&
    new Date(i.targetResolutionAt) < new Date();

  return (
    <div className={
      "rounded-lg border p-3.5 space-y-2 " +
      (overdue
        ? "border-red-300 bg-red-50/50 dark:border-red-500/40 dark:bg-red-500/5"
        : "border-slate-200 dark:border-slate-800")
    }>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{i.title}</p>
            <Badge variant={SEVERITY_VARIANT[i.severity] ?? "secondary"}>{i.severity}</Badge>
            <Badge variant="outline">
              {CATEGORIES.find((c) => c.value === i.category)?.label ?? i.category}
            </Badge>
            {overdue && (
              <Badge variant="destructive" className="gap-1">
                <AlertOctagon className="h-3 w-3" />Overdue
              </Badge>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {i.owner?.name ? `Owner: ${i.owner.name}` : "No owner"} · raised {formatDate(i.createdAt)}
            {i.targetResolutionAt ? ` · due ${formatDate(i.targetResolutionAt)}` : ""}
          </p>
        </div>
        {canWrite && (
          <div className="shrink-0 flex items-center gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            <Select value={i.status} onValueChange={(v) => onStatus(i, v)}>
              <SelectTrigger className="h-8 text-xs w-[190px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUSES.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {i.description && (
        <p className="text-xs text-slate-600 dark:text-slate-300 whitespace-pre-wrap">{i.description}</p>
      )}
      {i.resolutionNotes && (
        <div className="rounded-md bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-800 p-2.5">
          <p className="text-[11px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide">
            Resolution
          </p>
          <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5 whitespace-pre-wrap">{i.resolutionNotes}</p>
        </div>
      )}
    </div>
  );
}
