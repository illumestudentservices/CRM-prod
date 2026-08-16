"use client";

import * as React from "react";
import { useRouter } from "next/navigation";

/**
 * Data entry for a quarterly plan.
 *
 * PlannedTravel and PlannedFieldActivity were both displayed on the plan and
 * both wired into activation — approving a plan turns planned travel into real
 * TravelRequests and planned activities into stub Field Operations — but
 * neither could be CREATED. The quarterly planning module was built to replace
 * five spreadsheets and could not replace any of them, because its core data
 * had no way in. These are those forms.
 *
 * Both refuse to render an editor once the plan is approved: from that point
 * the plan is the agreed commitment and changes go through a Variation Request,
 * which is what makes the change itself reviewable.
 */

/** Mirrors PLANNED_ACTIVITY_TYPES in the API route. Keep the two in step. */
const PLANNED_ACTIVITY_TYPES = [
  { value: "SCHOOL_VISIT", label: "School visit" },
  { value: "AGENT_MEETING", label: "Agent meeting" },
  { value: "COUNSELLOR_TRAINING", label: "Counsellor training" },
  { value: "STUDENT_PRESENTATION", label: "Student presentation" },
  { value: "WEBINAR", label: "Webinar" },
  { value: "CLIENT_MEETING", label: "Client meeting" },
  { value: "OTHER", label: "Other" },
] as const;

const LOCKED_STATUSES = ["APPROVED", "ACTIVE", "COMPLETED", "CLOSED"];

export function isPlanLocked(status: string): boolean {
  return LOCKED_STATUSES.includes(status);
}

const inputCls = "border rounded px-2 py-1 text-sm bg-transparent";
const primaryCls =
  "text-sm rounded-md bg-[#1E3A5F] text-white px-3 py-1.5 disabled:opacity-50";
const secondaryCls =
  "text-sm rounded-md border px-3 py-1.5 hover:bg-slate-50 dark:hover:bg-slate-800";

export function AddPlannedTravel({ planId, status }: { planId: string; status: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [f, setF] = React.useState({
    destination: "", country: "", city: "",
    plannedStart: "", plannedEnd: "", purpose: "", estimatedCost: "",
  });

  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const valid =
    !!f.destination.trim() && !!f.country.trim() &&
    !!f.plannedStart && !!f.plannedEnd && !!f.purpose.trim();

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const resp = await fetch(`/api/recruitment-planning/plans/${planId}/planned-travel`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          destination: f.destination.trim(),
          country: f.country.trim(),
          city: f.city.trim() || null,
          plannedStart: new Date(`${f.plannedStart}T00:00:00.000Z`).toISOString(),
          plannedEnd: new Date(`${f.plannedEnd}T00:00:00.000Z`).toISOString(),
          purpose: f.purpose.trim(),
          // Empty means "not estimated", not zero — sending 0 would assert the
          // trip is expected to cost nothing.
          estimatedCost: f.estimatedCost === "" ? null : Number(f.estimatedCost),
        }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        setError(j?.error ?? `HTTP ${resp.status}`);
        return;
      }
      setOpen(false);
      setF({ destination: "", country: "", city: "", plannedStart: "", plannedEnd: "", purpose: "", estimatedCost: "" });
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (isPlanLocked(status)) {
    return (
      <p className="text-xs text-muted-foreground">
        Approved — raise a Variation Request to change planned travel.
      </p>
    );
  }

  if (!open) {
    return (
      <button type="button" id="pt-open" onClick={() => setOpen(true)} className={secondaryCls}>
        Add planned travel
      </button>
    );
  }

  return (
    <div className="border rounded-lg p-3 space-y-2 mb-3">
      <div className="grid grid-cols-2 gap-2">
        <input id="pt-destination" className={inputCls} placeholder="Destination *"
          value={f.destination} onChange={(e) => set("destination", e.target.value)} />
        <input id="pt-country" className={inputCls} placeholder="Country *"
          value={f.country} onChange={(e) => set("country", e.target.value)} />
        <input id="pt-city" className={inputCls} placeholder="City"
          value={f.city} onChange={(e) => set("city", e.target.value)} />
        <input id="pt-cost" type="number" min="0" step="0.01" className={inputCls}
          placeholder="Estimated cost" value={f.estimatedCost}
          onChange={(e) => set("estimatedCost", e.target.value)} />
        <input id="pt-start" type="date" className={inputCls}
          value={f.plannedStart} onChange={(e) => set("plannedStart", e.target.value)} />
        <input id="pt-end" type="date" className={inputCls}
          value={f.plannedEnd} onChange={(e) => set("plannedEnd", e.target.value)} />
      </div>
      <textarea id="pt-purpose" rows={2} className={`w-full ${inputCls}`} placeholder="Purpose *"
        value={f.purpose} onChange={(e) => set("purpose", e.target.value)} />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button type="button" id="pt-save" disabled={!valid || saving} onClick={submit} className={primaryCls}>
          {saving ? "Saving…" : "Save travel"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={secondaryCls}>Cancel</button>
      </div>
    </div>
  );
}

export function AddPlannedActivity({ planId, status }: { planId: string; status: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [activityType, setActivityType] = React.useState("SCHOOL_VISIT");
  const [plannedCount, setPlannedCount] = React.useState("");
  const [notes, setNotes] = React.useState("");

  const valid = Number(plannedCount) > 0;

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const resp = await fetch(`/api/recruitment-planning/plans/${planId}/planned-activities`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activityType,
          plannedCount: Number(plannedCount),
          notes: notes.trim() || null,
        }),
      });
      if (!resp.ok) {
        const j = await resp.json().catch(() => ({}));
        setError(j?.error ?? `HTTP ${resp.status}`);
        return;
      }
      setOpen(false);
      setPlannedCount("");
      setNotes("");
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  if (isPlanLocked(status)) return null;

  if (!open) {
    return (
      <button type="button" id="pa-open" onClick={() => setOpen(true)} className={secondaryCls}>
        Add planned activity
      </button>
    );
  }

  return (
    <div className="border rounded-lg p-3 space-y-2 mb-3">
      <div className="grid grid-cols-2 gap-2">
        <select id="pa-type" className={inputCls} value={activityType}
          onChange={(e) => setActivityType(e.target.value)}>
          {PLANNED_ACTIVITY_TYPES.map((t) => (
            <option key={t.value} value={t.value}>{t.label}</option>
          ))}
        </select>
        <input id="pa-count" type="number" min="1" step="1" className={inputCls}
          placeholder="How many? *" value={plannedCount}
          onChange={(e) => setPlannedCount(e.target.value)} />
      </div>
      <textarea id="pa-notes" rows={2} className={`w-full ${inputCls}`} placeholder="Notes"
        value={notes} onChange={(e) => setNotes(e.target.value)} />
      {error && <p className="text-xs text-red-500">{error}</p>}
      <div className="flex gap-2">
        <button type="button" id="pa-save" disabled={!valid || saving} onClick={submit} className={primaryCls}>
          {saving ? "Saving…" : "Save activity"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className={secondaryCls}>Cancel</button>
      </div>
    </div>
  );
}
