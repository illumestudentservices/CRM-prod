"use client";

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Save, RotateCcw, AlertTriangle, Info, Search, Lock, ShieldCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ALL_ROLES, ALL_RESOURCES, ALL_ACTIONS } from "@/lib/permissions";
import {
  ACTIONS, RISK_STYLE, roleMeta, resourceMeta, groupResources,
} from "./permission-meta";

/**
 * Role permissions, one role at a time.
 *
 * Replaces an 11-column × 125-row grid that rendered 1,375 custom toggle
 * buttons at once. Roles, resources and actions all come from ALL_ROLES /
 * ALL_RESOURCES / ALL_ACTIONS (derived from PERMISSION_MATRIX), never from a
 * local array — the previous screen hardcoded 8 roles and 12 resources, which
 * silently hid 895 real, enforced permissions from every administrator.
 *
 * Edits to every role are held in one draft object, so switching roles in the
 * dropdown does not discard unsaved work. Save diffs the draft against the
 * server state and sends only what changed.
 */

type PermMatrix = Record<string, Record<string, Record<string, boolean>>>;

const clone = (m: PermMatrix): PermMatrix => JSON.parse(JSON.stringify(m));

export function PermissionMatrixPanel() {
  const { toast } = useToast();
  const [serverMatrix,  setServerMatrix]  = useState<PermMatrix>({});
  const [draft,         setDraft]         = useState<PermMatrix>({});
  const [defaultMatrix, setDefaultMatrix] = useState<PermMatrix>({});
  const [loading, setLoading] = useState(true);
  const [saving,  setSaving]  = useState(false);
  const [role,    setRole]    = useState<string>(ALL_ROLES[0] ?? "SUPER_ADMIN");
  const [query,   setQuery]   = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/permissions");
      if (!res.ok) throw new Error("Failed to load permissions");
      const data = await res.json();
      setServerMatrix(data.matrix);
      setDraft(clone(data.matrix));
      // Reconstruct the code defaults by inverting each stored override, so a
      // cell can be marked as differing from the shipped matrix.
      const dm = clone(data.matrix);
      for (const o of data.overrides ?? []) {
        if (dm[o.role]?.[o.resource]) dm[o.role][o.resource][o.action] = !o.granted;
      }
      setDefaultMatrix(dm);
    } catch (e) {
      toast({
        title: e instanceof Error ? e.message : "Failed to load permissions",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const locked = role === "SUPER_ADMIN";

  // ── Draft mutation ──────────────────────────────────────────────────────
  function setCell(resource: string, action: string, granted: boolean) {
    if (locked) return;
    setDraft((prev) => {
      const next = clone(prev);
      next[role] ??= {};
      next[role][resource] ??= {};
      next[role][resource][action] = granted;
      return next;
    });
  }

  function setRow(resource: string, granted: boolean) {
    if (locked) return;
    setDraft((prev) => {
      const next = clone(prev);
      next[role] ??= {};
      next[role][resource] ??= {};
      for (const a of ALL_ACTIONS) next[role][resource][a] = granted;
      return next;
    });
  }

  function setAll(granted: boolean) {
    if (locked) return;
    setDraft((prev) => {
      const next = clone(prev);
      next[role] ??= {};
      for (const r of ALL_RESOURCES) {
        next[role][r] ??= {};
        for (const a of ALL_ACTIONS) next[role][r][a] = granted;
      }
      return next;
    });
  }

  function revertRole() {
    setDraft((prev) => {
      const next = clone(prev);
      next[role] = clone(serverMatrix)[role] ?? {};
      return next;
    });
  }

  // ── Change accounting, across ALL roles not just the visible one ────────
  const changed = useMemo(() => {
    const out: Array<{ role: string; resource: string; action: string; granted: boolean }> = [];
    for (const r of ALL_ROLES) {
      for (const res of ALL_RESOURCES) {
        for (const a of ALL_ACTIONS) {
          const d = draft[r]?.[res]?.[a] ?? false;
          const s = serverMatrix[r]?.[res]?.[a] ?? false;
          if (d !== s) out.push({ role: r, resource: res, action: a, granted: d });
        }
      }
    }
    return out;
  }, [draft, serverMatrix]);

  const changedRoles = useMemo(
    () => [...new Set(changed.map((c) => c.role))],
    [changed]
  );

  /** Cells for this role that differ from the shipped default matrix. */
  const overrideCount = useMemo(() => {
    let n = 0;
    for (const res of ALL_RESOURCES) {
      for (const a of ALL_ACTIONS) {
        if ((draft[role]?.[res]?.[a] ?? false) !== (defaultMatrix[role]?.[res]?.[a] ?? false)) n++;
      }
    }
    return n;
  }, [draft, defaultMatrix, role]);

  const grantedCount = useMemo(() => {
    let n = 0;
    for (const res of ALL_RESOURCES) {
      for (const a of ALL_ACTIONS) if (draft[role]?.[res]?.[a]) n++;
    }
    return n;
  }, [draft, role]);

  const totalCells = ALL_RESOURCES.length * ALL_ACTIONS.length;
  const privilegePct = totalCells ? Math.round((grantedCount / totalCells) * 100) : 0;

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/settings/permissions", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overrides: changed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Save failed");
      toast({
        title: `Permissions saved — ${data.saved} override${data.saved === 1 ? "" : "s"} stored${
          data.restored ? `, ${data.restored} restored to default` : ""
        }`,
      });
      setServerMatrix(clone(draft));
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : "Save failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  // ── Visible resources, filtered ─────────────────────────────────────────
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = q
      ? ALL_RESOURCES.filter((r) => {
          const m = resourceMeta(r);
          return (
            m.label.toLowerCase().includes(q) ||
            r.toLowerCase().includes(q) ||
            m.description.toLowerCase().includes(q)
          );
        })
      : [...ALL_RESOURCES];
    return groupResources(visible);
  }, [query]);

  const visibleCount = groups.reduce((n, g) => n + g.resources.length, 0);

  if (loading) {
    return (
      <div className="space-y-3">
        <div className="h-10 w-72 bg-muted animate-pulse rounded-lg" />
        <div className="h-96 bg-muted animate-pulse rounded-xl" />
      </div>
    );
  }

  const meta = roleMeta(role);

  return (
    <div className="space-y-4">
      {/* ── Enforcement notice ── */}
      <div className="flex items-start gap-3 p-3 bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30 rounded-lg text-sm">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-300 shrink-0 mt-0.5" />
        <p className="text-amber-800 dark:text-amber-300">
          <strong>Permission changes take effect immediately.</strong>{" "}
          Overrides are saved to the database and enforced on all API routes and
          sidebar navigation in real time. Super Admin always retains full access
          and cannot be restricted.
        </p>
      </div>

      {/* ── Role picker + actions ── */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Role
          </label>
          <div className="flex items-center gap-2">
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger className="w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ALL_ROLES.map((r) => {
                  const rm = roleMeta(r);
                  const dirty = changedRoles.includes(r);
                  return (
                    <SelectItem key={r} value={r}>
                      <span className="flex items-center gap-2">
                        {rm.label}
                        {dirty && (
                          <span className="h-1.5 w-1.5 rounded-full bg-amber-500" title="Unsaved changes" />
                        )}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <Badge variant="secondary" className={cn("shrink-0", meta.badge)}>
              {meta.short}
            </Badge>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Filter resources…"
              className="pl-8 w-[200px] h-9"
            />
          </div>
          <Button variant="outline" size="sm" onClick={() => setAll(true)} disabled={locked}>
            Select all
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAll(false)} disabled={locked}>
            Clear all
          </Button>
          <Button variant="outline" size="sm" onClick={revertRole} disabled={!changedRoles.includes(role)}>
            <RotateCcw className="h-3.5 w-3.5 mr-1.5" /> Revert role
          </Button>
          <Button size="sm" onClick={save} disabled={changed.length === 0 || saving}>
            <Save className="h-3.5 w-3.5 mr-1.5" />
            {saving ? "Saving…" : `Save${changed.length ? ` (${changed.length})` : ""}`}
          </Button>
        </div>
      </div>

      {/* ── Selected-role summary ── */}
      <div className="flex items-center gap-4 flex-wrap text-sm">
        <span className="text-muted-foreground">{meta.description}</span>
        <span className="text-muted-foreground">·</span>
        <span>
          <strong>{grantedCount}</strong>
          <span className="text-muted-foreground"> / {totalCells} granted ({privilegePct}%)</span>
        </span>
        {overrideCount > 0 && (
          <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-500/40 dark:text-amber-300">
            {overrideCount} differ{overrideCount === 1 ? "s" : ""} from default
          </Badge>
        )}
        {locked && (
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Lock className="h-3.5 w-3.5" /> Super Admin cannot be restricted
          </span>
        )}
      </div>

      {/* ── Checkbox grid: 25 resources × 5 actions for the selected role ── */}
      <div className="border rounded-xl overflow-hidden">
        {/* Column headers */}
        <div className="hidden md:flex items-center gap-4 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 border-b dark:border-slate-700">
          <div className="flex-1 text-xs font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">
            Resource
          </div>
          {ACTIONS.map((a) => (
            <div key={a.key} className="w-24 text-center">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-200">{a.label}</div>
              <div className={cn("text-[10px] font-medium", RISK_STYLE[a.risk])}>{a.risk} risk</div>
            </div>
          ))}
          <div className="w-16 text-center text-[10px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">
            All
          </div>
        </div>

        {visibleCount === 0 && (
          <p className="px-4 py-8 text-sm text-center text-muted-foreground">
            No resources match “{query}”.
          </p>
        )}

        {groups.map((group) => (
          <div key={group.group}>
            <div className="px-4 py-2 bg-slate-50 dark:bg-slate-900/70 border-b dark:border-slate-800">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                {group.group}
              </span>
              <span className="ml-2 text-xs text-slate-400 dark:text-slate-500">
                {group.resources.length} resource{group.resources.length === 1 ? "" : "s"}
              </span>
            </div>

            {group.resources.map((res) => {
              const rm = resourceMeta(res);
              const rowAll = ALL_ACTIONS.every((a) => draft[role]?.[res]?.[a]);
              return (
                <div
                  key={res}
                  className="flex flex-col md:flex-row md:items-center gap-2 md:gap-4 px-4 py-2.5 border-b last:border-b-0 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-900/50 transition-colors"
                >
                  {/* Resource label */}
                  <div className="flex-1 flex items-center gap-2 min-w-0">
                    <rm.icon className="h-4 w-4 text-[#0EA5E9] shrink-0" />
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">
                      {rm.label}
                    </span>
                    <span title={rm.description}>
                      <Info className="h-3.5 w-3.5 text-slate-300 hover:text-slate-500 dark:text-slate-600 dark:hover:text-slate-400 cursor-help shrink-0" />
                    </span>
                  </div>

                  {/* Action checkboxes */}
                  {ACTIONS.map((a) => {
                    const granted = draft[role]?.[res]?.[a.key] ?? false;
                    const isDefault = (defaultMatrix[role]?.[res]?.[a.key] ?? false) === granted;
                    return (
                      <div key={a.key} className="w-24 flex md:justify-center items-center gap-2">
                        <Checkbox
                          checked={granted}
                          disabled={locked}
                          onCheckedChange={(v) => setCell(res, a.key, v === true)}
                          aria-label={`${a.label} ${rm.label} for ${meta.label}`}
                          className={cn(
                            !isDefault && "ring-2 ring-amber-400 ring-offset-1 dark:ring-offset-slate-900"
                          )}
                        />
                        <span className="md:hidden text-xs text-muted-foreground">{a.label}</span>
                      </div>
                    );
                  })}

                  {/* Whole-row toggle */}
                  <div className="w-16 flex md:justify-center">
                    <button
                      onClick={() => setRow(res, !rowAll)}
                      disabled={locked}
                      className={cn(
                        "text-xs font-medium transition-colors",
                        locked
                          ? "text-slate-300 dark:text-slate-600 cursor-not-allowed"
                          : "text-[#0EA5E9] hover:underline"
                      )}
                    >
                      {rowAll ? "none" : "all"}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>

      {/* ── Legend ── */}
      <div className="flex items-center gap-5 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="h-4 w-4 rounded border-2 ring-2 ring-amber-400 ring-offset-1 dark:ring-offset-slate-900 inline-block" />
          Differs from the shipped default
        </span>
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5" />
          {ALL_ROLES.length} roles · {ALL_RESOURCES.length} resources · {ALL_ACTIONS.length} actions
          {" = "}
          {ALL_ROLES.length * totalCells} permissions
        </span>
      </div>
    </div>
  );
}
