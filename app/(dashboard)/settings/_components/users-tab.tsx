"use client";

import { useEffect, useState } from "react";
import { DataTable } from "@/components/shared/data-table";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { getInitials, formatDate } from "@/lib/utils";
import { Pencil, ShieldOff } from "lucide-react";
import type { ColumnDef } from "@tanstack/react-table";

interface UserRow {
  id: string;
  name: string | null;
  email: string;
  role: string;
  isActive: boolean;
  createdAt: string;
  regionId: string | null;
  region: { name: string } | null;
  twoFactorEnabled: boolean;
}

const ROLES = [
  { value: "SUPER_ADMIN", label: "Super Admin" },
  { value: "HQ_EXECUTIVE", label: "HQ Executive" },
  { value: "HQ_ANALYTICS", label: "HQ Analytics" },
  { value: "REGIONAL_MANAGER", label: "Regional Manager" },
  { value: "ICR", label: "ICR" },
  { value: "INSTITUTION_CLIENT", label: "Institution Client" },
  { value: "HR_MANAGER", label: "HR Manager" },
  { value: "EMPLOYEE", label: "Employee" },
];

const ROLE_COLORS: Record<string, string> = {
  SUPER_ADMIN: "bg-red-100 text-red-700",
  HQ_EXECUTIVE: "bg-purple-100 text-purple-700",
  HQ_ANALYTICS: "bg-indigo-100 text-indigo-700",
  REGIONAL_MANAGER: "bg-blue-100 text-blue-700",
  ICR: "bg-teal-100 text-teal-700",
  INSTITUTION_CLIENT: "bg-amber-100 text-amber-700",
  HR_MANAGER: "bg-green-100 text-green-700",
  EMPLOYEE: "bg-gray-100 text-gray-700",
};

export function UsersSettingsTab() {
  const { toast } = useToast();
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<UserRow | null>(null);
  const [editRole, setEditRole] = useState("");
  const [editActive, setEditActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resettingMfa, setResettingMfa] = useState(false);
  const [confirmMfaReset, setConfirmMfaReset] = useState(false);

  function load() {
    setLoading(true);
    fetch("/api/settings/users")
      .then((r) => r.json())
      .then((d) => { setUsers(d.users || []); setLoading(false); });
  }

  useEffect(() => { load(); }, []);

  function openEdit(user: UserRow) {
    setEditing(user);
    setEditRole(user.role);
    setEditActive(user.isActive);
    setConfirmMfaReset(false);
  }

  async function handleResetMfa() {
    if (!editing) return;
    setResettingMfa(true);
    const res = await fetch(`/api/settings/users/${editing.id}/reset-2fa`, { method: "POST" });
    const data = await res.json();
    setResettingMfa(false);
    setConfirmMfaReset(false);
    if (res.ok) {
      toast({ title: "MFA reset", description: `Two-factor authentication has been disabled for ${editing.name ?? editing.email}.` });
      setEditing(null);
      load();
    } else {
      toast({ title: "Error", description: data.error ?? "Failed to reset MFA", variant: "destructive" });
    }
  }

  async function handleSave() {
    if (!editing) return;
    setSaving(true);
    const res = await fetch("/api/settings/users", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: editing.id, role: editRole, isActive: editActive }),
    });
    const data = await res.json();
    setSaving(false);
    if (res.ok) {
      toast({ title: "User updated" });
      setEditing(null);
      load();
    } else {
      toast({ title: "Error", description: data.error ?? "Failed to update", variant: "destructive" });
    }
  }

  const columns: ColumnDef<UserRow>[] = [
    {
      id: "user",
      header: "User",
      cell: ({ row }) => (
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="text-xs bg-[#1E3A5F] text-white">
              {getInitials(row.original.name)}
            </AvatarFallback>
          </Avatar>
          <div>
            <p className="font-medium text-sm">{row.original.name}</p>
            <p className="text-xs text-muted-foreground">{row.original.email}</p>
          </div>
        </div>
      ),
    },
    {
      header: "Role",
      cell: ({ row }) => (
        <span className={`text-xs px-2 py-1 rounded-full font-medium ${ROLE_COLORS[row.original.role] ?? "bg-gray-100 text-gray-700"}`}>
          {row.original.role.replace(/_/g, " ")}
        </span>
      ),
    },
    {
      header: "Region",
      cell: ({ row }) => <span className="text-sm">{row.original.region?.name ?? "Global"}</span>,
    },
    {
      header: "Status",
      cell: ({ row }) => (
        <Badge variant={row.original.isActive ? "success" : "secondary"}>
          {row.original.isActive ? "Active" : "Inactive"}
        </Badge>
      ),
    },
    {
      header: "Joined",
      cell: ({ row }) => <span className="text-sm text-muted-foreground">{formatDate(row.original.createdAt)}</span>,
    },
    {
      id: "actions",
      header: "",
      cell: ({ row }) => (
        <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); openEdit(row.original); }}>
          <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
        </Button>
      ),
    },
  ];

  return (
    <>
      <DataTable columns={columns} data={users} searchKey="" searchPlaceholder="Search users..." loading={loading} />

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
          </DialogHeader>
          {editing && (
            <div className="space-y-4 py-2">
              <div className="text-sm text-muted-foreground">
                <p className="font-medium text-slate-900">{editing.name}</p>
                <p>{editing.email}</p>
              </div>

              <div className="space-y-1.5">
                <Label>Role</Label>
                <Select value={editRole} onValueChange={setEditRole}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center gap-3">
                <Switch id="active" checked={editActive} onCheckedChange={setEditActive} />
                <Label htmlFor="active">Account Active</Label>
              </div>

              {editing.twoFactorEnabled && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-2">
                  <p className="text-xs font-medium text-amber-800 flex items-center gap-1.5">
                    <ShieldOff className="h-3.5 w-3.5" /> Two-factor authentication is enabled
                  </p>
                  {confirmMfaReset ? (
                    <div className="space-y-2">
                      <p className="text-xs text-amber-700">This will disable MFA and clear all backup codes. The user will need to re-enrol. Are you sure?</p>
                      <div className="flex gap-2">
                        <Button size="sm" variant="destructive" onClick={handleResetMfa} disabled={resettingMfa}>
                          {resettingMfa ? "Resetting..." : "Yes, reset MFA"}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setConfirmMfaReset(false)}>Cancel</Button>
                      </div>
                    </div>
                  ) : (
                    <Button size="sm" variant="outline" className="text-amber-700 border-amber-300 hover:bg-amber-100" onClick={() => setConfirmMfaReset(true)}>
                      Reset MFA
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? "Saving..." : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
