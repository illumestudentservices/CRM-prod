"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TRANSITION_TYPE_LABELS, TYPES_WITH_FINAL_WORKING_DAY } from "@/lib/icr-transition";
import type { TransitionType } from "@prisma/client";

/**
 * Assign a Transition Report (spec §6).
 *
 * Imports only types and plain constants from lib/icr-transition — that module
 * has no database import, so pulling it into a client component does not drag
 * `pg` into the browser bundle. A "use client" file that reaches @/lib/db
 * fails the build with "Can't resolve 'dns'", which is how the Timesheets panel
 * took the whole page sweep from 38 routes to 0.
 */

interface Option { id: string; label: string }

export function NewTransitionButton({
  icrs = [], institutions = [], managers = [],
}: {
  icrs?: Option[];
  institutions?: Option[];
  managers?: Option[];
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  const [form, setForm] = React.useState({
    outgoingIcrId: "",
    institutionId: "",
    regionalManagerId: "",
    incomingIcrId: "",
    transitionType: "LEAVING_ILLUME" as TransitionType,
    effectiveTransitionDate: "",
    finalWorkingDay: "",
    reportDueDate: "",
  });

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const showFinalDay = TYPES_WITH_FINAL_WORKING_DAY.includes(form.transitionType);

  // Mirrors the server rule rather than replacing it: a due date after the
  // person has already left defeats the point of the report. Shown inline so
  // the manager sees it before submitting, but the API still enforces it.
  const dueAfterEffective =
    !!form.reportDueDate &&
    !!form.effectiveTransitionDate &&
    new Date(form.reportDueDate) > new Date(form.effectiveTransitionDate);

  async function submit() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/transition-reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          incomingIcrId: form.incomingIcrId || null,
          finalWorkingDay: showFinalDay && form.finalWorkingDay ? form.finalWorkingDay : null,
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? `Could not create the report (${res.status}).`);
        return;
      }
      setOpen(false);
      router.push(`/icr-transition/${json.data.id}`);
      router.refresh();
    } catch {
      setError("Could not reach the server.");
    } finally {
      setSaving(false);
    }
  }

  const ready =
    form.outgoingIcrId && form.institutionId && form.regionalManagerId &&
    form.effectiveTransitionDate && form.reportDueDate && !dueAfterEffective;

  const select =
    "w-full rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm";

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Assign handover</Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Assign a Transition Report</DialogTitle>
          <DialogDescription>
            The report covers one ICR&apos;s assignment to one client institution.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="t-icr">Outgoing ICR</Label>
            <select id="t-icr" className={select} value={form.outgoingIcrId}
              onChange={(e) => set("outgoingIcrId", e.target.value)}>
              <option value="">Select…</option>
              {icrs.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>

          <div>
            <Label htmlFor="t-inst">Client institution</Label>
            <select id="t-inst" className={select} value={form.institutionId}
              onChange={(e) => set("institutionId", e.target.value)}>
              <option value="">Select…</option>
              {institutions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Only this institution&apos;s pipeline appears in the report.
            </p>
          </div>

          <div>
            <Label htmlFor="t-rm">Reviewing Regional Manager</Label>
            <select id="t-rm" className={select} value={form.regionalManagerId}
              onChange={(e) => set("regionalManagerId", e.target.value)}>
              <option value="">Select…</option>
              {managers.filter((m) => m.id !== form.outgoingIcrId)
                .map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>

          <div>
            <Label htmlFor="t-in">Incoming ICR (if known)</Label>
            <select id="t-in" className={select} value={form.incomingIcrId}
              onChange={(e) => set("incomingIcrId", e.target.value)}>
              <option value="">Not yet known</option>
              {icrs.filter((o) => o.id !== form.outgoingIcrId)
                .map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>

          <div>
            <Label htmlFor="t-type">Transition type</Label>
            <select id="t-type" className={select} value={form.transitionType}
              onChange={(e) => set("transitionType", e.target.value)}>
              {Object.entries(TRANSITION_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="t-eff">Effective transition date</Label>
              <Input id="t-eff" type="date" value={form.effectiveTransitionDate}
                onChange={(e) => set("effectiveTransitionDate", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="t-due">Report due</Label>
              <Input id="t-due" type="date" value={form.reportDueDate}
                onChange={(e) => set("reportDueDate", e.target.value)} />
            </div>
          </div>

          {dueAfterEffective && (
            <p className="text-sm text-red-600 dark:text-red-400">
              The report would be due after the ICR has already gone. Bring the due date forward.
            </p>
          )}

          {showFinalDay && (
            <div>
              <Label htmlFor="t-fwd">Final working day</Label>
              <Input id="t-fwd" type="date" value={form.finalWorkingDay}
                onChange={(e) => set("finalWorkingDay", e.target.value)} />
            </div>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!ready || saving}>
            {saving ? "Assigning…" : "Assign handover"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
