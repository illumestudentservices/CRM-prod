"use client";

import * as React from "react";
import {
  Clock, Loader2, Plus, Send, CheckCircle2, RotateCcw, Trash2, Info, AlertTriangle, FileText,
} from "lucide-react";
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
import {
  WORK_CATEGORIES, workCategoryLabel, STATUS_LABELS, FREQUENCY_LABELS,
} from "@/lib/timesheets-shared";

/**
 * Timesheets.
 *
 * Deliberately does NOT show a "create timesheet" button to everyone: periods
 * are issued automatically to employees with Timesheet Required, and the spec
 * is explicit that people who do not need to submit should not be handed one.
 * HR can open a period by hand for a new joiner.
 */

interface Entry {
  id: string;
  date: string;
  workCategory: string;
  description: string;
  hours: number;
  notes: string | null;
  institution: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
}

interface Sheet {
  id: string;
  status: keyof typeof STATUS_LABELS;
  frequency: string;
  periodStart: string;
  periodEnd: string;
  expectedHours: number;
  loggedHours: number;
  approvedLeaveHours: number;
  totalAccountedHours: number;
  variance: number;
  submittedAt: string | null;
  approvedAt: string | null;
  reviewNotes: string | null;
  employee: {
    id: string;
    employeeId: string;
    jobTitle: string;
    costCentre: string | null;
    department: { id: string; name: string } | null;
    user: { id: string; name: string | null; email: string };
  };
  approver?: { id: string; user: { name: string | null } } | null;
  _count?: { entries: number };
}

interface Detail extends Sheet {
  entries: Entry[];
  events: {
    id: string; action: string; fromStatus: string | null; toStatus: string | null;
    notes: string | null; createdAt: string;
  }[];
}

const STATUS_VARIANT: Record<string, "warning" | "success" | "destructive" | "secondary" | "outline"> = {
  DRAFT: "secondary",
  SUBMITTED: "warning",
  MANAGER_REVIEW: "warning",
  AMENDMENTS_REQUIRED: "destructive",
  APPROVED: "success",
};

const EMPTY_ENTRY = {
  date: "",
  workCategory: "CLIENT_WORK",
  description: "",
  hours: "",
  notes: "",
  institutionId: "none",
  departmentId: "none",
};

// No isHR prop: the API already returns `isAdmin` alongside the scoped list,
// so taking it from the server response keeps one source of truth instead of
// two that can disagree.
export function TimesheetsPanel() {
  const { toast } = useToast();
  const [sheets, setSheets] = React.useState<Sheet[] | null>(null);
  const [isAdmin, setIsAdmin] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const [open, setOpen] = React.useState<Detail | null>(null);
  const [transitions, setTransitions] = React.useState<{ to: string; label: string; requiresNotes?: boolean }[]>([]);
  const [editable, setEditable] = React.useState(false);

  const [entryForm, setEntryForm] = React.useState({ ...EMPTY_ENTRY });
  const [addingEntry, setAddingEntry] = React.useState(false);
  const [institutions, setInstitutions] = React.useState<{ id: string; name: string }[]>([]);
  const [departments, setDepartments] = React.useState<{ id: string; name: string }[]>([]);

  const [returning, setReturning] = React.useState<Detail | null>(null);
  const [returnNotes, setReturnNotes] = React.useState("");

  const load = React.useCallback(async () => {
    const res = await fetch("/api/hr/timesheets");
    if (!res.ok) return;
    const d = await res.json();
    setSheets(d.timesheets ?? []);
    setIsAdmin(!!d.isAdmin);
  }, []);

  React.useEffect(() => { load(); }, [load]);

  // Lookups for the entry form. The spec requires every entity reference to be
  // a CRM lookup rather than a typed identifier.
  React.useEffect(() => {
    if (!open) return;
    fetch("/api/institutions")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = Array.isArray(d) ? d : (d?.data ?? d?.institutions ?? []);
        setInstitutions(list.map((i: { id: string; name: string }) => ({ id: i.id, name: i.name })));
      })
      .catch(() => {});
    fetch("/api/hr/departments")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = Array.isArray(d) ? d : (d?.data ?? d?.departments ?? []);
        setDepartments(list.map((x: { id: string; name: string }) => ({ id: x.id, name: x.name })));
      })
      .catch(() => {});
  }, [open]);

  async function openSheet(id: string) {
    setBusy(id);
    try {
      const res = await fetch(`/api/hr/timesheets/${id}`);
      if (!res.ok) {
        toast({ title: "Could not open timesheet", variant: "destructive" });
        return;
      }
      const d = await res.json();
      setOpen(d.timesheet);
      setTransitions(d.transitions ?? []);
      setEditable(!!d.entriesEditable);
      setEntryForm({ ...EMPTY_ENTRY, date: d.timesheet.periodStart.slice(0, 10) });
    } finally {
      setBusy(null);
    }
  }

  async function move(sheet: Detail, toStatus: string, notes?: string) {
    setBusy(sheet.id);
    try {
      const res = await fetch(`/api/hr/timesheets/${sheet.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ toStatus, ...(notes ? { notes } : {}) }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: d.error ?? "Could not update timesheet", variant: "destructive" });
        return;
      }
      toast({ title: d.message ?? "Timesheet updated" });
      setReturning(null);
      setReturnNotes("");
      await load();
      await openSheet(sheet.id);
    } finally {
      setBusy(null);
    }
  }

  async function addEntry() {
    if (!open) return;
    setAddingEntry(true);
    try {
      const res = await fetch(`/api/hr/timesheets/${open.id}/entries`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          date: entryForm.date,
          workCategory: entryForm.workCategory,
          description: entryForm.description.trim(),
          hours: Number(entryForm.hours),
          notes: entryForm.notes.trim() || null,
          // "none" is the sentinel for an unset Select: Radix reserves "" and
          // throws if it is used as an item value.
          institutionId: entryForm.institutionId === "none" ? null : entryForm.institutionId,
          departmentId: entryForm.departmentId === "none" ? null : entryForm.departmentId,
        }),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: d.error ?? "Could not add the line", variant: "destructive" });
        return;
      }
      setEntryForm({ ...EMPTY_ENTRY, date: open.periodStart.slice(0, 10) });
      await openSheet(open.id);
      await load();
    } finally {
      setAddingEntry(false);
    }
  }

  async function removeEntry(entryId: string) {
    if (!open) return;
    const res = await fetch(`/api/hr/timesheets/${open.id}/entries/${entryId}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      toast({ title: d.error ?? "Could not remove the line", variant: "destructive" });
      return;
    }
    await openSheet(open.id);
    await load();
  }

  async function openPeriod() {
    setBusy("new");
    try {
      const res = await fetch("/api/hr/timesheets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: d.error ?? "Could not open a period", variant: "destructive" });
        return;
      }
      toast({ title: "Timesheet period opened" });
      await load();
    } finally {
      setBusy(null);
    }
  }

  const entryValid =
    !!entryForm.date && !!entryForm.description.trim() && Number(entryForm.hours) > 0;

  const mine = (sheets ?? []).filter((s) => s.status !== "APPROVED");
  const done = (sheets ?? []).filter((s) => s.status === "APPROVED");

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm text-slate-600 dark:text-slate-300">
            Time recording for staff whose role requires it. Periods open automatically —
            field work is recorded in Field Operations, not here.
          </p>
        </div>
        <Button
          variant="outline"
          className="gap-1.5"
          disabled={busy === "new"}
          onClick={openPeriod}
        >
          {busy === "new" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Open current period
        </Button>
      </div>

      {sheets === null ? (
        <p className="text-sm text-slate-400 dark:text-slate-500 py-8 text-center">Loading…</p>
      ) : sheets.length === 0 ? (
        <div className="text-center py-10 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
          <Clock className="h-7 w-7 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
          <p className="text-sm text-slate-500 dark:text-slate-400">No timesheets yet.</p>
          <p className="text-xs text-slate-400 dark:text-slate-500 mt-1 max-w-md mx-auto">
            Periods are issued automatically to employees with{" "}
            <strong>Timesheet Required</strong> switched on. Turn it on for someone from their
            employee profile, or use &ldquo;Open current period&rdquo;.
          </p>
        </div>
      ) : (
        <div className="space-y-5">
          {mine.length > 0 && (
            <div className="space-y-2.5">
              {mine.map((s) => (
                <Row key={s.id} s={s} onOpen={() => openSheet(s.id)} busy={busy === s.id} showWho={isAdmin} />
              ))}
            </div>
          )}
          {done.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wide mb-2">
                Approved
              </p>
              <div className="space-y-2.5">
                {done.map((s) => (
                  <Row key={s.id} s={s} onOpen={() => openSheet(s.id)} busy={busy === s.id} showWho={isAdmin} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Timesheet detail ─────────────────────────────────────────── */}
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-4xl max-h-[92vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {open ? `${formatDate(open.periodStart)} — ${formatDate(open.periodEnd)}` : "Timesheet"}
            </DialogTitle>
          </DialogHeader>

          {open && (
            <div className="space-y-4">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={STATUS_VARIANT[open.status]}>{STATUS_LABELS[open.status]}</Badge>
                <Badge variant="outline">{FREQUENCY_LABELS[open.frequency] ?? open.frequency}</Badge>
                <span className="text-xs text-slate-500 dark:text-slate-400">
                  {open.employee.user.name ?? open.employee.user.email} · {open.employee.employeeId}
                  {open.employee.costCentre ? ` · ${open.employee.costCentre}` : ""}
                </span>
              </div>

              {/* Every figure here is calculated. None of it is typed in. */}
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                <Figure label="Expected" value={open.expectedHours} />
                <Figure label="Logged" value={open.loggedHours} />
                <Figure label="Approved leave" value={open.approvedLeaveHours} />
                <Figure label="Total accounted" value={open.totalAccountedHours} />
                <Figure
                  label="Variance"
                  value={open.variance}
                  tone={open.variance < 0 ? "bad" : open.variance > 0 ? "warn" : "good"}
                />
              </div>

              {open.status === "AMENDMENTS_REQUIRED" && open.reviewNotes && (
                <div className="flex gap-2 rounded-md bg-red-50 border border-red-200 dark:bg-red-500/10 dark:border-red-500/30 p-2.5">
                  <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs font-semibold text-red-900 dark:text-red-200">Amendments requested</p>
                    <p className="text-xs text-red-800 dark:text-red-300 mt-0.5 whitespace-pre-wrap">{open.reviewNotes}</p>
                  </div>
                </div>
              )}

              {open.status === "APPROVED" && (
                <div className="flex gap-2 rounded-md bg-emerald-50 border border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30 p-2.5">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-emerald-800 dark:text-emerald-300">
                    Approved{open.approvedAt ? ` on ${formatDate(open.approvedAt)}` : ""} and now read-only.
                  </p>
                </div>
              )}

              {/* ── Lines ── */}
              <div>
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                  Entries ({open.entries.length})
                </p>
                {open.entries.length === 0 ? (
                  <p className="text-xs text-slate-400 dark:text-slate-500 py-3 text-center border border-dashed rounded-md">
                    No time recorded yet.
                  </p>
                ) : (
                  <div className="border border-slate-200 dark:border-slate-800 rounded-md divide-y divide-slate-200 dark:divide-slate-800">
                    {open.entries.map((e) => (
                      <div key={e.id} className="flex items-start justify-between gap-3 p-2.5">
                        <div className="min-w-0">
                          <p className="text-xs font-medium text-slate-800 dark:text-slate-200">
                            {formatDate(e.date)} · {workCategoryLabel(e.workCategory)}
                            {e.institution ? ` · ${e.institution.name}` : ""}
                            {e.department ? ` · ${e.department.name}` : ""}
                          </p>
                          <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">{e.description}</p>
                          {e.notes && (
                            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">{e.notes}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{e.hours}h</span>
                          {editable && (
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-slate-400 hover:text-red-600"
                              onClick={() => removeEntry(e.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* ── Add a line ── */}
              {editable && (
                <div className="rounded-lg border border-slate-200 dark:border-slate-800 p-3 space-y-3">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
                    Add a line
                  </p>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Date *</Label>
                      <Input
                        type="date"
                        className="h-8 text-xs"
                        min={open.periodStart.slice(0, 10)}
                        max={open.periodEnd.slice(0, 10)}
                        value={entryForm.date}
                        onChange={(e) => setEntryForm((f) => ({ ...f, date: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Category *</Label>
                      <Select
                        value={entryForm.workCategory}
                        onValueChange={(v) => setEntryForm((f) => ({ ...f, workCategory: v }))}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {WORK_CATEGORIES.map((c) => (
                            <SelectItem key={c} value={c}>{workCategoryLabel(c)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Client</Label>
                      <Select
                        value={entryForm.institutionId}
                        onValueChange={(v) => setEntryForm((f) => ({ ...f, institutionId: v }))}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {institutions.map((i) => (
                            <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Cost centre</Label>
                      <Select
                        value={entryForm.departmentId}
                        onValueChange={(v) => setEntryForm((f) => ({ ...f, departmentId: v }))}
                      >
                        <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          {departments.map((d) => (
                            <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-6 gap-2">
                    <div className="sm:col-span-5 space-y-1">
                      <Label className="text-xs">Description *</Label>
                      <Input
                        className="h-8 text-xs"
                        placeholder="What was the time spent on?"
                        value={entryForm.description}
                        onChange={(e) => setEntryForm((f) => ({ ...f, description: e.target.value }))}
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Hours *</Label>
                      <Input
                        type="number" step="0.25" min="0.25" max="24"
                        className="h-8 text-xs"
                        value={entryForm.hours}
                        onChange={(e) => setEntryForm((f) => ({ ...f, hours: e.target.value }))}
                      />
                    </div>
                  </div>
                  <Button
                    size="sm"
                    className="h-8 gap-1.5 bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white"
                    disabled={!entryValid || addingEntry}
                    onClick={addEntry}
                  >
                    {addingEntry ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                    Add line
                  </Button>
                </div>
              )}

              {/* ── History ── */}
              {open.events.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-1.5">
                    History
                  </p>
                  <div className="space-y-1">
                    {open.events.slice(0, 12).map((ev) => (
                      <p key={ev.id} className="text-[11px] text-slate-500 dark:text-slate-400">
                        {formatDate(ev.createdAt)} · {ev.action.replace(/_/g, " ").toLowerCase()}
                        {ev.notes ? ` — ${ev.notes}` : ""}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="gap-2 flex-wrap">
            <Button variant="outline" onClick={() => setOpen(null)}>Close</Button>
            {open && transitions.map((t) => {
              const isReturn = t.to === "AMENDMENTS_REQUIRED";
              const isApprove = t.to === "APPROVED";
              return (
                <Button
                  key={t.to}
                  disabled={busy === open.id}
                  variant={isReturn ? "destructive" : "default"}
                  className={isApprove ? "bg-green-600 hover:bg-green-700 text-white gap-1.5" : "gap-1.5"}
                  onClick={() => (isReturn ? (setReturning(open), setReturnNotes("")) : move(open, t.to))}
                >
                  {busy === open.id ? <Loader2 className="h-4 w-4 animate-spin" />
                    : isApprove ? <CheckCircle2 className="h-4 w-4" />
                    : isReturn ? <RotateCcw className="h-4 w-4" />
                    : <Send className="h-4 w-4" />}
                  {t.label}
                </Button>
              );
            })}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Return for amendment, reason required ────────────────────── */}
      <Dialog open={!!returning} onOpenChange={(o) => !o && setReturning(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Return for amendment</DialogTitle></DialogHeader>
          <div className="space-y-3 py-1">
            <div className="flex gap-2 rounded-lg bg-sky-50 border border-sky-200 dark:bg-sky-500/10 dark:border-sky-500/30 p-2.5">
              <Info className="h-4 w-4 text-sky-600 dark:text-sky-300 shrink-0 mt-0.5" />
              <p className="text-xs text-sky-800 dark:text-sky-300">
                The employee is notified and can edit their lines again. Say what needs changing.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label>What needs changing? *</Label>
              <Textarea
                rows={3}
                value={returnNotes}
                onChange={(e) => setReturnNotes(e.target.value)}
                placeholder="e.g. Thursday's 8 hours has no description — please say what the work was."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturning(null)}>Cancel</Button>
            <Button
              variant="destructive"
              disabled={returnNotes.trim().length < 5 || busy === returning?.id}
              onClick={() => returning && move(returning, "AMENDMENTS_REQUIRED", returnNotes.trim())}
            >
              {busy === returning?.id && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Return for amendment
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Row({ s, onOpen, busy, showWho }: { s: Sheet; onOpen: () => void; busy: boolean; showWho: boolean }) {
  return (
    <button
      onClick={onOpen}
      disabled={busy}
      className="w-full text-left rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 hover:border-slate-300 dark:hover:border-slate-700 transition-colors"
    >
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {formatDate(s.periodStart)} — {formatDate(s.periodEnd)}
            </p>
            <Badge variant={STATUS_VARIANT[s.status]}>{STATUS_LABELS[s.status]}</Badge>
            {s.variance < 0 && s.status !== "APPROVED" && (
              <Badge variant="outline">{s.variance}h short</Badge>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {showWho ? `${s.employee.user.name ?? s.employee.user.email} · ` : ""}
            {s.loggedHours}h logged of {s.expectedHours}h expected
            {s.approvedLeaveHours > 0 ? ` · ${s.approvedLeaveHours}h leave` : ""}
            {s._count ? ` · ${s._count.entries} line${s._count.entries === 1 ? "" : "s"}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {busy ? <Loader2 className="h-4 w-4 animate-spin text-slate-400" /> : <FileText className="h-4 w-4 text-slate-300 dark:text-slate-600" />}
        </div>
      </div>
    </button>
  );
}

function Figure({ label, value, tone }: { label: string; value: number; tone?: "good" | "warn" | "bad" }) {
  const colour =
    tone === "bad" ? "text-red-600 dark:text-red-400"
    : tone === "warn" ? "text-amber-600 dark:text-amber-400"
    : tone === "good" ? "text-emerald-600 dark:text-emerald-400"
    : "text-slate-900 dark:text-slate-100";
  return (
    <div className="rounded-md border border-slate-200 dark:border-slate-800 p-2">
      <p className="text-[10px] font-medium text-slate-400 dark:text-slate-500 uppercase tracking-wide">{label}</p>
      <p className={`text-sm font-semibold ${colour}`}>{value}h</p>
    </div>
  );
}
