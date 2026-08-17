"use client";

import * as React from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

/**
 * The Regional Manager's two actions that need more than a button.
 *
 * Both previously used window.prompt(), which cannot be styled, cannot show the
 * list of students being moved, and is blocked outright by some browsers. The
 * amendment reason in particular is the message the outgoing ICR reads to know
 * what to fix, so writing it in a native prompt box was the wrong surface for
 * the one piece of text that decides whether the round trip is useful.
 */

interface Interest {
  id: string;
  stage: string;
  lead: { id: string; firstName: string; lastName: string };
}

interface Owner { id: string; label: string }

export function AmendmentsDialog({
  open, onOpenChange, onConfirm, busy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onConfirm: (comments: string) => void;
  busy: boolean;
}) {
  const [text, setText] = React.useState("");

  React.useEffect(() => { if (open) setText(""); }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Return for amendments</DialogTitle>
          <DialogDescription>
            The outgoing ICR sees this message. Be specific about what needs to change.
          </DialogDescription>
        </DialogHeader>
        <div>
          <Label htmlFor="amend">What needs to change?</Label>
          <textarea
            id="amend"
            rows={5}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="e.g. The agent handover section does not name who is taking over the two priority agents."
            className="mt-1 w-full rounded-md border border-slate-200 dark:border-slate-700 bg-transparent p-2 text-sm"
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          {/* The API refuses an empty reason too; this just says so sooner. */}
          <Button onClick={() => onConfirm(text.trim())} disabled={busy || !text.trim()}>
            {busy ? "Returning…" : "Return report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReassignDialog({
  open, onOpenChange, reportId, owners, onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  reportId: string;
  owners: Owner[];
  onDone: () => void;
}) {
  const [interests, setInterests] = React.useState<Interest[] | null>(null);
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [toUserId, setToUserId] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!open) return;
    setError(null);
    (async () => {
      try {
        const res = await fetch(`/api/transition-reports/${reportId}/reassign`);
        const json = await res.json();
        if (!res.ok) throw new Error(json?.error ?? String(res.status));
        setInterests(json.data.interests);
        // Everything moves by default; §16 calls the subset "individual
        // exceptions", so opting out is the deliberate act, not opting in.
        setSelected(new Set(json.data.interests.map((i: Interest) => i.id)));
        if (json.data.suggestedOwnerId) setToUserId(json.data.suggestedOwnerId);
      } catch {
        setError("Could not load the student list.");
      }
    })();
  }, [open, reportId]);

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const all = interests?.length ?? 0;
      const res = await fetch(`/api/transition-reports/${reportId}/reassign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          toUserId,
          // Omitted when everything is selected, so the server moves the whole
          // scope rather than a list that may have gone stale while open.
          ...(selected.size === all ? {} : { interestIds: [...selected] }),
        }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok) {
        setError(json?.error ?? `Could not reassign (${res.status}).`);
        return;
      }
      onOpenChange(false);
      onDone();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Reassign student pipeline</DialogTitle>
          <DialogDescription>
            Moves ownership only. Stage, activities, tasks, documents and attribution are unchanged.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div>
            <Label htmlFor="to">New owner</Label>
            <select
              id="to"
              value={toUserId}
              onChange={(e) => setToUserId(e.target.value)}
              className="w-full rounded-md border border-slate-200 dark:border-slate-700 bg-transparent px-3 py-2 text-sm"
            >
              <option value="">Select…</option>
              {owners.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
            </select>
          </div>

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

          {interests === null ? (
            <p className="text-sm text-slate-500">Loading students…</p>
          ) : interests.length === 0 ? (
            <p className="text-sm text-slate-500">
              No students are still assigned to the outgoing ICR.
            </p>
          ) : (
            <div className="max-h-64 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700">
              {interests.map((i) => (
                <label
                  key={i.id}
                  className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 p-2 text-sm last:border-b-0"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(i.id)}
                    onChange={() => toggle(i.id)}
                  />
                  <span>{i.lead.firstName} {i.lead.lastName}</span>
                  <span className="ml-auto text-xs text-slate-500">
                    {i.stage.replaceAll("_", " ").toLowerCase()}
                  </span>
                </label>
              ))}
            </div>
          )}

          {interests && interests.length > 0 && (
            <p className="text-xs text-slate-500">
              {selected.size} of {interests.length} selected. Unticking a student leaves them with
              the outgoing ICR, which will keep blocking finalisation.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy || !toUserId || selected.size === 0}>
            {busy ? "Reassigning…" : `Reassign ${selected.size} student(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
