"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { EmployeeForm } from "./employee-form";
import { getInitials } from "@/lib/utils";
import type { ColumnDef } from "@tanstack/react-table";
import { Plus, AlertTriangle } from "lucide-react";
import { ExportButton } from "@/components/shared/export-button";
import { useToast } from "@/hooks/use-toast";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

const EMPLOYEE_EXPORT_COLUMNS = [
  { key: "name",           header: "Full Name" },
  { key: "email",          header: "Email" },
  { key: "employeeId",     header: "Employee ID" },
  { key: "department",     header: "Department" },
  { key: "jobTitle",       header: "Job Title" },
  { key: "employmentType", header: "Employment Type" },
  { key: "manager",        header: "Manager" },
  { key: "status",         header: "Status" },
];

interface EmployeeRow {
  id: string;
  employeeId: string;
  jobTitle: string;
  employmentType: string;
  isActive: boolean;
  user: { name: string | null; email: string; image: string | null };
  department: { name: string } | null;
  manager: { user: { name: string | null } } | null;
}

export function EmployeeTable({ isHR, isSuperAdmin }: { isHR: boolean; isSuperAdmin: boolean }) {
  const router = useRouter();
  const { toast } = useToast();
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  // Accounts that exist but have no employee record, so HR cannot see them.
  const [unlinked, setUnlinked] = useState<
    { id: string; name: string | null; email: string; role: string }[]
  >([]);
  const [linking, setLinking] = useState<{ id: string; name: string | null; email: string } | null>(null);
  const [linkForm, setLinkForm] = useState({ jobTitle: "", startDate: "", employmentType: "FULL_TIME", gender: "none" });
  const [linkSaving, setLinkSaving] = useState(false);
  const [flagging, setFlagging] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const res = await fetch("/api/hr/employees");
    const data = await res.json();
    setEmployees(data.employees || []);
    setLoading(false);
    fetch("/api/hr/unlinked-users")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setUnlinked(d?.users ?? []))
      .catch(() => {});
  }

  useEffect(() => { load(); }, []);

  async function createEmployeeRecord() {
    if (!linking) return;
    setLinkSaving(true);
    const res = await fetch("/api/hr/unlinked-users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: linking.id,
        jobTitle: linkForm.jobTitle,
        startDate: new Date(`${linkForm.startDate}T00:00:00.000Z`).toISOString(),
        employmentType: linkForm.employmentType,
        gender: linkForm.gender === "none" ? null : linkForm.gender,
      }),
    });
    const data = await res.json();
    setLinkSaving(false);
    if (res.ok) {
      toast({ title: "Employee record created", description: `${linking.name ?? linking.email} now appears in HR.` });
      setLinking(null);
      setLinkForm({ jobTitle: "", startDate: "", employmentType: "FULL_TIME", gender: "none" });
      load();
    } else {
      toast({ title: "Could not create", description: data.error, variant: "destructive" });
    }
  }

  async function markServiceAccount(userId: string) {
    setFlagging(userId);
    const res = await fetch("/api/hr/unlinked-users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId, isServiceAccount: true }),
    });
    const data = await res.json();
    setFlagging(null);
    if (res.ok) {
      toast({ title: "Marked as a service account", description: "It will no longer be listed as missing an employee record." });
      load();
    } else {
      toast({ title: "Could not update", description: data.error, variant: "destructive" });
    }
  }

  const columns: ColumnDef<EmployeeRow>[] = [
    {
      id: "employee",
      header: "Employee",
      cell: ({ row }) => {
        const e = row.original;
        return (
          <div className="flex items-center gap-3">
            <Avatar className="h-8 w-8">
              <AvatarImage src={e.user.image ?? undefined} />
              <AvatarFallback className="text-xs bg-[#1E3A5F] text-white">
                {getInitials(e.user.name)}
              </AvatarFallback>
            </Avatar>
            <div>
              <p className="font-medium text-sm">{e.user.name}</p>
              <p className="text-xs text-muted-foreground">{e.user.email}</p>
            </div>
          </div>
        );
      },
    },
    { accessorKey: "employeeId", header: "ID" },
    {
      header: "Department",
      cell: ({ row }) => row.original.department?.name ?? "—",
    },
    { accessorKey: "jobTitle", header: "Job Title" },
    {
      header: "Type",
      cell: ({ row }) => {
        const labels: Record<string, string> = {
          FULL_TIME: "Full-time",
          PART_TIME: "Part-time",
          CONTRACT: "Contract",
          INTERN: "Intern",
        };
        return <span className="text-sm">{labels[row.original.employmentType] ?? row.original.employmentType}</span>;
      },
    },
    {
      header: "Manager",
      cell: ({ row }) => row.original.manager?.user.name ?? "—",
    },
    {
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? "success" : "secondary"}>
          {row.original.isActive ? "Active" : "Inactive"}
        </Badge>
      ),
    },
  ];

  const exportData = employees.map((e) => ({
    name:           e.user.name ?? "",
    email:          e.user.email,
    employeeId:     e.employeeId,
    department:     e.department?.name ?? "",
    jobTitle:       e.jobTitle,
    employmentType: e.employmentType.replace(/_/g, " "),
    manager:        e.manager?.user.name ?? "",
    status:         e.isActive ? "Active" : "Inactive",
  }));

  return (
    <div className="space-y-4">
      {unlinked.length > 0 && isHR && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-500/10 dark:border-amber-500/30 p-3.5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-300 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
                {unlinked.length} account{unlinked.length === 1 ? "" : "s"} with no employee record
              </p>
              <p className="text-xs text-amber-800 dark:text-amber-300 mt-0.5">
                These people can sign in, but HR cannot see them — they cannot request
                leave, be assigned tasks, or appear in headcount. Accounts created in
                Settings &rarr; Users do not get an employee record.
              </p>
              <ul className="mt-2 space-y-1.5">
                {unlinked.map((u) => (
                  <li key={u.id} className="flex items-center justify-between gap-3 flex-wrap">
                    <span className="text-xs text-amber-900 dark:text-amber-200 min-w-0">
                      {u.name ?? u.email}{" "}
                      <span className="text-amber-700 dark:text-amber-400">
                        ({u.email} · {u.role.replace(/_/g, " ").toLowerCase()})
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5 shrink-0">
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs border-amber-300 text-amber-900 hover:bg-amber-100 dark:border-amber-500/40 dark:text-amber-200 dark:hover:bg-amber-500/20"
                        onClick={() => setLinking(u)}
                      >
                        Create employee record
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/20"
                        disabled={flagging === u.id}
                        title="For break-glass or integration logins that are not people"
                        onClick={() => markServiceAccount(u.id)}
                      >
                        {flagging === u.id ? "Saving…" : "Not a person"}
                      </Button>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}

      <div className="flex justify-end gap-2">
        <ExportButton
          data={exportData}
          columns={EMPLOYEE_EXPORT_COLUMNS}
          filename="employees"
          title="Employee Directory"
        />
        {isHR && (
          <Button onClick={() => setShowForm(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" /> Add Employee
          </Button>
        )}
      </div>
      <DataTable
        columns={columns}
        data={employees}
        searchKey="employeeId"
        loading={loading}
        onRowClick={(row) => router.push(`/hr/employees/${row.id}`)}
      />
      {showForm && (
        <EmployeeForm
          open={showForm}
          onClose={() => setShowForm(false)}
          onSuccess={() => { setShowForm(false); load(); }}
        />
      )}

      {/* Gives an EXISTING account an employee record. Add Employee cannot do
          this — it creates a new user and refuses an email already in use. */}
      <Dialog open={!!linking} onOpenChange={(o) => { if (!o) setLinking(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create employee record</DialogTitle>
          </DialogHeader>
          {linking && (
            <div className="space-y-4 py-1">
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-slate-900 dark:text-slate-100">{linking.name ?? linking.email}</p>
                <p className="text-xs">{linking.email}</p>
              </div>

              <div className="space-y-1.5">
                <Label>Job title *</Label>
                <Input
                  value={linkForm.jobTitle}
                  onChange={(e) => setLinkForm((f) => ({ ...f, jobTitle: e.target.value }))}
                  placeholder="e.g. Chief Operating Officer"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Start date *</Label>
                  <Input
                    type="date"
                    value={linkForm.startDate}
                    onChange={(e) => setLinkForm((f) => ({ ...f, startDate: e.target.value }))}
                  />
                  <p className="text-xs text-slate-400 dark:text-slate-500">
                    Leave entitlement is calculated from this.
                  </p>
                </div>
                <div className="space-y-1.5">
                  <Label>Employment type</Label>
                  <Select
                    value={linkForm.employmentType}
                    onValueChange={(v) => setLinkForm((f) => ({ ...f, employmentType: v }))}
                  >
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="FULL_TIME">Full-time</SelectItem>
                      <SelectItem value="PART_TIME">Part-time</SelectItem>
                      <SelectItem value="CONTRACT">Contract</SelectItem>
                      <SelectItem value="INTERN">Intern</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Gender</Label>
                <Select
                  value={linkForm.gender}
                  onValueChange={(v) => setLinkForm((f) => ({ ...f, gender: v }))}
                >
                  <SelectTrigger><SelectValue placeholder="Not recorded" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not recorded</SelectItem>
                    <SelectItem value="FEMALE">Female</SelectItem>
                    <SelectItem value="MALE">Male</SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-slate-400">
                  Maternity and paternity leave stay blocked until this is set.
                </p>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setLinking(null)}>Cancel</Button>
            <Button
              disabled={linkSaving || linkForm.jobTitle.trim().length < 2 || !linkForm.startDate}
              onClick={createEmployeeRecord}
            >
              {linkSaving ? "Creating…" : "Create record"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
