"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import {
  Shield, Save, RotateCcw, Check, X, AlertTriangle, Info,
  Users, Globe, Building2, Calendar, FileText, BarChart2,
  Briefcase, Settings, Megaphone, BookOpen, ChevronDown, ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { PasswordResetSection } from "./password-reset-section";
import { MfaStatusCard } from "./mfa-status-card";
import { GranularPermissionsPanel } from "./granular-permissions-panel";

// ─── Meta ─────────────────────────────────────────────────────────────────────

const ROLES = ["SUPER_ADMIN","HQ_EXECUTIVE","HQ_ANALYTICS","REGIONAL_MANAGER","ICR","INSTITUTION_CLIENT","HR_MANAGER","EMPLOYEE"] as const;
type RoleKey = typeof ROLES[number];

const ROLE_META: Record<RoleKey, { label: string; short: string; color: string; badge: string; description: string }> = {
  SUPER_ADMIN:        { label: "Super Admin",         short: "SA",   color: "#EF4444", badge: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",       description: "Full unrestricted access to all modules" },
  HQ_EXECUTIVE:       { label: "HQ Executive",         short: "HQE",  color: "#8B5CF6", badge: "bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300", description: "Executive read & approval access" },
  HQ_ANALYTICS:       { label: "HQ Analytics",         short: "HQA",  color: "#3B82F6", badge: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300",     description: "Analytics and reporting focus" },
  REGIONAL_MANAGER:   { label: "Regional Manager",     short: "RM",   color: "#6366F1", badge: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300", description: "Manages a geographic region" },
  ICR:                { label: "ICR",                  short: "ICR",  color: "#14B8A6", badge: "bg-teal-100 text-teal-800 dark:bg-teal-500/15 dark:text-teal-300",     description: "Institutional client representative" },
  INSTITUTION_CLIENT: { label: "Institution Client",   short: "INST", color: "#F59E0B", badge: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",   description: "Partner institution user" },
  HR_MANAGER:         { label: "HR Manager",           short: "HRM",  color: "#F97316", badge: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300", description: "Manages HR and ERP functions" },
  EMPLOYEE:           { label: "Employee",             short: "EMP",  color: "#64748B", badge: "bg-slate-100 text-slate-700 dark:bg-slate-700/60 dark:text-slate-300",   description: "General staff self-service access" },
};

const RESOURCE_GROUPS = [
  {
    group: "CRM",
    resources: [
      { key: "leads",        label: "Student Leads",    icon: Users,      description: "Student pipeline & CRM records" },
      { key: "sources",      label: "Lead Sources",      icon: Globe,      description: "Lead acquisition source management" },
      { key: "institutions", label: "Institutions",      icon: Building2,  description: "Partner university relationships" },
      { key: "events",       label: "Events",            icon: Calendar,   description: "Education fairs & event management" },
      { key: "reports",      label: "Reports",           icon: FileText,   description: "Monthly performance & approval reports" },
      { key: "analytics",    label: "Analytics",         icon: BarChart2,  description: "Data insights & dashboards" },
    ],
  },
  {
    group: "HR & ERP",
    resources: [
      { key: "erp",            label: "ERP Data",        icon: Briefcase, description: "Employee attendance, leave, assets" },
      { key: "erp_hr",         label: "HR Admin",         icon: Users,     description: "HR management functions & approvals" },
      { key: "announcements",  label: "Announcements",    icon: Megaphone, description: "Company-wide communications" },
      { key: "knowledge_base", label: "Knowledge Base",   icon: BookOpen,  description: "HR policies & documentation" },
    ],
  },
  {
    group: "Administration",
    resources: [
      { key: "users",    label: "User Management", icon: Users,    description: "System users, roles & onboarding" },
      { key: "settings", label: "Settings",         icon: Settings, description: "System configuration & security" },
    ],
  },
] as const;

const ACTIONS = [
  { key: "read",    label: "View",        risk: "low"    as const, description: "Can view and search records" },
  { key: "write",   label: "Create / Edit", risk: "medium" as const, description: "Can create and modify records" },
  { key: "delete",  label: "Delete",      risk: "high"   as const, description: "Can permanently remove records" },
  { key: "approve", label: "Approve",     risk: "medium" as const, description: "Can approve and progress workflows" },
  { key: "export",  label: "Export",      risk: "medium" as const, description: "Can export data to external files" },
];

const RISK_STYLE = {
  low:    "text-emerald-600 dark:text-emerald-400",
  medium: "text-amber-600 dark:text-amber-400",
  high:   "text-red-600 dark:text-red-400",
};

type PermMatrix = Record<string, Record<string, Record<string, boolean>>>;

// ─── Toggle Cell ──────────────────────────────────────────────────────────────

function PermCell({
  granted, isOverride, isDefault, onToggle, disabled,
}: {
  granted: boolean; isOverride: boolean; isDefault: boolean; onToggle: () => void; disabled: boolean;
}) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      title={isOverride ? (isDefault ? "Restored to default" : "Overridden from default") : undefined}
      className={cn(
        "w-9 h-9 rounded-lg flex items-center justify-center transition-all duration-150 border-2",
        granted
          ? "bg-emerald-50 border-emerald-200 text-emerald-600 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:border-emerald-500/30 dark:text-emerald-300 dark:hover:bg-emerald-500/20"
          : "bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100 dark:bg-slate-800/40 dark:border-slate-700 dark:text-slate-500 dark:hover:bg-slate-800",
        isOverride && !isDefault && "ring-2 ring-amber-400 ring-offset-1",
        disabled && "opacity-50 cursor-not-allowed"
      )}
    >
      {granted
        ? <Check className="h-4 w-4" strokeWidth={2.5} />
        : <X className="h-4 w-4" />
      }
    </button>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function SecurityTab() {
  const { toast } = useToast();
  const [serverMatrix,    setServerMatrix]    = useState<PermMatrix>({});
  const [localMatrix,     setLocalMatrix]     = useState<PermMatrix>({});
  const [defaultMatrix,   setDefaultMatrix]   = useState<PermMatrix>({});
  const [loading,         setLoading]         = useState(true);
  const [saving,          setSaving]          = useState(false);
  const [hasChanges,      setHasChanges]      = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const loadPermissions = useCallback(async () => {
    setLoading(true);
    try {
      const res  = await fetch("/api/settings/permissions");
      const data = await res.json();
      setServerMatrix(data.matrix);
      setLocalMatrix(JSON.parse(JSON.stringify(data.matrix)));
      const dm: PermMatrix = JSON.parse(JSON.stringify(data.matrix));
      for (const o of data.overrides ?? []) {
        if (dm[o.role]?.[o.resource]) {
          dm[o.role][o.resource][o.action] = !o.granted;
        }
      }
      setDefaultMatrix(dm);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPermissions(); }, [loadPermissions]);

  function toggle(role: string, resource: string, action: string) {
    setLocalMatrix((prev) => {
      const updated = JSON.parse(JSON.stringify(prev)) as PermMatrix;
      if (updated[role]?.[resource]) {
        updated[role][resource][action] = !updated[role][resource][action];
      }
      return updated;
    });
    setHasChanges(true);
  }

  async function save() {
    setSaving(true);
    try {
      const overrides: Array<{ role: string; resource: string; action: string; granted: boolean }> = [];
      for (const role of ROLES) {
        for (const group of RESOURCE_GROUPS) {
          for (const res of group.resources) {
            for (const action of ACTIONS) {
              const local  = localMatrix[role]?.[res.key]?.[action.key];
              const server = serverMatrix[role]?.[res.key]?.[action.key];
              if (local !== server) {
                overrides.push({ role, resource: res.key, action: action.key, granted: local ?? false });
              }
            }
          }
        }
      }

      const res  = await fetch("/api/settings/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);

      toast({ title: `Permissions saved — ${data.saved} override${data.saved !== 1 ? "s" : ""} stored` });
      setServerMatrix(JSON.parse(JSON.stringify(localMatrix)));
      setHasChanges(false);
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  function resetAll() {
    setLocalMatrix(JSON.parse(JSON.stringify(serverMatrix)));
    setHasChanges(false);
  }

  function resetRole(role: string) {
    setLocalMatrix((prev) => {
      const updated = JSON.parse(JSON.stringify(prev)) as PermMatrix;
      updated[role] = JSON.parse(JSON.stringify(serverMatrix[role] ?? {}));
      return updated;
    });
  }

  // ── Stats ──
  const totalOverrides = (() => {
    let n = 0;
    for (const role of ROLES) {
      for (const group of RESOURCE_GROUPS) {
        for (const res of group.resources) {
          for (const action of ACTIONS) {
            const cur = localMatrix[role]?.[res.key]?.[action.key];
            const def = defaultMatrix[role]?.[res.key]?.[action.key];
            if (cur !== def) n++;
          }
        }
      }
    }
    return n;
  })();

  function privilegeScore(role: string): number {
    let granted = 0, total = 0;
    for (const group of RESOURCE_GROUPS) {
      for (const res of group.resources) {
        for (const action of ACTIONS) {
          total++;
          if (localMatrix[role]?.[res.key]?.[action.key]) granted++;
        }
      }
    }
    return total > 0 ? Math.round((granted / total) * 100) : 0;
  }

  function isOverridden(role: string, resource: string, action: string): boolean {
    return localMatrix[role]?.[resource]?.[action] !== serverMatrix[role]?.[resource]?.[action];
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
        <div className="h-96 bg-muted animate-pulse rounded-lg" />
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* ── Enforcement notice ── */}
      <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30 rounded-lg text-sm">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-300 shrink-0 mt-0.5" />
        <p className="text-amber-800 dark:text-amber-300">
          <strong>Permission changes take effect immediately.</strong>{" "}
          Overrides are saved to the database and enforced on all API routes and sidebar navigation in real time.
          Super Admin always retains full access and cannot be restricted.
        </p>
      </div>

      {/* ── Role privilege overview ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
        {ROLES.map((role) => {
          const score = privilegeScore(role);
          const meta  = ROLE_META[role];
          return (
            <div key={role} className="border rounded-lg p-2.5 space-y-1.5 text-center">
              <span className={cn("text-xs font-semibold px-1.5 py-0.5 rounded whitespace-nowrap", meta.badge)}>
                {meta.short}
              </span>
              <div className="relative h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="absolute left-0 top-0 h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${score}%`,
                    backgroundColor: score > 70 ? "#EF4444" : score > 40 ? "#F59E0B" : "#22C55E",
                  }}
                />
              </div>
              <p className="text-xs text-muted-foreground font-mono">{score}% access</p>
            </div>
          );
        })}
      </div>

      {/* ── Stats + controls ── */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <Shield className="h-4 w-4" />
          <span>
            {totalOverrides === 0
              ? "All permissions match system defaults"
              : <><strong className="text-amber-600 dark:text-amber-300">{totalOverrides}</strong> override{totalOverrides !== 1 ? "s" : ""} from defaults</>
            }
          </span>
          {hasChanges && (
            <Badge variant="outline" className="text-amber-600 border-amber-300 bg-amber-50 dark:text-amber-300 dark:border-amber-500/40 dark:bg-amber-500/10">
              Unsaved changes
            </Badge>
          )}
        </div>
        <div className="flex gap-2">
          {hasChanges && (
            <Button variant="outline" size="sm" onClick={resetAll}>
              <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Discard
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={!hasChanges || saving}>
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saving ? "Saving…" : "Save Changes"}
          </Button>
        </div>
      </div>

      {/* ── Legend ── */}
      <div className="flex items-center gap-4 text-sm text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded bg-emerald-50 border-2 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30 flex items-center justify-center"><Check className="h-3 w-3 text-emerald-600 dark:text-emerald-300" /></span>
          Granted
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded bg-slate-50 border-2 border-slate-200 dark:bg-slate-800/40 dark:border-slate-700 flex items-center justify-center"><X className="h-3 w-3 text-slate-400 dark:text-slate-500" /></span>
          Denied
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-5 h-5 rounded bg-emerald-50 border-2 border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/30 ring-2 ring-amber-400 ring-offset-1" />
          Overridden from default
        </span>
        <span className="flex items-center gap-2 ml-2">
          {["low","medium","high"].map((r) => (
            <span key={r} className={cn("font-medium capitalize", RISK_STYLE[r as keyof typeof RISK_STYLE])}>
              {r}
            </span>
          ))}
          <span>risk level</span>
        </span>
      </div>

      {/* ── Main matrix table ── */}
      {/* Single overflow:auto container so both sticky top (header) and sticky left (first col) work simultaneously */}
      <div
        className="border rounded-xl"
        style={{ overflow: "auto", maxHeight: "calc(100vh - 300px)" }}
      >
        <table className="border-collapse" style={{ minWidth: "1100px", width: "100%" }}>
          <thead>
            <tr className="bg-[#1E3A5F] text-white" style={{ position: "sticky", top: 0, zIndex: 20 }}>
              {/* Corner cell — sticky left AND top */}
              <th
                className="text-left py-4 px-4 text-sm font-semibold bg-[#1E3A5F]"
                style={{ position: "sticky", left: 0, top: 0, zIndex: 30, minWidth: "220px" }}
              >
                Resource / Permission
              </th>
              {ROLES.map((role) => {
                const meta = ROLE_META[role];
                return (
                  <th key={role} className="py-3 px-3 text-center" style={{ minWidth: "110px" }}>
                    <div className="flex flex-col items-center gap-1.5">
                      <span className={cn("text-xs font-bold px-2 py-0.5 rounded leading-tight text-center", meta.badge)}>
                        {meta.label}
                      </span>
                      <button
                        onClick={() => resetRole(role)}
                        className="text-[10px] text-white/50 hover:text-white/80 transition-colors"
                        title={`Reset ${meta.label} to server state`}
                      >
                        reset
                      </button>
                    </div>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {RESOURCE_GROUPS.map((group) => {
              const isCollapsed = collapsedGroups.has(group.group);
              return (
                <React.Fragment key={group.group}>
                  {/* Group header row */}
                  <tr
                    className="bg-slate-100 dark:bg-slate-800 cursor-pointer select-none"
                    onClick={() => setCollapsedGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.group)) next.delete(group.group);
                      else next.add(group.group);
                      return next;
                    })}
                  >
                    <td
                      colSpan={ROLES.length + 1}
                      className="py-2.5 px-4 bg-slate-100 dark:bg-slate-800"
                      style={{ position: "sticky", left: 0 }}
                    >
                      <div className="flex items-center gap-2 text-sm font-bold text-slate-600 dark:text-slate-300 uppercase tracking-wider">
                        {isCollapsed
                          ? <ChevronRight className="h-4 w-4" />
                          : <ChevronDown className="h-4 w-4" />
                        }
                        {group.group}
                        <span className="font-normal text-slate-400 dark:text-slate-500 normal-case tracking-normal">({group.resources.length} resources)</span>
                      </div>
                    </td>
                  </tr>

                  {!isCollapsed && group.resources.map((resource, rIdx) => (
                    <React.Fragment key={resource.key}>
                      {/* Resource sub-header */}
                      <tr className={cn("border-b dark:border-slate-800", rIdx % 2 === 0 ? "bg-white dark:bg-slate-900" : "bg-slate-50/60 dark:bg-slate-950/50")}>
                        <td
                          colSpan={ROLES.length + 1}
                          className={cn("py-2.5 px-4", rIdx % 2 === 0 ? "bg-white dark:bg-slate-900" : "bg-slate-50 dark:bg-slate-950/50")}
                          style={{ position: "sticky", left: 0, zIndex: 10 }}
                        >
                          <div className="flex items-center gap-2">
                            <resource.icon className="h-4 w-4 text-[#0EA5E9] shrink-0" />
                            <span className="text-sm font-semibold text-slate-700 dark:text-slate-200">{resource.label}</span>
                            <span className="text-xs text-muted-foreground hidden sm:inline">{resource.description}</span>
                          </div>
                        </td>
                      </tr>

                      {/* Action rows */}
                      {ACTIONS.map((action, aIdx) => {
                        // Striping used to be three hardcoded near-white hexes
                        // applied as an inline style. A colour computed in JS
                        // can't carry a `dark:` variant, so the whole matrix
                        // stayed white on a dark page — and because the hex
                        // never appeared inside a style={{…}} literal, no
                        // class-based scan could see it either.
                        const rowBg = rIdx % 2 === 0
                          ? (aIdx % 2 === 0
                              ? "bg-white dark:bg-slate-900"
                              : "bg-slate-50/50 dark:bg-slate-900/60")
                          : "bg-slate-50 dark:bg-slate-950/50";
                        return (
                          <tr
                            key={action.key}
                            className={cn(
                              "border-b border-slate-50 dark:border-slate-800 transition-all",
                              // brightness-95 darkens, which reads as a hover
                              // on white and as nothing on slate-900.
                              "hover:brightness-95 dark:hover:brightness-125",
                              rowBg
                            )}
                          >
                            {/* Action label — sticky left. Needs its own copy of
                                the row background or cells scroll under it. */}
                            <td
                              className={cn("py-2 pl-10 pr-4", rowBg)}
                              style={{ position: "sticky", left: 0, zIndex: 10 }}
                            >
                              <div className="flex items-center gap-2">
                                <span className="text-sm text-slate-600 dark:text-slate-300 w-24">{action.label}</span>
                                <span className={cn("text-xs font-medium", RISK_STYLE[action.risk])}>
                                  {action.risk}
                                </span>
                                <span title={action.description}>
                                  <Info className="h-3.5 w-3.5 text-slate-300 hover:text-slate-500 dark:text-slate-500 dark:hover:text-slate-300 cursor-help" />
                                </span>
                              </div>
                            </td>

                            {/* Toggle cells per role */}
                            {ROLES.map((role) => {
                              const granted    = localMatrix[role]?.[resource.key]?.[action.key] ?? false;
                              const isOverride = isOverridden(role, resource.key, action.key);
                              const isDefault  = defaultMatrix[role]?.[resource.key]?.[action.key] === granted;
                              const isLocked   = role === "SUPER_ADMIN";
                              return (
                                <td key={role} className="py-2 px-3 text-center">
                                  <PermCell
                                    granted={granted}
                                    isOverride={isOverride}
                                    isDefault={isDefault}
                                    onToggle={() => toggle(role, resource.key, action.key)}
                                    disabled={isLocked}
                                  />
                                </td>
                              );
                            })}
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  ))}
                </React.Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Granular permissions (functions + columns) ── */}
      <div className="border rounded-xl p-5 space-y-4">
        <div>
          <h3 className="text-base font-semibold text-slate-900 dark:text-slate-100">
            Function &amp; field permissions
          </h3>
          <p className="text-sm text-muted-foreground">
            Finer control than the matrix above — grant or withhold individual
            operations and individual columns per role.
          </p>
        </div>
        <GranularPermissionsPanel />
      </div>

      {/* ── Two-Factor Authentication ── */}
      <MfaStatusCard />

      {/* ── Password Reset ── */}
      <div className="border rounded-xl p-5">
        <PasswordResetSection />
      </div>

      {/* ── Role descriptions ── */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {ROLES.map((role) => {
          const meta  = ROLE_META[role];
          const score = privilegeScore(role);
          return (
            <div key={role} className="border rounded-lg p-3 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className={cn("text-sm font-semibold px-2 py-0.5 rounded", meta.badge)}>{meta.label}</span>
                <span className={cn(
                  "text-xs font-medium",
                  score > 70 ? "text-red-500" : score > 40 ? "text-amber-500" : "text-emerald-600"
                )}>
                  {score > 70 ? "High" : score > 40 ? "Medium" : "Low"} privilege
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{meta.description}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
