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
import { Pencil, ShieldOff, ShieldCheck, Trash2, Undo2, Clock } from "lucide-react";
import { ExportButton } from "@/components/shared/export-button";
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
  deletedAt?: string | null;
}

/** Mirrors RECOVERY_WINDOW_DAYS in lib/user-lifecycle.ts. */
const RECOVERY_WINDOW_DAYS = 30;

function daysLeft(deletedAt: string): number {
  return RECOVERY_WINDOW_DAYS - Math.floor((Date.now() - Date.parse(deletedAt)) / 86400000);
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const [deletedUsers, setDeletedUsers] = useState<UserRow[]>([]);
  const [restoring, setRestoring] = useState<string | null>(null);

  function load() {
    setLoading(true);
    fetch("/api/settings/users")
      .then((r) => r.json())
      .then((d) => { setUsers(d.users || []); setLoading(false); });
    // Always fetched so the bin's count is visible without switching views.
    fetch("/api/settings/users?deleted=true")
      .then((r) => r.json())
      .then((d) => setDeletedUsers(d.users || []))
      .catch(() => {});
  }

  useEffect(() => { load(); }, []);

  async function handleDelete() {
    if (!editing) return;
    setDeleting(true);
    const res = await fetch(`/api/settings/users/${editing.id}`, { method: "DELETE" });
    const data = await res.json();
    setDeleting(false);
    if (res.ok) {
      toast({
        title: "Account deleted",
        description: `${editing.name ?? editing.email} has been signed out and can be restored for ${RECOVERY_WINDOW_DAYS} days.`,
      });
      setEditing(null);
      setConfirmDelete(false);
      load();
    } else {
      toast({ title: "Could not delete", description: data.error, variant: "destructive" });
    }
  }

  async function handleRestore(u: UserRow) {
    setRestoring(u.id);
    const res = await fetch(`/api/settings/users/${u.id}`, { method: "POST" });
    const data = await res.json();
    setRestoring(null);
    if (res.ok) {
      toast({
        title: "Account restored",
        description: "Restored as inactive — switch Account Active on to give access back.",
      });
      load();
    } else {
      toast({ title: "Could not restore", description: data.error, variant: "destructive" });
    }
  }

  function openEdit(user: UserRow) {
    setEditing(user);
    setEditRole(user.role);
    setEditActive(user.isActive);
    setConfirmMfaReset(false);
    setConfirmDelete(false);
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
      header: "MFA",
      cell: ({ row }) =>
        row.original.twoFactorEnabled ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700">
            <ShieldCheck className="h-3.5 w-3.5" /> On
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-400">
            <ShieldOff className="h-3.5 w-3.5" /> Off
          </span>
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
      <div className="flex justify-end mb-3">
        <ExportButton
          data={users.map((u) => ({
            name: u.name ?? "—",
            email: u.email,
            role: u.role.replace(/_/g, " "),
            isActive: u.isActive ? "Active" : "Inactive",
            mfa: u.twoFactorEnabled ? "Enabled" : "Disabled",
            createdAt: formatDate(u.createdAt),
          }))}
          columns={[
            { key: "name", header: "Name" },
            { key: "email", header: "Email" },
            { key: "role", header: "Role" },
            { key: "isActive", header: "Status" },
            { key: "mfa", header: "MFA" },
            { key: "createdAt", header: "Joined" },
          ]}
          filename="users"
          title="Export Users"
        />
      </div>
      {deletedUsers.length > 0 && (
        <div className="mb-3">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-slate-600"
            onClick={() => setShowDeleted((v) => !v)}
          >
            <Trash2 className="h-3.5 w-3.5" />
            {showDeleted ? "Hide" : "Show"} deleted ({deletedUsers.length})
          </Button>

          {showDeleted && (
            <div className="mt-3 rounded-lg border border-slate-200 divide-y">
              {deletedUsers.map((u) => {
                const left = u.deletedAt ? daysLeft(u.deletedAt) : 0;
                return (
                  <div key={u.id} className="flex items-center justify-between gap-3 p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-slate-800">{u.name ?? u.email}</p>
                      <p className="text-xs text-muted-foreground">{u.email}</p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span
                        className={
                          "text-xs flex items-center gap-1 " +
                          (left <= 7 ? "text-red-600 font-medium" : "text-slate-500")
                        }
                      >
                        <Clock className="h-3.5 w-3.5" />
                        {left > 0
                          ? `${left} day${left === 1 ? "" : "s"} to restore`
                          : "erasure due"}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1.5"
                        disabled={restoring === u.id}
                        onClick={() => handleRestore(u)}
                      >
                        <Undo2 className="h-3.5 w-3.5" />
                        {restoring === u.id ? "Restoring…" : "Restore"}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

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
              <div className="rounded-md border border-red-200 bg-red-50 p-3 space-y-2">
                <p className="text-xs font-medium text-red-800 flex items-center gap-1.5">
                  <Trash2 className="h-3.5 w-3.5" /> Delete account
                </p>
                {confirmDelete ? (
                  <div className="space-y-2">
                    <p className="text-xs text-red-700">
                      {editing.name ?? editing.email} will be signed out immediately and
                      hidden from this list. You can restore them for{" "}
                      {RECOVERY_WINDOW_DAYS} days, after which their personal data is
                      permanently erased. Their leads, reports and audit history are kept.
                    </p>
                    <div className="flex gap-2">
                      <Button size="sm" variant="destructive" onClick={handleDelete} disabled={deleting}>
                        {deleting ? "Deleting…" : "Yes, delete account"}
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConfirmDelete(false)}>Cancel</Button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-red-700">
                      Signs them out at once. Recoverable for {RECOVERY_WINDOW_DAYS} days.
                    </p>
                    <Button
                      size="sm"
                      variant="outline"
                      className="text-red-700 border-red-300 hover:bg-red-100"
                      onClick={() => setConfirmDelete(true)}
                    >
                      Delete account
                    </Button>
                  </>
                )}
              </div>
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
