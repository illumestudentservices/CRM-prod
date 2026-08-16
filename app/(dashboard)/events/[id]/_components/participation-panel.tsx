"use client";

import * as React from "react";
import { Loader2, Users, CheckCircle2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/**
 * Event participation — which institution sent which consultant, whether they
 * attended, and what came of it.
 *
 * EventParticipation carries assignedICRId, status, attendanceConfirmed,
 * activitySummary, institutionOutcomeNotes and participationCost, and had no
 * user interface at all: the data could only ever be created as a bare
 * "CONFIRMED" row by editing the event's institution list. This is that
 * interface.
 *
 * Statuses mirror the API's zod enum exactly. They are duplicated here because
 * the route is server-only; drift would mean the UI offers something the API
 * rejects, which is the bug that made most event types unselectable.
 */

const STATUSES = [
  { value: "INVITED", label: "Invited" },
  { value: "CONFIRMED", label: "Confirmed" },
  { value: "DECLINED", label: "Declined" },
  { value: "ATTENDED", label: "Attended" },
  { value: "NO_SHOW", label: "No show" },
] as const;

const STATUS_VARIANT: Record<string, "secondary" | "success" | "warning" | "destructive"> = {
  INVITED: "secondary",
  CONFIRMED: "secondary",
  DECLINED: "destructive",
  ATTENDED: "success",
  NO_SHOW: "warning",
};

interface Participation {
  id: string;
  institutionId: string;
  status: string;
  attendanceConfirmed: boolean;
  activitySummary: string | null;
  institutionOutcomeNotes: string | null;
  participationCost: number | null;
  participationCostCurrency: string | null;
  institution: { id: string; name: string };
  assignedICR?: { id: string; name: string | null } | null;
  assignedICRId?: string | null;
}

export function ParticipationPanel({
  eventId,
  canWrite,
}: {
  eventId: string;
  canWrite: boolean;
}) {
  const { toast } = useToast();
  const [rows, setRows] = React.useState<Participation[] | null>(null);
  const [owners, setOwners] = React.useState<{ id: string; name: string }[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [draft, setDraft] = React.useState<Record<string, Partial<Participation>>>({});

  const load = React.useCallback(async () => {
    const res = await fetch(`/api/event-participations?eventId=${encodeURIComponent(eventId)}`);
    if (!res.ok) { setRows([]); return; }
    const d = await res.json();
    setRows(Array.isArray(d) ? d : (d.data ?? d.participations ?? []));
  }, [eventId]);

  React.useEffect(() => { load(); }, [load]);

  React.useEffect(() => {
    fetch("/api/institutions/owner-options")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = Array.isArray(d) ? d : (d?.data ?? []);
        setOwners(list.map((u: { id: string; name: string }) => ({ id: u.id, name: u.name })));
      })
      .catch(() => {});
  }, []);

  async function save(row: Participation, patch: Partial<Participation>) {
    setBusy(row.id);
    try {
      const res = await fetch(`/api/event-participations?id=${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: d.error ?? "Could not update participation", variant: "destructive" });
        return;
      }
      setDraft((x) => { const n = { ...x }; delete n[row.id]; return n; });
      await load();
    } finally {
      setBusy(null);
    }
  }

  const edit = (id: string, patch: Partial<Participation>) =>
    setDraft((x) => ({ ...x, [id]: { ...x[id], ...patch } }));

  if (rows === null) {
    return <p className="text-sm text-slate-400 dark:text-slate-500 py-6 text-center">Loading participation…</p>;
  }

  if (rows.length === 0) {
    return (
      <div className="text-center py-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg">
        <Users className="h-6 w-6 mx-auto text-slate-300 dark:text-slate-600 mb-2" />
        <p className="text-sm text-slate-500 dark:text-slate-400">No institutions are taking part yet.</p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mt-1">
          Add them to the event&apos;s institution list, then assign a consultant to each here.
        </p>
      </div>
    );
  }

  const attended = rows.filter((r) => r.status === "ATTENDED").length;
  const unassigned = rows.filter((r) => !r.assignedICRId && !r.assignedICR).length;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 flex-wrap text-xs">
        <span className="text-slate-500 dark:text-slate-400">
          {rows.length} participating · {attended} attended
        </span>
        {unassigned > 0 && (
          <span className="text-amber-600 dark:text-amber-400 font-medium">
            {unassigned} with no consultant assigned
          </span>
        )}
      </div>

      {rows.map((r) => {
        const d = draft[r.id] ?? {};
        const currentOwner = (d.assignedICRId ?? r.assignedICRId ?? "none") as string;
        const currentStatus = (d.status ?? r.status) as string;
        const dirty = Object.keys(d).length > 0;

        return (
          <div key={r.id} className="rounded-lg border border-slate-200 dark:border-slate-800 p-3.5 space-y-3">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
                    {r.institution.name}
                  </p>
                  <Badge variant={STATUS_VARIANT[currentStatus] ?? "secondary"}>
                    {STATUSES.find((s) => s.value === currentStatus)?.label ?? currentStatus}
                  </Badge>
                  {r.attendanceConfirmed && (
                    <Badge variant="success" className="gap-1">
                      <CheckCircle2 className="h-3 w-3" />Attendance confirmed
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {r.assignedICR?.name
                    ? `Consultant: ${r.assignedICR.name}`
                    : "No consultant assigned"}
                  {r.participationCost != null
                    ? ` · ${r.participationCostCurrency ?? "USD"} ${r.participationCost}`
                    : ""}
                </p>
              </div>
              {canWrite && dirty && (
                <Button
                  size="sm"
                  className="h-8 bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white gap-1.5"
                  disabled={busy === r.id}
                  onClick={() => save(r, d)}
                >
                  {busy === r.id && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save
                </Button>
              )}
            </div>

            {canWrite && (
              <>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">Consultant</Label>
                    <Select
                      value={currentOwner}
                      onValueChange={(v) => edit(r.id, { assignedICRId: v === "none" ? null : v })}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">None</SelectItem>
                        {owners.map((o) => (
                          <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Status</Label>
                    <Select
                      value={currentStatus}
                      onValueChange={(v) => edit(r.id, { status: v })}
                    >
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {STATUSES.map((s) => (
                          <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Participation cost</Label>
                    <Input
                      type="number" min="0" step="0.01" className="h-8 text-xs"
                      defaultValue={r.participationCost ?? ""}
                      placeholder="0.00"
                      onChange={(e) =>
                        edit(r.id, {
                          // Empty means "not recorded", not zero — sending 0
                          // would assert the institution paid nothing.
                          participationCost: e.target.value === "" ? null : Number(e.target.value),
                        })
                      }
                    />
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <Switch
                    id={`att-${r.id}`}
                    checked={(d.attendanceConfirmed ?? r.attendanceConfirmed) as boolean}
                    onCheckedChange={(v) => edit(r.id, { attendanceConfirmed: v })}
                  />
                  <Label htmlFor={`att-${r.id}`} className="text-xs">Attendance confirmed</Label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-xs">What they did</Label>
                    <Textarea
                      rows={2} className="text-xs"
                      defaultValue={r.activitySummary ?? ""}
                      placeholder="e.g. Ran two counselling sessions and a course talk."
                      onChange={(e) => edit(r.id, { activitySummary: e.target.value })}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-xs">Outcome for this institution</Label>
                    <Textarea
                      rows={2} className="text-xs"
                      defaultValue={r.institutionOutcomeNotes ?? ""}
                      placeholder="e.g. 14 qualified enquiries, 3 applications started."
                      onChange={(e) => edit(r.id, { institutionOutcomeNotes: e.target.value })}
                    />
                  </div>
                </div>
              </>
            )}

            {!canWrite && (r.activitySummary || r.institutionOutcomeNotes) && (
              <div className="space-y-1">
                {r.activitySummary && (
                  <p className="text-xs text-slate-600 dark:text-slate-300">{r.activitySummary}</p>
                )}
                {r.institutionOutcomeNotes && (
                  <p className="text-xs text-slate-500 dark:text-slate-400">{r.institutionOutcomeNotes}</p>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
