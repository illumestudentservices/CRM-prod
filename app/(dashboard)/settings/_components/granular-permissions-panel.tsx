"use client";

import * as React from "react";
import { Loader2, Save, RotateCcw, ShieldAlert, Lock, Eye, Pencil, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

/**
 * Capability- and field-level permission editor.
 *
 * Sits under the resource × action matrix and can only narrow it. Two ideas
 * the UI has to carry across, because getting them wrong produces permissions
 * that look set but don't apply:
 *
 *   • a capability is inert unless the role also holds its underlying action.
 *     Those rows are shown disabled with the reason, rather than as a working
 *     toggle that silently does nothing.
 *   • write implies read. Turning read off turns write off with it, because a
 *     field you can overwrite but not see is worse than either alone.
 */

interface CapabilityRow {
  key: string;
  resource: string;
  label: string;
  description: string;
  requires: string;
  default: boolean;
  granted: boolean;
  overridden: boolean;
  blockedByAction: boolean;
}

interface FieldAccess { default: boolean; granted: boolean; overridden: boolean }
interface FieldRow {
  name: string; label: string;
  sensitivity: "normal" | "personal" | "commercial";
  read: FieldAccess; write: FieldAccess;
}
interface FieldGroup { resource: string; label: string; fields: FieldRow[] }

interface RoleMatrix { capabilities: CapabilityRow[]; fields: FieldGroup[] }

interface Change {
  role: string;
  scope: "CAPABILITY" | "FIELD";
  resource: string;
  target: string;
  access?: "read" | "write";
  granted: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  HQ_EXECUTIVE: "HQ Executive",
  HQ_ANALYTICS: "HQ Analytics",
  REGIONAL_MANAGER: "Regional Manager",
  ICR: "ICR",
  INSTITUTION_CLIENT: "Institution Client",
  HR_MANAGER: "HR Manager",
  EMPLOYEE: "Employee",
  ACCOUNT_MANAGER: "Account Manager",
  ADMISSIONS_SUPPORT: "Admissions Support",
  VP_GLOBAL_SALES: "VP Global Sales",
};

const SENSITIVITY_BADGE: Record<string, string> = {
  personal: "bg-rose-100 text-rose-700 border-rose-200 dark:bg-rose-500/15 dark:text-rose-300 dark:border-rose-500/30",
  commercial: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
  normal: "bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
};

export function GranularPermissionsPanel() {
  const { toast } = useToast();
  const [roles, setRoles] = React.useState<string[]>([]);
  const [byRole, setByRole] = React.useState<Record<string, RoleMatrix>>({});
  const [activeRole, setActiveRole] = React.useState<string>("ICR");
  const [tab, setTab] = React.useState<"capabilities" | "fields">("capabilities");
  const [loading, setLoading] = React.useState(true);
  const [saving, setSaving] = React.useState(false);
  const [pending, setPending] = React.useState<Map<string, Change>>(new Map());

  const load = React.useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/settings/permissions/granular", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json();
      setRoles(body.roles ?? []);
      setByRole(body.byRole ?? {});
      setPending(new Map());
      if (!body.roles?.includes(activeRole)) setActiveRole(body.roles?.[0] ?? "ICR");
    } catch (err) {
      toast({
        title: "Couldn't load granular permissions",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
    // activeRole intentionally omitted — reloading on tab switch would discard edits
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toast]);

  React.useEffect(() => { void load(); }, [load]);

  function keyOf(c: Change) {
    return `${c.role}:${c.scope}:${c.resource}:${c.target}:${c.access ?? ""}`;
  }

  function stage(change: Change) {
    setPending((prev) => {
      const next = new Map(prev);
      next.set(keyOf(change), change);
      return next;
    });
    // Optimistically reflect it so the switch moves under the cursor.
    setByRole((prev) => {
      const copy = structuredClone(prev);
      const m = copy[change.role];
      if (!m) return prev;
      if (change.scope === "CAPABILITY") {
        const row = m.capabilities.find((c) => c.key === change.target);
        if (row) row.granted = change.granted;
      } else {
        const grp = m.fields.find((f) => f.resource === change.resource);
        const row = grp?.fields.find((f) => f.name === change.target);
        if (row && change.access) row[change.access].granted = change.granted;
      }
      return copy;
    });
  }

  function toggleField(role: string, resource: string, row: FieldRow, access: "read" | "write", value: boolean) {
    stage({ role, scope: "FIELD", resource, target: row.name, access, granted: value });
    // Write implies read: revoking read must revoke write too, otherwise the
    // role keeps a column it can overwrite but not see.
    if (access === "read" && !value && row.write.granted) {
      stage({ role, scope: "FIELD", resource, target: row.name, access: "write", granted: false });
    }
    // Granting write with read off would be inert — turn read on with it.
    if (access === "write" && value && !row.read.granted) {
      stage({ role, scope: "FIELD", resource, target: row.name, access: "read", granted: true });
    }
  }

  async function save() {
    if (pending.size === 0) return;
    setSaving(true);
    try {
      const res = await fetch("/api/settings/permissions/granular", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changes: [...pending.values()] }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        throw new Error(b?.error ?? `HTTP ${res.status}`);
      }
      toast({ title: `Saved ${pending.size} permission change(s)` });
      await load();
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  const matrix = byRole[activeRole];
  const dirty = pending.size > 0;

  return (
    <div className="space-y-4">
      <div className="rounded border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40 p-3 text-sm text-slate-600 dark:text-slate-300 flex items-start gap-2">
        <Info className="h-4 w-4 mt-0.5 shrink-0 text-slate-400" />
        <div>
          These sit <strong>underneath</strong> the resource matrix above and can only
          narrow it. A capability needs its underlying action to have any effect —
          granting <em>Merge students</em> to a role without <em>delete</em> on students
          changes nothing. Only differences from the defaults are stored.
        </div>
      </div>

      {/* Role selector */}
      <div className="flex flex-wrap items-center gap-1 border-b pb-2">
        {roles.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => setActiveRole(r)}
            className={cn(
              "text-xs px-2.5 py-1 rounded-full border transition-colors",
              activeRole === r
                // Inverting to solid white on a dark page read as a glaring
                // blob and matched nothing else in the app, which marks
                // selection with a tinted brand surface.
                ? "bg-slate-900 text-white border-slate-900 dark:bg-sky-500/15 dark:text-sky-300 dark:border-sky-500/40"
                : "bg-white text-slate-600 hover:bg-slate-50 border-slate-200 dark:bg-slate-900 dark:text-slate-300 dark:border-slate-700 dark:hover:bg-slate-800/60"
            )}
          >
            {ROLE_LABEL[r] ?? r}
          </button>
        ))}
      </div>

      {/* Sub-tabs */}
      <div className="flex items-center gap-1">
        {(["capabilities", "fields"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "text-xs px-3 py-1.5 rounded-md border transition-colors capitalize",
              tab === t
                ? "bg-slate-100 border-slate-300 font-medium dark:bg-slate-800 dark:border-slate-600"
                // slate-500 on slate-900 is ~4:1 — legible in light mode but
                // muddy on dark, so the inactive tab needs its own step up.
                : "bg-white border-slate-200 text-slate-500 dark:bg-slate-900 dark:border-slate-800 dark:text-slate-400"
            )}
          >
            {t === "capabilities" ? "Functions" : "Fields / columns"}
          </button>
        ))}
        <div className="flex-1" />
        {dirty && (
          <>
            <span className="text-xs text-amber-600 dark:text-amber-400 mr-2">
              {pending.size} unsaved change{pending.size === 1 ? "" : "s"}
            </span>
            <Button size="sm" variant="outline" onClick={() => void load()} disabled={saving} className="gap-1.5">
              <RotateCcw className="h-3.5 w-3.5" /> Discard
            </Button>
          </>
        )}
        <Button size="sm" onClick={save} disabled={!dirty || saving} className="gap-1.5">
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
          Save
        </Button>
      </div>

      {loading ? (
        <div className="py-12 text-center text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin inline mr-2" /> Loading…
        </div>
      ) : !matrix ? (
        <div className="py-12 text-center text-muted-foreground">No data for this role.</div>
      ) : tab === "capabilities" ? (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted">
              <tr>
                <th className="text-left p-2">Function</th>
                <th className="text-left p-2">Module</th>
                <th className="text-left p-2">Requires</th>
                <th className="text-center p-2 w-[110px]">Allowed</th>
              </tr>
            </thead>
            <tbody>
              {matrix.capabilities.map((c) => (
                <tr key={c.key} className="border-t hover:bg-muted/40">
                  <td className="p-2">
                    <div className="font-medium flex items-center gap-1.5">
                      {c.label}
                      {c.overridden && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                          customised
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{c.description}</div>
                    <div className="text-[10px] text-slate-400 font-mono mt-0.5">{c.key}</div>
                  </td>
                  <td className="p-2 text-xs text-muted-foreground">{c.resource}</td>
                  <td className="p-2">
                    <span className="text-[10px] font-mono px-1.5 py-0.5 rounded border bg-slate-50 dark:bg-slate-900 dark:border-slate-700">
                      {c.resource}:{c.requires}
                    </span>
                    {c.blockedByAction && (
                      <div className="text-[10px] text-red-600 dark:text-red-400 flex items-center gap-1 mt-1">
                        <Lock className="h-3 w-3" /> role lacks this action
                      </div>
                    )}
                  </td>
                  <td className="p-2 text-center">
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-slate-900 dark:accent-sky-400 disabled:opacity-40"
                      checked={c.granted}
                      disabled={c.blockedByAction}
                      title={c.blockedByAction ? "Grant the underlying action first" : undefined}
                      onChange={(e) =>
                        stage({
                          role: activeRole, scope: "CAPABILITY",
                          resource: c.resource, target: c.key, granted: e.target.checked,
                        })
                      }
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="space-y-5">
          {matrix.fields.map((grp) => (
            <div key={grp.resource}>
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
                {grp.label}
              </div>
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full text-sm">
                  <thead className="bg-muted">
                    <tr>
                      <th className="text-left p-2">Column</th>
                      <th className="text-left p-2">Sensitivity</th>
                      <th className="text-center p-2 w-[90px]">
                        <span className="inline-flex items-center gap-1"><Eye className="h-3 w-3" /> View</span>
                      </th>
                      <th className="text-center p-2 w-[90px]">
                        <span className="inline-flex items-center gap-1"><Pencil className="h-3 w-3" /> Edit</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {grp.fields.map((f) => (
                      <tr key={f.name} className="border-t hover:bg-muted/40">
                        <td className="p-2">
                          <div className="font-medium flex items-center gap-1.5">
                            {f.label}
                            {(f.read.overridden || f.write.overridden) && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300">
                                customised
                              </span>
                            )}
                          </div>
                          <div className="text-[10px] text-slate-400 font-mono">{grp.resource}.{f.name}</div>
                        </td>
                        <td className="p-2">
                          <span className={cn(
                            "inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide border",
                            SENSITIVITY_BADGE[f.sensitivity]
                          )}>
                            {f.sensitivity}
                          </span>
                        </td>
                        <td className="p-2 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-slate-900 dark:accent-sky-400"
                            checked={f.read.granted}
                            onChange={(e) => toggleField(activeRole, grp.resource, f, "read", e.target.checked)}
                          />
                        </td>
                        <td className="p-2 text-center">
                          <input
                            type="checkbox"
                            className="h-4 w-4 accent-slate-900 dark:accent-sky-400 disabled:opacity-40"
                            checked={f.write.granted}
                            disabled={!f.read.granted}
                            title={!f.read.granted ? "Grant View first — a field you can edit but not see is worse than either" : undefined}
                            onChange={(e) => toggleField(activeRole, grp.resource, f, "write", e.target.checked)}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
          <div className="rounded border border-slate-200 dark:border-slate-800 p-3 text-xs text-muted-foreground flex items-start gap-2">
            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0 text-slate-400" />
            Withheld columns are removed from API responses entirely, not blanked — a
            blank would read as &ldquo;no value on file&rdquo;. Attempts to write a
            withheld column are rejected naming the field, so nobody believes an edit
            saved when it didn&rsquo;t.
          </div>
        </div>
      )}
    </div>
  );
}
