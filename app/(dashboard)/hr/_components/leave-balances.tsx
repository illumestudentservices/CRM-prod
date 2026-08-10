"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Pencil, Search } from "lucide-react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { leaveTypeLabel, LEAVE_TYPE_BADGE_CLASSES } from "@/lib/leave-policy";

interface Balance {
  id: string;
  employeeId: string;
  leaveType: string;
  year: number;
  /** Accrued entitlement plus any HR adjustment. */
  totalDays: number;
  usedDays: number;
  pendingDays: number;
  /** Days granted or docked by HR on top of the accrued figure. */
  adjustmentDays: number;
  availableDays: number;
  accruedDays: number;
  inWaitingPeriod: boolean;
  eligibleFrom: string | null;
  nextAccrualOn: string | null;
  tracksBalance: boolean;
  policySummary: string;
  employee: {
    employeeId: string;
    user: { name: string | null };
    department: { name: string } | null;
  };
}

const LEAVE_LABELS: Record<string, string> = {
  ANNUAL: "Annual", SICK: "Sick", MATERNITY: "Maternity",
  PATERNITY: "Paternity", UNPAID: "Unpaid", COMP_OFF: "Comp Off",
};


export function LeaveBalances() {
  const { toast } = useToast();
  const currentYear = new Date().getFullYear();

  const [balances, setBalances] = React.useState<Balance[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [year, setYear] = React.useState(String(currentYear));
  const [search, setSearch] = React.useState("");
  const [leaveTypeFilter, setLeaveTypeFilter] = React.useState("all");

  const [editTarget, setEditTarget] = React.useState<Balance | null>(null);
  const [newTotal, setNewTotal] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [saving, setSaving] = React.useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch(`/api/hr/leave/balances?year=${year}`);
    const data = await res.json();
    setBalances(data.balances ?? []);
    setLoading(false);
  }

  React.useEffect(() => { load(); }, [year]);

  const filtered = React.useMemo(() => {
    const q = search.toLowerCase();
    return balances.filter((b) => {
      const name = (b.employee.user.name ?? "").toLowerCase();
      if (q && !name.includes(q) && !b.employee.employeeId.toLowerCase().includes(q)) return false;
      if (leaveTypeFilter !== "all" && b.leaveType !== leaveTypeFilter) return false;
      return true;
    });
  }, [balances, search, leaveTypeFilter]);

  function openEdit(b: Balance) {
    setEditTarget(b);
    setNewTotal(String(b.adjustmentDays ?? 0));
    setReason("");
  }

  async function saveEdit() {
    if (!editTarget) return;
    // An adjustment sits on top of the accrued figure and may be negative, so
    // overwriting the entitlement outright is no longer offered — accrual would
    // simply recompute over it.
    const adjustment = parseFloat(newTotal);
    if (isNaN(adjustment)) {
      toast({ title: "Enter a number of days", variant: "destructive" });
      return;
    }
    if (!reason.trim()) {
      toast({ title: "Please enter a reason", variant: "destructive" });
      return;
    }
    setSaving(true);
    const res = await fetch("/api/hr/leave/balances", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        employeeId: editTarget.employeeId,
        leaveType: editTarget.leaveType,
        year: editTarget.year,
        adjustmentDays: adjustment,
        reason: reason.trim(),
      }),
    });
    setSaving(false);
    if (res.ok) {
      toast({ title: "Leave balance updated" });
      setEditTarget(null);
      load();
    } else {
      const d = await res.json();
      toast({ title: "Error", description: d.error, variant: "destructive" });
    }
  }

  const years = [currentYear - 1, currentYear, currentYear + 1].map(String);

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400 dark:text-slate-500 pointer-events-none" />
          <Input
            placeholder="Search by name or ID…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 h-9 text-sm"
          />
        </div>

        <Select value={leaveTypeFilter} onValueChange={setLeaveTypeFilter}>
          <SelectTrigger className="h-9 w-[150px] text-sm">
            <SelectValue placeholder="Leave Type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {Object.entries(LEAVE_LABELS).map(([k, v]) => (
              <SelectItem key={k} value={k}>{v}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={year} onValueChange={setYear}>
          <SelectTrigger className="h-9 w-[110px] text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {years.map((y) => (
              <SelectItem key={y} value={y}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <p className="text-xs text-slate-500 dark:text-slate-400 ml-auto">
          {filtered.length} record{filtered.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden bg-white dark:bg-slate-900">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 dark:bg-slate-900/40">
              <TableHead className="w-[200px]">Employee</TableHead>
              <TableHead>Dept</TableHead>
              <TableHead>Leave Type</TableHead>
              <TableHead className="text-right">Allocated</TableHead>
              <TableHead className="text-right">Used</TableHead>
              <TableHead className="text-right">Pending</TableHead>
              <TableHead className="text-right">Remaining</TableHead>
              <TableHead className="w-[60px]"></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 8 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 8 }).map((__, j) => (
                    <TableCell key={j}><div className="h-4 bg-slate-100 dark:bg-slate-800 animate-pulse rounded" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-slate-400 dark:text-slate-500 text-sm">
                  No leave balances found. Balances are created when employees apply for leave.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((b) => {
                // Server already nets off used and pending against the accrued
                // figure — recomputing here would drift from what's enforced.
                const remaining = b.availableDays;
                const usedPct = b.totalDays > 0 ? Math.round((b.usedDays / b.totalDays) * 100) : 0;
                return (
                  <TableRow key={b.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/60">
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium text-slate-900 dark:text-slate-100">{b.employee.user.name ?? "—"}</p>
                        <p className="text-xs text-slate-400 dark:text-slate-500">{b.employee.employeeId}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-slate-600 dark:text-slate-300">{b.employee.department?.name ?? "—"}</span>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${(LEAVE_TYPE_BADGE_CLASSES as Record<string,string>)[b.leaveType] ?? "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>
                        {LEAVE_LABELS[b.leaveType] ?? b.leaveType}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {!b.tracksBalance ? (
                        <span className="text-xs text-slate-400 dark:text-slate-500">Not tracked</span>
                      ) : b.inWaitingPeriod ? (
                        <span
                          className="text-xs text-amber-600 dark:text-amber-300"
                          title={
                            b.eligibleFrom
                              ? `Eligible from ${new Date(b.eligibleFrom).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                              : undefined
                          }
                        >
                          Not yet eligible
                        </span>
                      ) : (
                        <>
                          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{b.totalDays}d</span>
                          {b.adjustmentDays !== 0 && (
                            <span
                              className="text-[10px] text-slate-400 dark:text-slate-500 ml-1"
                              title="Includes an HR adjustment"
                            >
                              ({b.accruedDays}
                              {b.adjustmentDays > 0 ? "+" : ""}
                              {b.adjustmentDays})
                            </span>
                          )}
                        </>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-sm text-slate-700 dark:text-slate-200">{b.usedDays}d</span>
                      {b.usedDays > 0 && (
                        <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">({usedPct}%)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {b.pendingDays > 0 ? (
                        <span className="text-sm text-amber-600 dark:text-amber-300">{b.pendingDays}d</span>
                      ) : (
                        <span className="text-sm text-slate-400 dark:text-slate-500">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={`text-sm font-semibold ${remaining <= 0 ? "text-red-600 dark:text-red-400" : remaining <= 3 ? "text-amber-600 dark:text-amber-300" : "text-green-600 dark:text-green-400"}`}>
                        {remaining}d
                      </span>
                    </TableCell>
                    <TableCell>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 w-7 p-0"
                        onClick={() => openEdit(b)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editTarget} onOpenChange={(o) => !o && setEditTarget(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Adjust Leave Balance</DialogTitle>
          </DialogHeader>
          {editTarget && (
            <div className="space-y-4">
              <div className="bg-slate-50 dark:bg-slate-900/40 rounded-lg p-3 space-y-1 text-sm">
                <p className="font-medium">{editTarget.employee.user.name}</p>
                <p className="text-slate-500 dark:text-slate-400">{LEAVE_LABELS[editTarget.leaveType]} · {editTarget.year}</p>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-400 dark:text-slate-500 pt-1">
                  <span>Accrued: <strong className="text-slate-700 dark:text-slate-200">{editTarget.accruedDays}d</strong></span>
                  <span>Used: <strong className="text-slate-700 dark:text-slate-200">{editTarget.usedDays}d</strong></span>
                  <span>Pending: <strong className="text-slate-700 dark:text-slate-200">{editTarget.pendingDays}d</strong></span>
                  <span>Available: <strong className="text-slate-700 dark:text-slate-200">{editTarget.availableDays}d</strong></span>
                </div>
              </div>

              <div className="rounded-lg border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800 p-3">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-1">Policy</p>
                <p className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">{editTarget.policySummary}</p>
              </div>

              <div className="space-y-2">
                <Label>Adjustment (days)</Label>
                <Input
                  type="number"
                  step="0.5"
                  min={-365}
                  max={365}
                  value={newTotal}
                  onChange={(e) => setNewTotal(e.target.value)}
                  className="w-full"
                />
                {/* The entitlement itself is recomputed from the policy, so an
                    override would be overwritten — an adjustment layers on top. */}
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  Added on top of the accrued {editTarget.accruedDays}d. Use a negative
                  number to dock days. Entitlement becomes{" "}
                  <strong className="text-slate-600 dark:text-slate-300">
                    {Math.round((editTarget.accruedDays + (parseFloat(newTotal) || 0)) * 100) / 100}d
                  </strong>.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Reason for Change <span className="text-red-500">*</span></Label>
                <Textarea
                  placeholder="e.g. Annual policy update, correction, carry-over…"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button
              onClick={saveEdit}
              disabled={saving || !reason.trim() || !newTotal}
            >
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
