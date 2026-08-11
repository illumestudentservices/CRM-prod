"use client";

import * as React from "react";
import { GitMerge, Loader2, AlertTriangle } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { displayName } from "@/lib/person-name";

interface LeadOption {
  id: string;
  firstName: string | null;
  lastName: string | null;
  email: string | null;
  stage: string;
}

/**
 * SUPER_ADMIN-only tool for merging duplicate student profiles.
 *
 * Not a filter or a heuristic — the admin picks the surviving record
 * (`keep`) and the record whose data should be folded into it (`merge from`),
 * then explains why. The API is transactional and snapshots both originals
 * to audit_logs, so the merge is irreversible but traceable.
 */
export function MergeLeadsButton({ leads }: { leads: LeadOption[] }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [keepId, setKeepId] = React.useState("");
  const [mergeFromId, setMergeFromId] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [keepQuery, setKeepQuery] = React.useState("");
  const [mergeQuery, setMergeQuery] = React.useState("");

  function filter(q: string): LeadOption[] {
    const s = q.trim().toLowerCase();
    if (!s) return leads.slice(0, 30);
    return leads
      .filter((l) => {
        const name = displayName(l).toLowerCase();
        return name.includes(s) || (l.email ?? "").toLowerCase().includes(s);
      })
      .slice(0, 30);
  }

  const keep = leads.find((l) => l.id === keepId);
  const mergeFrom = leads.find((l) => l.id === mergeFromId);

  async function submit() {
    if (!keepId || !mergeFromId || keepId === mergeFromId) return;
    if (!reason.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/leads/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ keepId, mergeFromId, reason: reason.trim() }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `Failed (HTTP ${res.status})`);
      }
      setOpen(false);
      setKeepId("");
      setMergeFromId("");
      setReason("");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <GitMerge className="h-3.5 w-3.5" />
          Merge Duplicates
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Merge duplicate students</DialogTitle>
          <DialogDescription>
            Pick the profile to <strong>keep</strong> and the one to <strong>merge from</strong>.
            Institution interests, applications, activities, checklist items and notes are moved
            to the surviving record. Merged-from record is soft-deleted with a marker; originals
            are snapshotted to the audit log.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-4 pt-2">
          <LeadPicker
            label="Keep this profile"
            query={keepQuery}
            setQuery={setKeepQuery}
            selectedId={keepId}
            onSelect={setKeepId}
            options={filter(keepQuery)}
          />
          <LeadPicker
            label="Merge from this profile"
            query={mergeQuery}
            setQuery={setMergeQuery}
            selectedId={mergeFromId}
            onSelect={setMergeFromId}
            options={filter(mergeQuery).filter((l) => l.id !== keepId)}
          />
        </div>

        {keep && mergeFrom && (
          <div className="rounded border bg-slate-50 dark:bg-slate-900/40 p-3 text-xs space-y-1">
            <p>
              <strong>{displayName(mergeFrom)}</strong> ({mergeFrom.email ?? "no email"}) will be merged into{" "}
              <strong>{displayName(keep)}</strong> ({keep.email ?? "no email"}).
            </p>
            <p className="text-muted-foreground">This is irreversible.</p>
          </div>
        )}

        <div className="space-y-1.5 pt-2">
          <Label htmlFor="merge-reason">
            Reason <span className="text-red-500">*</span>
          </Label>
          <Textarea
            id="merge-reason"
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this a duplicate? (goes to the audit log)"
          />
        </div>

        {error && (
          <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={submit}
            disabled={loading || !keepId || !mergeFromId || keepId === mergeFromId || !reason.trim()}
            className="gap-1.5"
          >
            {loading && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {loading ? "Merging…" : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeadPicker({
  label,
  query,
  setQuery,
  selectedId,
  onSelect,
  options,
}: {
  label: string;
  query: string;
  setQuery: (v: string) => void;
  selectedId: string;
  onSelect: (id: string) => void;
  options: LeadOption[];
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {label}
      </Label>
      <input
        type="text"
        placeholder="Search by name or email…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        className="w-full rounded border border-slate-200 bg-white px-2 py-1 text-sm dark:border-slate-800 dark:bg-slate-900"
      />
      <div className="max-h-56 overflow-y-auto rounded border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800">
        {options.length === 0 ? (
          <div className="p-2 text-xs text-muted-foreground text-center">No matches.</div>
        ) : (
          options.map((l) => {
            const active = l.id === selectedId;
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => onSelect(l.id)}
                className={`w-full text-left px-2 py-1.5 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/50 ${
                  active ? "bg-blue-50 dark:bg-blue-500/15" : ""
                }`}
              >
                <div className="font-medium">{displayName(l)}</div>
                <div className="text-slate-500 dark:text-slate-400">
                  {l.email ?? "no email"} · {l.stage.replace(/_/g, " ")}
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
