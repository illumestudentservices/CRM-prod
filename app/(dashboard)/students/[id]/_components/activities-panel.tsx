"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  CalendarPlus,
  Check,
  Loader2,
  CalendarClock,
  AlertTriangle,
  CircleCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

/**
 * Scheduling and completing engagements.
 *
 * These are what satisfy the pipeline gates, so the panel makes the two things
 * the gate cares about obvious: what has been done in this stage, and what is
 * booked next.
 */

const TYPES: { value: string; label: string; hint?: string }[] = [
  { value: "COUNSELLING", label: "Initial counselling", hint: "Required to leave Contacted" },
  { value: "ELIGIBILITY_REVIEW", label: "Eligibility review", hint: "Required to leave Qualified" },
  { value: "OFFER_REVIEW", label: "Offer review with student", hint: "Required to leave Offer Received" },
  { value: "POST_OFFER_SUPPORT", label: "Post-offer support", hint: "Required to leave Deposit Paid" },
  { value: "ENROLMENT_CONFIRMATION", label: "Enrolment confirmation", hint: "Required to complete Enrolled" },
  { value: "CALL", label: "Call" },
  { value: "MEETING", label: "Meeting" },
  { value: "EMAIL", label: "Email" },
  { value: "WHATSAPP", label: "WhatsApp" },
  { value: "FOLLOW_UP", label: "Follow-up" },
  { value: "OTHER", label: "Other" },
];

const LABEL: Record<string, string> = Object.fromEntries(TYPES.map((t) => [t.value, t.label]));

interface Activity {
  id: string;
  engagementType: string | null;
  description: string;
  scheduledFor: string | null;
  completedAt: string | null;
  cancelledAt: string | null;
  outcome: string | null;
  user?: { name: string | null } | null;
}

const fmt = (d: string) =>
  new Date(d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

export function ActivitiesPanel({ leadId }: { leadId: string }) {
  const router = useRouter();
  const { toast } = useToast();
  const [items, setItems] = React.useState<Activity[] | null>(null);
  const [open, setOpen] = React.useState(false);
  const [saving, setSaving] = React.useState(false);
  const [busy, setBusy] = React.useState<string | null>(null);

  const [type, setType] = React.useState("");
  const [description, setDescription] = React.useState("");
  const [mode, setMode] = React.useState<"schedule" | "log">("schedule");
  const [when, setWhen] = React.useState("");
  const [outcome, setOutcome] = React.useState("");

  const load = React.useCallback(async () => {
    const res = await fetch(`/api/leads/${leadId}/activities`);
    if (res.ok) setItems((await res.json()).activities ?? []);
  }, [leadId]);

  React.useEffect(() => {
    load();
  }, [load]);

  const live = (items ?? []).filter((a) => !a.cancelledAt);
  const nowMs = Date.now();
  const upcoming = live.filter(
    (a) => a.scheduledFor && !a.completedAt && new Date(a.scheduledFor).getTime() > nowMs
  );
  const overdue = live.filter(
    (a) => a.scheduledFor && !a.completedAt && new Date(a.scheduledFor).getTime() <= nowMs
  );
  const done = live.filter((a) => a.completedAt);

  async function create() {
    setSaving(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/activities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          engagementType: type,
          description: description.trim(),
          ...(mode === "schedule"
            ? { scheduledFor: new Date(when).toISOString() }
            : { completed: true, outcome: outcome.trim() || undefined }),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: data.error ?? "Could not save", variant: "destructive" });
        return;
      }
      toast({ title: mode === "schedule" ? "Activity scheduled" : "Activity logged" });
      setOpen(false);
      setType("");
      setDescription("");
      setWhen("");
      setOutcome("");
      await load();
      router.refresh();
    } finally {
      setSaving(false);
    }
  }

  async function act(activityId: string, action: "COMPLETE" | "CANCEL") {
    setBusy(activityId);
    try {
      const res = await fetch(`/api/leads/${leadId}/activities`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activityId, action }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        toast({ title: d.error ?? "Could not update", variant: "destructive" });
        return;
      }
      await load();
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  const valid =
    !!type && description.trim().length > 0 && (mode === "log" || !!when);

  const Row = ({ a, tone }: { a: Activity; tone: "upcoming" | "overdue" | "done" }) => (
    <div
      className={cn(
        "flex items-start gap-2.5 rounded-lg border p-2.5",
        tone === "overdue" && "border-amber-200 bg-amber-50/60",
        tone === "upcoming" && "border-slate-200 bg-white",
        tone === "done" && "border-slate-100 bg-slate-50/60"
      )}
    >
      {tone === "done" ? (
        <CircleCheck className="h-4 w-4 text-green-600 shrink-0 mt-0.5" />
      ) : tone === "overdue" ? (
        <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
      ) : (
        <CalendarClock className="h-4 w-4 text-slate-400 shrink-0 mt-0.5" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-slate-800">
          {a.engagementType ? LABEL[a.engagementType] ?? a.engagementType : "Activity"}
        </p>
        <p className="text-xs text-slate-600 mt-0.5">{a.description}</p>
        {a.outcome && <p className="text-xs text-slate-500 mt-0.5 italic">{a.outcome}</p>}
        <p className="text-[11px] text-slate-400 mt-1">
          {tone === "done"
            ? `Completed ${fmt(a.completedAt!)}`
            : `${tone === "overdue" ? "Was due" : "Due"} ${fmt(a.scheduledFor!)}`}
          {a.user?.name ? ` · ${a.user.name}` : ""}
        </p>
      </div>
      {tone !== "done" && (
        <div className="flex items-center gap-1 shrink-0">
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-green-700 hover:bg-green-50"
            disabled={busy === a.id}
            onClick={() => act(a.id, "COMPLETE")}
          >
            {busy === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-slate-400 hover:text-red-600 hover:bg-red-50"
            disabled={busy === a.id}
            onClick={() => act(a.id, "CANCEL")}
          >
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-slate-500">
          {upcoming.length === 0
            ? "Nothing scheduled — the pipeline needs a next step booked."
            : `${upcoming.length} upcoming`}
          {overdue.length > 0 && ` · ${overdue.length} overdue`}
        </p>
        <Button
          size="sm"
          className="bg-[#0EA5E9] hover:bg-[#0EA5E9]/90 gap-1.5"
          onClick={() => setOpen(true)}
        >
          <CalendarPlus className="h-4 w-4" />
          Add activity
        </Button>
      </div>

      {items === null ? (
        <p className="text-xs text-slate-400 py-4 text-center">Loading…</p>
      ) : live.length === 0 ? (
        <p className="text-xs text-slate-400 py-6 text-center border border-dashed border-slate-200 rounded-lg">
          No activities yet.
        </p>
      ) : (
        <div className="space-y-2">
          {overdue.map((a) => <Row key={a.id} a={a} tone="overdue" />)}
          {upcoming.map((a) => <Row key={a.id} a={a} tone="upcoming" />)}
          {done.slice(0, 5).map((a) => <Row key={a.id} a={a} tone="done" />)}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add activity</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="flex gap-2">
              {(["schedule", "log"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cn(
                    "flex-1 px-3 py-2 rounded-lg border text-xs font-medium transition-colors",
                    mode === m
                      ? "border-[#0EA5E9] bg-sky-50 text-[#0369A1]"
                      : "border-slate-200 text-slate-500 hover:border-slate-300"
                  )}
                >
                  {m === "schedule" ? "Schedule for later" : "Log something done"}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger><SelectValue placeholder="What kind of activity?" /></SelectTrigger>
                <SelectContent>
                  {TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                      {t.hint && <span className="text-slate-400"> — {t.hint}</span>}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>Description</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. Course options call"
              />
            </div>

            {mode === "schedule" ? (
              <div className="space-y-1.5">
                <Label>Date</Label>
                <Input type="date" value={when} onChange={(e) => setWhen(e.target.value)} />
                <p className="text-xs text-slate-400">Must be in the future.</p>
              </div>
            ) : (
              <div className="space-y-1.5">
                <Label>Outcome <span className="text-slate-400 font-normal">(optional)</span></Label>
                <Textarea
                  rows={2}
                  value={outcome}
                  onChange={(e) => setOutcome(e.target.value)}
                  placeholder="What came of it?"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button
              disabled={!valid || saving}
              onClick={create}
              className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white"
            >
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {mode === "schedule" ? "Schedule" : "Log"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
