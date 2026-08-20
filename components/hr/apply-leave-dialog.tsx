"use client";

/**
 * Applying for your own leave, from the Leave Management tab.
 *
 * The dashboard has always had a link labelled "Apply for leave →" pointing at
 * /hr?tab=leave, and that tab listed requests without offering any way to make
 * one. The only apply form in the app was inside an employee's own profile
 * page, which an HR Manager or Regional Manager lands on only by navigating to
 * themselves deliberately — so the link promised an action the destination
 * could not perform.
 *
 * Deliberately its own component rather than a refactor of the form inside
 * LeaveSection: that screen works, and rebuilding it to be shared risks
 * breaking a path people already rely on to fix one that never worked.
 */

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CalendarPlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { LEAVE_TYPE_LABELS, type LeaveTypeKey } from "@/lib/leave-policy";

export interface ApplyLeaveBalance {
  leaveType: string;
  totalDays: number;
  availableDays: number;
}

/**
 * Weekdays between two dates, counted in UTC — the same way the server counts
 * what it will charge. Counting calendar days here would preview 8 for a
 * Monday-to-Monday request that is actually charged as 6.
 */
function weekdaysBetween(start: string, end: string): number {
  if (!start || !end) return 0;
  const cur = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (Number.isNaN(cur.getTime()) || Number.isNaN(last.getTime()) || last < cur) return 0;
  let n = 0;
  while (cur <= last) {
    const d = cur.getUTCDay();
    if (d !== 0 && d !== 6) n++;
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return n;
}

export function ApplyLeaveDialog({
  employeeId,
  balances,
  onApplied,
}: {
  employeeId: string;
  /** Already filtered by gender upstream, so only entitled types are offered. */
  balances: ApplyLeaveBalance[];
  onApplied?: () => void;
}) {
  const { toast } = useToast();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [form, setForm] = React.useState({
    leaveType: balances[0]?.leaveType ?? "VACATION_PAID",
    startDate: "",
    endDate: "",
    reason: "",
  });

  const days = weekdaysBetween(form.startDate, form.endDate);
  const chosen = balances.find((b) => b.leaveType === form.leaveType);
  const overBalance = chosen != null && days > chosen.availableDays;

  async function submit() {
    if (!form.startDate || !form.endDate) {
      toast({ title: "Pick both dates", variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/hr/leave", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          employeeId,
          leaveType: form.leaveType,
          // The API takes datetimes; the pickers give dates. UTC midnight keeps
          // the day the person chose from drifting either side of a boundary.
          startDate: new Date(`${form.startDate}T00:00:00Z`).toISOString(),
          endDate: new Date(`${form.endDate}T00:00:00Z`).toISOString(),
          reason: form.reason || undefined,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? "Could not submit the request");
      toast({
        title: "Leave requested",
        description: `${days} working day${days === 1 ? "" : "s"} sent for approval.`,
      });
      setOpen(false);
      setForm({ leaveType: balances[0]?.leaveType ?? "VACATION_PAID", startDate: "", endDate: "", reason: "" });
      onApplied?.();
    } catch (err) {
      toast({
        title: "Could not request leave",
        description: err instanceof Error ? err.message : "Try again",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Button size="sm" className="gap-2" onClick={() => setOpen(true)}>
        <CalendarPlus className="h-4 w-4" />
        Apply for Leave
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Apply for Leave</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Leave Type</Label>
              <Select value={form.leaveType} onValueChange={(v) => setForm({ ...form, leaveType: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {balances.map((b) => (
                    <SelectItem key={b.leaveType} value={b.leaveType}>
                      {LEAVE_TYPE_LABELS[b.leaveType as LeaveTypeKey] ?? b.leaveType}
                      {" · "}{b.availableDays}d left
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={form.startDate}
                  onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" value={form.endDate}
                  onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </div>
            </div>

            {days > 0 && (
              <p className={`text-sm ${overBalance ? "text-red-600 dark:text-red-400" : "text-muted-foreground"}`}>
                {days} working day{days === 1 ? "" : "s"}
                {chosen ? ` · ${chosen.availableDays}d available` : ""}
                {overBalance ? " — more than you have left" : ""}
              </p>
            )}

            <div className="space-y-2">
              <Label>Reason</Label>
              <Textarea rows={3} value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
                placeholder="Optional" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={submit} disabled={saving || days === 0}>
              {saving ? "Submitting…" : "Submit Request"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
