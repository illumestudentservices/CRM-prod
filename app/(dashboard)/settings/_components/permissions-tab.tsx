"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Shield, RotateCcw, Save } from "lucide-react";

// ─── Constants ────────────────────────────────────────────────────────────────

const ROLES = [
  { value: "SUPER_ADMIN",       label: "Super Admin",       color: "bg-red-100 text-red-700" },
  { value: "HQ_EXECUTIVE",      label: "HQ Executive",      color: "bg-purple-100 text-purple-700" },
  { value: "HQ_ANALYTICS",      label: "HQ Analytics",      color: "bg-indigo-100 text-indigo-700" },
  { value: "REGIONAL_MANAGER",  label: "Regional Manager",  color: "bg-blue-100 text-blue-700" },
  { value: "ICR",               label: "ICR",               color: "bg-teal-100 text-teal-700" },
  { value: "INSTITUTION_CLIENT",label: "Institution Client", color: "bg-amber-100 text-amber-700" },
  { value: "HR_MANAGER",        label: "HR Manager",        color: "bg-green-100 text-green-700" },
  { value: "EMPLOYEE",          label: "Employee",          color: "bg-gray-100 text-gray-700" },
] as const;

type RoleValue = (typeof ROLES)[number]["value"];

const RESOURCE_GROUPS: { label: string; resources: { key: string; label: string }[] }[] = [
  {
    label: "Dashboard",
    resources: [
      { key: "executive_dashboard", label: "Executive Dashboard" },
    ],
  },
  {
    label: "CRM",
    resources: [
      { key: "leads",        label: "Student Leads" },
      { key: "sources",      label: "Lead Sources" },
      { key: "institutions", label: "Institutions / ERM" },
      { key: "events",       label: "Events" },
      { key: "reports",      label: "Monthly Reports" },
      { key: "analytics",    label: "Analytics" },
    ],
  },
  {
    label: "HR & ERP",
    resources: [
      { key: "erp",    label: "HR & ERP (self-service)" },
      { key: "erp_hr", label: "HR Management" },
    ],
  },
  {
    label: "Administration",
    resources: [
      { key: "users",          label: "User Management" },
      { key: "settings",       label: "System Settings" },
      { key: "announcements",  label: "Announcements" },
      { key: "knowledge_base", label: "Knowledge Base" },
    ],
  },
];

const ACTIONS = ["read", "write", "delete", "approve", "export"] as const;
type ActionValue = (typeof ACTIONS)[number];

const ACTION_COLORS: Record<ActionValue, string> = {
  read:    "bg-blue-100 text-blue-700 border-blue-200",
  write:   "bg-emerald-100 text-emerald-700 border-emerald-200",
  delete:  "bg-red-100 text-red-700 border-red-200",
  approve: "bg-amber-100 text-amber-700 border-amber-200",
  export:  "bg-violet-100 text-violet-700 border-violet-200",
};

type PermMatrix = Record<string, Record<string, Record<string, boolean>>>;

// ─── Component ────────────────────────────────────────────────────────────────

export function PermissionsTab() {
  const { toast } = useToast();
  const [matrix, setMatrix] = useState<PermMatrix>({});
  const [original, setOriginal] = useState<PermMatrix>({});
  const [selectedRole, setSelectedRole] = useState<RoleValue>("ICR");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/permissions");
      const data = await res.json();
      setMatrix(JSON.parse(JSON.stringify(data.matrix)));
      setOriginal(JSON.parse(JSON.stringify(data.matrix)));
      setDirty(false);
    } catch {
      toast({ title: "Error", description: "Failed to load permissions", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function toggle(role: string, resource: string, action: string) {
    setMatrix((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as PermMatrix;
      if (!next[role]) next[role] = {};
      if (!next[role][resource]) next[role][resource] = {};
      next[role][resource][action] = !next[role][resource][action];
      return next;
    });
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    // Build flat overrides list from the current matrix
    const overrides: Array<{ role: string; resource: string; action: string; granted: boolean }> = [];
    for (const [role, resources] of Object.entries(matrix)) {
      for (const [resource, actions] of Object.entries(resources)) {
        for (const [action, granted] of Object.entries(actions)) {
          overrides.push({ role, resource, action, granted: granted as boolean });
        }
      }
    }
    try {
      const res = await fetch("/api/settings/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Permissions saved", description: `${data.saved} override(s) stored.` });
        setOriginal(JSON.parse(JSON.stringify(matrix)));
        setDirty(false);
      } else {
        toast({ title: "Error", description: data.error ?? "Failed to save", variant: "destructive" });
      }
    } catch {
      toast({ title: "Error", description: "Network error", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function resetRole() {
    setMatrix((prev) => {
      const next = JSON.parse(JSON.stringify(prev)) as PermMatrix;
      next[selectedRole] = JSON.parse(JSON.stringify(original[selectedRole] ?? {}));
      return next;
    });
    setDirty(false);
  }

  const roleData = ROLES.find((r) => r.value === selectedRole);
  const roleMatrix = matrix[selectedRole] ?? {};

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-slate-400 text-sm">
        Loading permissions…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-[#1E3A5F]" />
          <div>
            <p className="text-sm font-semibold text-slate-900">Permission Matrix</p>
            <p className="text-xs text-slate-500">
              Override default permissions per role. Changes apply immediately on next login.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          {dirty && (
            <Button variant="outline" size="sm" onClick={resetRole} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" /> Reset role
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={saving || !dirty} className="gap-1.5 bg-[#1E3A5F] hover:bg-[#1E3A5F]/90">
            <Save className="h-3.5 w-3.5" />
            {saving ? "Saving…" : "Save changes"}
          </Button>
        </div>
      </div>

      {/* Role selector */}
      <div className="flex flex-wrap gap-2">
        {ROLES.map((r) => {
          const isSelected = r.value === selectedRole;
          // Count how many overrides this role has vs original
          const roleHasChanges = Object.entries(matrix[r.value] ?? {}).some(([res, actions]) =>
            Object.entries(actions).some(([act, val]) => val !== original[r.value]?.[res]?.[act])
          );
          return (
            <button
              key={r.value}
              onClick={() => setSelectedRole(r.value as RoleValue)}
              className={cn(
                "flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition-all",
                isSelected
                  ? "border-[#1E3A5F] bg-[#1E3A5F] text-white shadow-sm"
                  : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50"
              )}
            >
              {r.label}
              {roleHasChanges && !isSelected && (
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
              )}
            </button>
          );
        })}
      </div>

      {/* Action legend */}
      <div className="flex flex-wrap gap-2 items-center">
        <span className="text-xs text-slate-400 mr-1">Actions:</span>
        {ACTIONS.map((a) => (
          <span key={a} className={cn("px-2 py-0.5 rounded-md text-xs font-medium border", ACTION_COLORS[a])}>
            {a}
          </span>
        ))}
      </div>

      {/* Resource groups */}
      <div className="space-y-4">
        {RESOURCE_GROUPS.map((group) => (
          <Card key={group.label}>
            <CardHeader className="pb-2 pt-4 px-5">
              <CardTitle className="text-sm font-semibold text-slate-700">{group.label}</CardTitle>
            </CardHeader>
            <CardContent className="px-5 pb-4 space-y-3">
              {group.resources.map((res) => {
                const actions = roleMatrix[res.key] ?? {};
                const origActions = original[selectedRole]?.[res.key] ?? {};
                const anyGranted = ACTIONS.some((a) => actions[a]);
                const hasChanges = ACTIONS.some((a) => actions[a] !== origActions[a]);

                return (
                  <div
                    key={res.key}
                    className={cn(
                      "flex items-center gap-4 py-3 px-3 rounded-lg border transition-colors",
                      hasChanges ? "border-amber-200 bg-amber-50/50" : "border-transparent hover:bg-slate-50"
                    )}
                  >
                    {/* Resource name */}
                    <div className="w-44 shrink-0">
                      <p className="text-sm font-medium text-slate-900">{res.label}</p>
                      {!anyGranted && (
                        <p className="text-xs text-slate-400">No access</p>
                      )}
                    </div>

                    {/* Action toggles */}
                    <div className="flex flex-wrap gap-2">
                      {ACTIONS.map((action) => {
                        const granted = !!actions[action];
                        const changed = granted !== !!origActions[action];
                        return (
                          <button
                            key={action}
                            onClick={() => toggle(selectedRole, res.key, action)}
                            className={cn(
                              "px-2.5 py-0.5 rounded-md text-xs font-medium border transition-all",
                              granted
                                ? cn(ACTION_COLORS[action], "opacity-100")
                                : "bg-white text-slate-400 border-slate-200 hover:border-slate-300",
                              changed && "ring-1 ring-amber-400 ring-offset-1"
                            )}
                          >
                            {action}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
