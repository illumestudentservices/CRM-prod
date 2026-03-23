"use client";

import { useEffect, useState } from "react";
import { DataTable } from "@/components/shared/data-table";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { formatDate, formatDateTime } from "@/lib/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { Clock, LogIn, LogOut } from "lucide-react";

interface AttendanceRecord {
  id: string;
  date: string;
  checkIn: string | null;
  checkOut: string | null;
  hoursWorked: number | null;
  overtime: number | null;
  notes: string | null;
  employee?: { user: { name: string | null }; employeeId: string };
}

interface TodayStatus {
  checked_in: boolean;
  checked_out: boolean;
  record: AttendanceRecord | null;
}

export function AttendanceTracker({ isHR, userId }: { isHR: boolean; userId: string }) {
  const { toast } = useToast();
  const [records, setRecords] = useState<AttendanceRecord[]>([]);
  const [todayStatus, setTodayStatus] = useState<TodayStatus>({ checked_in: false, checked_out: false, record: null });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/hr/attendance");
    const data = await res.json();
    setRecords(data.records || []);
    setTodayStatus(data.todayStatus || { checked_in: false, checked_out: false, record: null });
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function checkIn() {
    setActionLoading(true);
    const res = await fetch("/api/hr/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "check_in" }),
    });
    if (res.ok) {
      toast({ title: "Checked in successfully" });
      load();
    }
    setActionLoading(false);
  }

  async function checkOut() {
    setActionLoading(true);
    const res = await fetch("/api/hr/attendance", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "check_out" }),
    });
    if (res.ok) {
      toast({ title: "Checked out successfully" });
      load();
    }
    setActionLoading(false);
  }

  const columns: ColumnDef<AttendanceRecord>[] = [
    ...(isHR ? [{
      header: "Employee",
      cell: ({ row }: { row: { original: AttendanceRecord } }) => (
        <span className="text-sm">{row.original.employee?.user.name ?? "—"}</span>
      ),
    }] : []),
    {
      header: "Date",
      cell: ({ row }) => <span className="text-sm">{formatDate(row.original.date)}</span>,
    },
    {
      header: "Check In",
      cell: ({ row }) => row.original.checkIn
        ? <span className="text-sm text-green-600">{formatDateTime(row.original.checkIn)}</span>
        : <span className="text-muted-foreground text-sm">—</span>,
    },
    {
      header: "Check Out",
      cell: ({ row }) => row.original.checkOut
        ? <span className="text-sm text-blue-600">{formatDateTime(row.original.checkOut)}</span>
        : <span className="text-muted-foreground text-sm">—</span>,
    },
    {
      header: "Hours",
      cell: ({ row }) => row.original.hoursWorked != null
        ? <Badge variant="secondary">{row.original.hoursWorked.toFixed(1)}h</Badge>
        : <span className="text-muted-foreground text-sm">—</span>,
    },
    {
      header: "Overtime",
      cell: ({ row }) => row.original.overtime != null && row.original.overtime > 0
        ? <Badge variant="warning">{row.original.overtime.toFixed(1)}h OT</Badge>
        : <span className="text-muted-foreground text-sm">—</span>,
    },
  ];

  return (
    <div className="space-y-4">
      {!isHR && (
        <div className="flex items-center gap-4 p-4 bg-muted/40 rounded-lg border">
          <Clock className="h-5 w-5 text-muted-foreground" />
          <div className="flex-1">
            <p className="text-sm font-medium">Today&apos;s Attendance</p>
            <p className="text-xs text-muted-foreground">
              {todayStatus.checked_in
                ? `Checked in at ${formatDateTime(todayStatus.record?.checkIn ?? "")}`
                : "Not checked in yet"}
            </p>
          </div>
          {!todayStatus.checked_in && (
            <Button size="sm" onClick={checkIn} disabled={actionLoading}>
              <LogIn className="h-4 w-4 mr-1" /> Check In
            </Button>
          )}
          {todayStatus.checked_in && !todayStatus.checked_out && (
            <Button size="sm" variant="outline" onClick={checkOut} disabled={actionLoading}>
              <LogOut className="h-4 w-4 mr-1" /> Check Out
            </Button>
          )}
          {todayStatus.checked_out && (
            <Badge variant="success">Checked Out</Badge>
          )}
        </div>
      )}
      <DataTable columns={columns} data={records} loading={loading} searchKey={undefined} />
    </div>
  );
}
