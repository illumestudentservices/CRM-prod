"use client";

/**
 * Leave in Lieu — self-service + approvals in one place, mounted on the HR
 * Leave Management tab.
 *
 *   - Anyone with an employee record can log extra hours worked; the day
 *     equivalent (8h = 1 day) goes to their manager for approval and, once
 *     approved, is credited to their In-Lieu balance for the year.
 *   - Managers/HR see a queue of pending in-lieu requests to approve or reject.
 *   - Everyone sees their own in-lieu request history.
 *
 * The time OFF is booked separately as an ordinary In-Lieu leave request through
 * the normal Apply-for-leave flow, which already enforces the balance.
 */

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import { CheckCircle, XCircle, Clock, Plus, Loader2, Hourglass } from "lucide-react";

const HOURS_PER_DAY = 8;

interface InLieuRequest {
  id: string;
  workDate: string;
  workDateEnd: string | null;
  hours: number;
  days: number;
  reason: string | null;
  status: string;
  canDecide: boolean;
  employee: { employeeId: string; user: { name: string | null } };
}

const STATUS_VARIANT: Record<string, "warning" | "success" | "destructive" | "secondary"> = {
  PENDING: "warning", APPROVED: "success", REJECTED: "destructive", CANCELLED: "secondary",
};

/** "1 Nov" for a single day, or "1 Nov – 2 Nov" for a range. */
const workedRange = (r: { workDate: string; workDateEnd: string | null }) =>
  r.workDateEnd ? `${formatDate(r.workDate)} – ${formatDate(r.workDateEnd)}` : formatDate(r.workDate);

export function InLieuSection({
  myEmployeeId,
  isHR,
  onChanged,
}: {
  myEmployeeId?: string | null;
  isHR: boolean;
  onChanged?: () => void;
}) {
  const { toast } = useToast();
  const [mine, setMine] = useState<InLieuRequest[]>([]);
  const [pending, setPending] = useState<InLieuRequest[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Reject flow: the request being rejected + an optional comment.
  const [rejectTarget, setRejectTarget] = useState<InLieuRequest | null>(null);
  const [rejectNote, setRejectNote] = useState("");

  // Log-hours form
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workDate, setWorkDate] = useState("");
  const [workDateEnd, setWorkDateEnd] = useState("");
  const [hours, setHours] = useState("");
  const [reason, setReason] = useState("");

  const load = useCallback(async () => {
    // Own history
    try {
      const res = await fetch("/api/hr/leave/in-lieu");
      const data = await res.json().catch(() => ({}));
      setMine(res.ok ? (data.requests ?? []) : []);
    } catch { setMine([]); }
    // Pending approvals: HR sees all pending; a line manager sees their team's.
    try {
      const url = isHR
        ? "/api/hr/leave/in-lieu?status=PENDING"
        : "/api/hr/leave/in-lieu?scope=team&status=PENDING";
      const res = await fetch(url);
      const data = await res.json().catch(() => ({}));
      setPending(res.ok ? (data.requests ?? []) : []);
    } catch { setPending([]); }
  }, [isHR]);

  useEffect(() => { load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!myEmployeeId) return;
    setSaving(true);
    try {
      const res = await fetch("/api/hr/leave/in-lieu", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId: myEmployeeId,
          workDate,
          workDateEnd: workDateEnd || undefined,
          hours: Number(hours),
          reason: reason || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not submit", description: data.error ?? "Please try again.", variant: "destructive" });
        return;
      }
      toast({ title: "In-lieu request sent", description: "Your manager will review it." });
      setOpen(false);
      setWorkDate(""); setWorkDateEnd(""); setHours(""); setReason("");
      await load();
      onChanged?.();
    } finally {
      setSaving(false);
    }
  }

  async function decide(id: string, action: "APPROVED" | "REJECTED", note?: string) {
    setBusyId(id);
    try {
      const res = await fetch(`/api/hr/leave/in-lieu/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, ...(note && note.trim() ? { rejectionNote: note.trim() } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not update", description: data.error ?? "Please try again.", variant: "destructive" });
        return;
      }
      toast({
        title: action === "APPROVED" ? "In-lieu approved & credited" : "In-lieu rejected",
        variant: action === "APPROVED" ? "default" : "destructive",
      });
      setRejectTarget(null); setRejectNote("");
      await load();
      onChanged?.();
    } finally {
      setBusyId(null);
    }
  }

  const dayPreview = hours && Number(hours) > 0
    ? `= ${(Number(hours) / HOURS_PER_DAY).toFixed(2)} day(s)`
    : "";

  return (
    <Card className="border-amber-200 dark:border-amber-500/30">
      <CardHeader className="py-3 px-4 flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base flex items-center gap-2">
          <Hourglass className="h-4 w-4 text-amber-600 dark:text-amber-300" />
          Leave in Lieu
        </CardTitle>
        {myEmployeeId && (
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) { setWorkDate(""); setWorkDateEnd(""); setHours(""); setReason(""); } }}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5"><Plus className="h-4 w-4" /> Log extra hours</Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Log extra hours (in lieu)</DialogTitle>
              </DialogHeader>
              <form onSubmit={submit} className="space-y-4 pt-1">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="il-date">Worked from <span className="text-red-500">*</span></Label>
                    <Input id="il-date" type="date" value={workDate} required onChange={(e) => setWorkDate(e.target.value)} />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="il-date-end">To (optional)</Label>
                    <Input id="il-date-end" type="date" value={workDateEnd} min={workDate || undefined}
                      onChange={(e) => setWorkDateEnd(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="il-hours">Total extra hours worked <span className="text-red-500">*</span></Label>
                  <Input id="il-hours" type="number" min="0.5" step="0.5" value={hours} required
                    placeholder="e.g. 8" onChange={(e) => setHours(e.target.value)} />
                  <p className="text-xs text-muted-foreground">
                    8 hours = 1 day. {dayPreview} Weekends and holidays count too.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="il-reason">Reason</Label>
                  <Textarea id="il-reason" rows={2} value={reason}
                    placeholder="e.g. Weekend education fair" onChange={(e) => setReason(e.target.value)} />
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
                  <Button type="submit" disabled={saving || !workDate || !hours} className="gap-1.5">
                    {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Send for approval
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        {/* Pending approvals (managers / HR) */}
        {pending.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Awaiting your approval ({pending.length})
            </p>
            {pending.map((r) => (
              <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-muted/30 border text-sm">
                <div className="min-w-0">
                  <p className="font-medium">
                    {r.employee.user.name}{" "}
                    <span className="text-xs text-muted-foreground font-mono">{r.employee.employeeId}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {r.hours}h on {workedRange(r)} · {r.days} day(s) in lieu
                  </p>
                  {r.reason && <p className="text-xs text-muted-foreground truncate max-w-[420px]">{r.reason}</p>}
                </div>
                {r.canDecide && (
                  <div className="flex gap-2 shrink-0">
                    <Button size="sm" variant="outline" disabled={busyId === r.id}
                      className="h-7 text-green-600 border-green-300 dark:text-green-400 dark:border-green-500/40 dark:hover:bg-green-500/10"
                      onClick={() => decide(r.id, "APPROVED")}>
                      <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                    </Button>
                    <Button size="sm" variant="outline" disabled={busyId === r.id}
                      className="h-7 text-red-600 border-red-300 dark:text-red-400 dark:border-red-500/40 dark:hover:bg-red-500/10"
                      onClick={() => { setRejectTarget(r); setRejectNote(""); }}>
                      <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                    </Button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Own in-lieu history */}
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Your in-lieu requests</p>
          {mine.length === 0 ? (
            <p className="text-sm text-muted-foreground flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> None yet. Worked extra? Log the hours above.
            </p>
          ) : (
            <div className="space-y-1.5">
              {mine.map((r) => (
                <div key={r.id} className="flex items-center justify-between gap-3 p-2.5 rounded-lg border text-sm">
                  <span className="text-muted-foreground">
                    {r.hours}h on {workedRange(r)} · <span className="font-medium text-foreground">{r.days} day(s)</span>
                  </span>
                  <Badge variant={STATUS_VARIANT[r.status] ?? "secondary"}>{r.status}</Badge>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>

      {/* Reject with an optional comment */}
      <Dialog open={!!rejectTarget} onOpenChange={(v) => { if (!v) { setRejectTarget(null); setRejectNote(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject in-lieu request</DialogTitle>
          </DialogHeader>
          {rejectTarget && (
            <div className="space-y-3 pt-1">
              <p className="text-sm text-muted-foreground">
                {rejectTarget.employee.user.name} · {rejectTarget.hours}h on {workedRange(rejectTarget)} ({rejectTarget.days} day(s))
              </p>
              <div className="space-y-1.5">
                <Label htmlFor="il-reject-note">Comment (optional)</Label>
                <Textarea id="il-reject-note" rows={3} value={rejectNote}
                  placeholder="Why is this being rejected? (optional — shared with the employee)"
                  onChange={(e) => setRejectNote(e.target.value)} />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => { setRejectTarget(null); setRejectNote(""); }}>Cancel</Button>
                <Button type="button" variant="destructive" disabled={busyId === rejectTarget.id}
                  onClick={() => decide(rejectTarget.id, "REJECTED", rejectNote)}>
                  {busyId === rejectTarget.id && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
                  Reject
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
