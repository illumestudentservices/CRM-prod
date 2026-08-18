"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import { Plus } from "lucide-react";
import {
  LEAVE_TYPE_LABELS,
  leaveTypeLabel,
  DEFAULT_LEAVE_TYPE,
  type LeaveTypeKey,
} from "@/lib/leave-policy";

interface LeaveBalance {
  leaveType: string;
  totalDays: number;
  /** Derived by lib/leave-policy — already net of used and pending. */
  availableDays: number;
  usedDays: number;
  pendingDays: number;
}

interface LeaveRequest {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  status: string;
  reason: string | null;
}


const STATUS_VARIANTS: Record<string, "default" | "success" | "destructive" | "warning" | "secondary"> = {
  PENDING: "warning", APPROVED: "success", REJECTED: "destructive", CANCELLED: "secondary",
};

export function LeaveSection({
  employeeId,
  balances: initialBalances,
  isOwnProfile,
}: {
  employeeId: string;
  balances: LeaveBalance[];
  isOwnProfile: boolean;
}) {
  const { toast } = useToast();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ leaveType: DEFAULT_LEAVE_TYPE, startDate: "", endDate: "", reason: "" });

  async function loadRequests() {
    const res = await fetch(`/api/hr/leave?employeeId=${employeeId}`);
    const data = await res.json();
    setRequests(data.requests || []);
  }

  useEffect(() => { loadRequests(); }, [employeeId]);

  /**
   * A preview of what will be charged, counted the way the server counts it:
   * weekdays only, in UTC. This used to return calendar days — weekends
   * included — under the label "working day(s)", so a Monday-to-Monday request
   * previewed 8 and was charged 6.
   *
   * Public holidays are also deducted, but only the server knows which ones
   * apply to this employee's region, so the label says so rather than showing a
   * number that can still come out lower.
   */
  function calcWeekdays(): number {
    if (!form.startDate || !form.endDate) return 0;
    const cur = new Date(`${form.startDate}T00:00:00Z`);
    const last = new Date(`${form.endDate}T00:00:00Z`);
    if (Number.isNaN(cur.getTime()) || Number.isNaN(last.getTime()) || last < cur) return 0;
    let count = 0;
    while (cur <= last) {
      const day = cur.getUTCDay();
      if (day !== 0 && day !== 6) count++;
      cur.setUTCDate(cur.getUTCDate() + 1);
    }
    return count;
  }

  async function submitLeave() {
    const res = await fetch("/api/hr/leave", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, employeeId }),
    });
    const data = await res.json();
    if (!res.ok) {
      toast({ title: "Error", description: data.error, variant: "destructive" });
      return;
    }
    toast({ title: "Leave request submitted" });
    setShowForm(false);
    loadRequests();
  }

  return (
    <div className="space-y-6">
      {/* Balances */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {initialBalances.map((b) => {
          // availableDays comes from the policy, already net of used and pending
          // and floored at zero. Subtracting here from a stored total is what
          // produced "-5d left" for someone with days remaining.
          const remaining = b.availableDays;
          const usedPct = b.totalDays > 0
            ? Math.min(100, ((b.usedDays + b.pendingDays) / b.totalDays) * 100)
            : 0;
          return (
            <Card key={b.leaveType}>
              <CardHeader className="pb-2 pt-4 px-4">
                <CardTitle className="text-sm">{leaveTypeLabel(b.leaveType)}</CardTitle>
              </CardHeader>
              <CardContent className="px-4 pb-4 space-y-2">
                <Progress value={usedPct} className="h-2" />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>{b.usedDays}d used</span>
                  <span className="font-semibold text-foreground">
                    {remaining}d left of {b.totalDays}d
                  </span>
                </div>
                {b.pendingDays > 0 && (
                  <p className="text-xs text-amber-600">{b.pendingDays}d pending</p>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Leave history */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between py-3 px-4">
          <CardTitle className="text-base">Leave History</CardTitle>
          {isOwnProfile && (
            <Button size="sm" onClick={() => setShowForm(true)}>
              <Plus className="h-4 w-4 mr-1" /> Apply
            </Button>
          )}
        </CardHeader>
        <CardContent className="px-4 pb-4 space-y-2">
          {requests.length === 0
            ? <p className="text-sm text-muted-foreground text-center py-4">No leave requests yet.</p>
            : requests.map((r) => (
              <div key={r.id} className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border text-sm">
                <div>
                  <p className="font-medium">{leaveTypeLabel(r.leaveType)}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(r.startDate)} — {formatDate(r.endDate)} ({r.days}d)</p>
                </div>
                <Badge variant={STATUS_VARIANTS[r.status] ?? "secondary"}>{r.status}</Badge>
              </div>
            ))}
        </CardContent>
      </Card>

      {/* Apply form */}
      <Dialog open={showForm} onOpenChange={setShowForm}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Apply for Leave</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Leave Type</Label>
              <Select value={form.leaveType} onValueChange={(v) => setForm({ ...form, leaveType: v as LeaveTypeKey })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(LEAVE_TYPE_LABELS).map(([k, v]) => (
                    <SelectItem key={k} value={k}>{v}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Start Date</Label>
                <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>End Date</Label>
                <Input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
              </div>
            </div>
            {calcWeekdays() > 0 && (
              <p className="text-sm text-muted-foreground">
                {calcWeekdays()} working day(s), less any public holiday in your region
              </p>
            )}
            <div className="space-y-2">
              <Label>Reason</Label>
              <Textarea value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={3} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
            <Button onClick={submitLeave} disabled={!form.startDate || !form.endDate}>Submit Request</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
