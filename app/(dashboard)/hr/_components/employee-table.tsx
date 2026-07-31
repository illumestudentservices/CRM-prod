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
  const [employees, setEmployees] = useState<EmployeeRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  // Accounts that exist but have no employee record, so HR cannot see them.
  const [unlinked, setUnlinked] = useState<
    { id: string; name: string | null; email: string; role: string }[]
  >([]);

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
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3.5">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-amber-900">
                {unlinked.length} account{unlinked.length === 1 ? "" : "s"} with no employee record
              </p>
              <p className="text-xs text-amber-800 mt-0.5">
                These people can sign in, but HR cannot see them — they cannot request
                leave, be assigned tasks, or appear in headcount. Accounts created in
                Settings &rarr; Users do not get an employee record; use{" "}
                <strong>Add Employee</strong> to create one.
              </p>
              <ul className="mt-2 space-y-0.5">
                {unlinked.map((u) => (
                  <li key={u.id} className="text-xs text-amber-900">
                    • {u.name ?? u.email}{" "}
                    <span className="text-amber-700">({u.email} · {u.role.replace(/_/g, " ").toLowerCase()})</span>
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

    </div>
  );
}
