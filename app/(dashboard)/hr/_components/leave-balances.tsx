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

interface Balance {
  id: string;
  employeeId: string;
  leaveType: string;
  year: number;
  totalDays: number;
  usedDays: number;
  pendingDays: number;
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

const LEAVE_COLORS: Record<string, string> = {
  ANNUAL: "bg-blue-100 text-blue-700",
  SICK: "bg-red-100 text-red-700",
  MATERNITY: "bg-pink-100 text-pink-700",
  PATERNITY: "bg-indigo-100 text-indigo-700",
  UNPAID: "bg-slate-100 text-slate-600",
  COMP_OFF: "bg-amber-100 text-amber-700",
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
    setNewTotal(String(b.totalDays));
    setReason("");
  }

  async function saveEdit() {
    if (!editTarget) return;
    const total = parseFloat(newTotal);
    if (isNaN(total) || total < 0) {
      toast({ title: "Invalid value", variant: "destructive" });
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
        totalDays: total,
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
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400 pointer-events-none" />
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

        <p className="text-xs text-slate-500 ml-auto">
          {filtered.length} record{filtered.length !== 1 ? "s" : ""}
        </p>
      </div>

      {/* Table */}
      <div className="border rounded-lg overflow-hidden bg-white">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50">
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
                    <TableCell key={j}><div className="h-4 bg-slate-100 animate-pulse rounded" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={8} className="text-center py-12 text-slate-400 text-sm">
                  No leave balances found. Balances are created when employees apply for leave.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((b) => {
                const remaining = b.totalDays - b.usedDays - b.pendingDays;
                const usedPct = b.totalDays > 0 ? Math.round((b.usedDays / b.totalDays) * 100) : 0;
                return (
                  <TableRow key={b.id} className="hover:bg-slate-50">
                    <TableCell>
                      <div>
                        <p className="text-sm font-medium text-slate-900">{b.employee.user.name ?? "—"}</p>
                        <p className="text-xs text-slate-400">{b.employee.employeeId}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <span className="text-sm text-slate-600">{b.employee.department?.name ?? "—"}</span>
                    </TableCell>
                    <TableCell>
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-md ${LEAVE_COLORS[b.leaveType] ?? "bg-slate-100 text-slate-600"}`}>
                        {LEAVE_LABELS[b.leaveType] ?? b.leaveType}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-sm font-semibold text-slate-900">{b.totalDays}d</span>
                    </TableCell>
                    <TableCell className="text-right">
                      <span className="text-sm text-slate-700">{b.usedDays}d</span>
                      {b.usedDays > 0 && (
                        <span className="text-xs text-slate-400 ml-1">({usedPct}%)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {b.pendingDays > 0 ? (
                        <span className="text-sm text-amber-600">{b.pendingDays}d</span>
                      ) : (
                        <span className="text-sm text-slate-400">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <span className={`text-sm font-semibold ${remaining <= 0 ? "text-red-600" : remaining <= 3 ? "text-amber-600" : "text-green-600"}`}>
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
            <DialogTitle>Edit Leave Balance</DialogTitle>
          </DialogHeader>
          {editTarget && (
            <div className="space-y-4">
              <div className="bg-slate-50 rounded-lg p-3 space-y-1 text-sm">
                <p className="font-medium">{editTarget.employee.user.name}</p>
                <p className="text-slate-500">{LEAVE_LABELS[editTarget.leaveType]} · {editTarget.year}</p>
                <div className="flex gap-4 text-xs text-slate-400 pt-1">
                  <span>Used: <strong className="text-slate-700">{editTarget.usedDays}d</strong></span>
                  <span>Pending: <strong className="text-slate-700">{editTarget.pendingDays}d</strong></span>
                  <span>Current: <strong className="text-slate-700">{editTarget.totalDays}d</strong></span>
                </div>
              </div>

              <div className="space-y-2">
                <Label>New Allocated Days</Label>
                <Input
                  type="number"
                  min={0}
                  max={365}
                  value={newTotal}
                  onChange={(e) => setNewTotal(e.target.value)}
                  className="w-full"
                />
                <p className="text-xs text-slate-400">
                  Min cannot go below used ({editTarget.usedDays}d) + pending ({editTarget.pendingDays}d) = {editTarget.usedDays + editTarget.pendingDays}d
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
