"use client";

import { useEffect, useState, useMemo } from "react";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { CheckCircle, XCircle, UserCheck } from "lucide-react";

interface LeaveRequest {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: string;
  createdAt: string;
  employee: { user: { name: string | null }; employeeId: string };
}

const LEAVE_TYPE_LABELS: Record<string, string> = {
  ANNUAL: "Annual", SICK: "Sick", MATERNITY: "Maternity",
  PATERNITY: "Paternity", UNPAID: "Unpaid", COMP_OFF: "Comp Off",
};

const STATUS_VARIANTS: Record<string, "default" | "success" | "destructive" | "warning" | "secondary"> = {
  PENDING: "warning", APPROVED: "success", REJECTED: "destructive", CANCELLED: "secondary",
};

export function LeaveManager({ isHR, userId }: { isHR: boolean; userId: string }) {
  const { toast } = useToast();
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [approvedLeaves, setApprovedLeaves] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const url = isHR ? "/api/hr/leave?status=PENDING" : `/api/hr/leave`;
    const res = await fetch(url);
    const data = await res.json();
    setRequests(data.requests || []);
    setLoading(false);
  }

  async function loadOnLeaveToday() {
    if (!isHR) return;
    const res = await fetch("/api/hr/leave?status=APPROVED");
    const data = await res.json();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const onLeave = (data.requests || []).filter((r: LeaveRequest) => {
      const start = new Date(r.startDate);
      const end = new Date(r.endDate);
      start.setHours(0, 0, 0, 0);
      end.setHours(23, 59, 59, 999);
      return today >= start && today <= end;
    });
    setApprovedLeaves(onLeave);
  }

  useEffect(() => {
    load();
    loadOnLeaveToday();
  }, []);

  async function updateStatus(id: string, action: "APPROVED" | "REJECTED") {
    const res = await fetch(`/api/hr/leave/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = await res.json();
    if (res.ok) {
      toast({ title: `Leave ${action.toLowerCase()}`, variant: action === "APPROVED" ? "default" : "destructive" });
      load();
      loadOnLeaveToday();
    } else {
      toast({ title: "Error", description: data.error || "Failed to update leave", variant: "destructive" });
    }
  }

  const columns: ColumnDef<LeaveRequest>[] = [
    ...(isHR ? [{
      header: "Employee",
      cell: ({ row }: { row: { original: LeaveRequest } }) => (
        <div>
          <p className="font-medium text-sm">{row.original.employee.user.name}</p>
          <p className="text-xs text-muted-foreground">{row.original.employee.employeeId}</p>
        </div>
      ),
    }] : []),
    {
      header: "Type",
      cell: ({ row }) => <span className="text-sm">{LEAVE_TYPE_LABELS[row.original.leaveType] ?? row.original.leaveType}</span>,
    },
    {
      header: "Dates",
      cell: ({ row }) => (
        <span className="text-sm">
          {formatDate(row.original.startDate)} — {formatDate(row.original.endDate)}
        </span>
      ),
    },
    {
      accessorKey: "days",
      header: "Days",
      cell: ({ row }) => <span className="font-medium">{row.original.days}d</span>,
    },
    {
      header: "Reason",
      cell: ({ row }) => (
        <span className="text-sm text-muted-foreground truncate max-w-[200px] block">
          {row.original.reason || "—"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={STATUS_VARIANTS[row.original.status] ?? "secondary"}>
          {row.original.status}
        </Badge>
      ),
    },
    ...(isHR ? [{
      id: "actions",
      header: "Actions",
      cell: ({ row }: { row: { original: LeaveRequest } }) =>
        row.original.status === "PENDING" ? (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="h-7 text-green-600 border-green-300"
              onClick={() => updateStatus(row.original.id, "APPROVED")}>
              <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
            </Button>
            <Button size="sm" variant="outline" className="h-7 text-red-600 border-red-300"
              onClick={() => updateStatus(row.original.id, "REJECTED")}>
              <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
            </Button>
          </div>
        ) : null,
    }] : []),
  ];

  return (
    <div className="space-y-6">
      {/* On Leave Today banner */}
      {isHR && approvedLeaves.length > 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 mb-3">
            <UserCheck className="h-4 w-4 text-amber-600" />
            <p className="text-sm font-semibold text-amber-800">
              {approvedLeaves.length} employee{approvedLeaves.length !== 1 ? "s" : ""} on approved leave today
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {approvedLeaves.map((r) => (
              <div key={r.id} className="flex items-center gap-2 bg-white rounded-md border border-amber-200 px-3 py-1.5 text-sm">
                <span className="font-medium text-slate-800">{r.employee.user.name}</span>
                <span className="text-xs text-slate-500">·</span>
                <span className="text-xs text-amber-700">{LEAVE_TYPE_LABELS[r.leaveType] ?? r.leaveType}</span>
                <span className="text-xs text-slate-400">{formatDate(r.startDate)} – {formatDate(r.endDate)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {isHR && approvedLeaves.length === 0 && !loading && (
        <div className="flex items-center gap-2 p-3 rounded-lg bg-green-50 border border-green-200">
          <UserCheck className="h-4 w-4 text-green-600" />
          <p className="text-sm text-green-700">No employees on approved leave today.</p>
        </div>
      )}

      {/* Pending requests table */}
      <div>
        {isHR && (
          <p className="text-sm font-semibold text-slate-700 mb-3">Pending Requests</p>
        )}
        <DataTable
          columns={columns}
          data={requests}
          loading={loading}
          searchKey={undefined}
          emptyTitle={isHR ? "No pending leave requests" : "No leave requests"}
          emptyDescription={isHR ? "All requests have been reviewed." : "You haven't submitted any leave requests."}
        />
      </div>
    </div>
  );
}
