"use client";

import * as React from "react";
import { Loader2, Info } from "lucide-react";
import type { LeadStage } from "@prisma/client";
import { STAGE_LABELS } from "@/lib/lead-pipeline";
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
 * Recording a closed outcome.
 *
 * Each outcome carries different mandatory fields, so this switches on the
 * outcome rather than offering a single generic "reason" box — a Lost reason
 * you can't group on is nearly worthless for working out where students are
 * actually being lost.
 */

const LOST_REASONS: { value: string; label: string }[] = [
  { value: "NO_RESPONSE", label: "No response" },
  { value: "FINANCIAL", label: "Financial" },
  { value: "COMPETITOR", label: "Went to a competitor" },
  { value: "ACADEMIC", label: "Academic" },
  { value: "VISA", label: "Visa" },
  { value: "PERSONAL", label: "Personal" },
  { value: "OTHER", label: "Other" },
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

interface Props {
  leadId: string;
  outcome: LeadStage;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}

export function CloseOutcomeDialog({ leadId, outcome, open, onClose, onDone }: Props) {
  const { toast } = useToast();
  const [saving, setSaving] = React.useState(false);
  const [institutions, setInstitutions] = React.useState<{ id: string; name: string }[]>([]);

  // Lost
  const [lostReason, setLostReason] = React.useState("");
  const [lostDate, setLostDate] = React.useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = React.useState("");

  // Deferred
  const now = new Date();
  const [intakeYear, setIntakeYear] = React.useState(String(now.getUTCFullYear() + 1));
  const [intakeMonth, setIntakeMonth] = React.useState("9");
  const [followUpDate, setFollowUpDate] = React.useState("");

  // Rejected
  const [institutionId, setInstitutionId] = React.useState("");
  const [reason, setReason] = React.useState("");

  // Withdrawn / Visa refused (spec §15)
  const [outcomeDate, setOutcomeDate] = React.useState(new Date().toISOString().slice(0, 10));
  // "" = not answered. Radix reserves "" as the cleared value and throws if it
  // is used as an item value, so the options are "yes"/"no"/"unknown".
  const [reapplying, setReapplying] = React.useState("unknown");

  React.useEffect(() => {
    if (outcome !== "APPLICATION_REJECTED") return;
    fetch("/api/institutions")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const list = Array.isArray(d) ? d : (d?.data ?? d?.institutions ?? []);
        setInstitutions(list.map((i: { id: string; name: string }) => ({ id: i.id, name: i.name })));
      })
      .catch(() => {});
  }, [outcome]);

  /**
   * Per-outcome validity.
   *
   * A lookup rather than the nested ternary this used to be. That chain ended
   * in the APPLICATION_REJECTED rules as its `else`, so the two spec §15
   * outcomes added below would have been validated against "institution and
   * notes required" — fields their forms do not even render, leaving Confirm
   * permanently disabled with nothing on screen explaining why.
   */
  const validByOutcome: Partial<Record<LeadStage, boolean>> = {
    LOST: !!lostReason && !!lostDate && notes.trim().length > 0,
    DEFERRED: !!intakeYear && !!intakeMonth && reason.trim().length > 0 && !!followUpDate,
    APPLICATION_REJECTED: !!institutionId && reason.trim().length > 0 && notes.trim().length > 0,
    WITHDRAWN: reason.trim().length > 0 && !!outcomeDate,
    VISA_REFUSED: reason.trim().length > 0 && !!outcomeDate,
  };
  const valid = validByOutcome[outcome] ?? false;

  async function submit() {
    setSaving(true);
    try {
      // Same reasoning as validByOutcome above: an explicit branch per outcome,
      // so a new one cannot inherit the rejection payload by falling through.
      let payload: Record<string, unknown>;
      if (outcome === "LOST") {
        payload = {
          outcome,
          lostReason,
          lostDate: new Date(lostDate).toISOString(),
          notes: notes.trim(),
        };
      } else if (outcome === "DEFERRED") {
        payload = {
          outcome,
          deferredIntakeYear: Number(intakeYear),
          deferredIntakeMonth: Number(intakeMonth),
          reason: reason.trim(),
          followUpDate: new Date(followUpDate).toISOString(),
        };
      } else if (outcome === "WITHDRAWN") {
        payload = {
          outcome,
          reason: reason.trim(),
          withdrawnDate: new Date(outcomeDate).toISOString(),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        };
      } else if (outcome === "VISA_REFUSED") {
        payload = {
          outcome,
          refusalDate: new Date(outcomeDate).toISOString(),
          refusalReason: reason.trim(),
          // Omitted entirely when unknown, so the column stays NULL rather than
          // recording "not reapplying" for a question nobody answered.
          ...(reapplying === "unknown" ? {} : { reapplying: reapplying === "yes" }),
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        };
      } else {
        payload = {
          outcome,
          institutionId,
          reason: reason.trim(),
          notes: notes.trim(),
        };
      }

      const res = await fetch(`/api/leads/${leadId}/close`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast({ title: data.error ?? "Could not close", variant: "destructive" });
        return;
      }

      toast({
        title: `Marked as ${STAGE_LABELS[outcome]}`,
        // The rejection flow deliberately nudges toward another application
        // rather than treating a "no" from one institution as the end.
        description: data.prompt?.message,
      });
      onDone();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Mark as {STAGE_LABELS[outcome]}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {outcome === "LOST" && (
            <>
              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Select value={lostReason} onValueChange={setLostReason}>
                  <SelectTrigger><SelectValue placeholder="Why was this student lost?" /></SelectTrigger>
                  <SelectContent>
                    {LOST_REASONS.map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Date lost</Label>
                <Input type="date" value={lostDate} onChange={(e) => setLostDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="What happened?"
                />
              </div>
            </>
          )}

          {outcome === "DEFERRED" && (
            <>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Future intake month</Label>
                  <Select value={intakeMonth} onValueChange={setIntakeMonth}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {MONTHS.map((m, i) => (
                        <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Year</Label>
                  <Input
                    type="number"
                    min={now.getUTCFullYear()}
                    max={now.getUTCFullYear() + 5}
                    value={intakeYear}
                    onChange={(e) => setIntakeYear(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Follow-up date</Label>
                <Input
                  type="date"
                  value={followUpDate}
                  onChange={(e) => setFollowUpDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Why are they deferring?"
                />
              </div>
              <div className="flex gap-2 rounded-lg bg-sky-50 border border-sky-200 dark:bg-sky-500/10 dark:border-sky-500/30 p-2.5">
                <Info className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                <p className="text-xs text-sky-800 dark:text-sky-200">
                  This student will reopen automatically ahead of the intake you choose.
                </p>
              </div>
            </>
          )}

          {outcome === "WITHDRAWN" && (
            <>
              <div className="space-y-1.5">
                <Label>Why did they withdraw?</Label>
                <Textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Decided to stay and work locally for a year"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Date they withdrew</Label>
                <Input
                  type="date"
                  value={outcomeDate}
                  onChange={(e) => setOutcomeDate(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div className="flex gap-2 rounded-lg bg-sky-50 border border-sky-200 dark:bg-sky-500/10 dark:border-sky-500/30 p-2.5">
                <Info className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                <p className="text-xs text-sky-800 dark:text-sky-200">
                  Use this rather than Lost when the student pulled out themselves. Lost is
                  for cases we might have influenced, and mixing the two distorts the
                  lost-reason reporting.
                </p>
              </div>
            </>
          )}

          {outcome === "VISA_REFUSED" && (
            <>
              <div className="space-y-1.5">
                <Label>Refusal reason</Label>
                <Textarea
                  rows={3}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Insufficient evidence of funds"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label>Date of refusal</Label>
                  <Input
                    type="date"
                    value={outcomeDate}
                    onChange={(e) => setOutcomeDate(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Reapplying?</Label>
                  <Select value={reapplying} onValueChange={setReapplying}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="unknown">Not known yet</SelectItem>
                      <SelectItem value="yes">Yes, reapplying</SelectItem>
                      <SelectItem value="no">No</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div className="flex gap-2 rounded-lg bg-sky-50 border border-sky-200 dark:bg-sky-500/10 dark:border-sky-500/30 p-2.5">
                <Info className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                <p className="text-xs text-sky-800 dark:text-sky-200">
                  Recorded separately from Lost so the visa refusal rate can be reported on
                  its own. Leave &ldquo;Reapplying&rdquo; as not known if it has not been
                  discussed yet.
                </p>
              </div>
            </>
          )}

          {outcome === "APPLICATION_REJECTED" && (
            <>
              <div className="space-y-1.5">
                <Label>Institution that rejected</Label>
                <Select value={institutionId} onValueChange={setInstitutionId}>
                  <SelectTrigger><SelectValue placeholder="Select institution" /></SelectTrigger>
                  <SelectContent>
                    {institutions.map((i) => (
                      <SelectItem key={i.id} value={i.id}>{i.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Reason</Label>
                <Input
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="e.g. Below academic threshold"
                />
              </div>
              <div className="space-y-1.5">
                <Label>Notes</Label>
                <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </div>
              <div className="flex gap-2 rounded-lg bg-sky-50 border border-sky-200 dark:bg-sky-500/10 dark:border-sky-500/30 p-2.5">
                <Info className="h-4 w-4 text-sky-600 dark:text-sky-400 shrink-0 mt-0.5" />
                <p className="text-xs text-sky-800 dark:text-sky-200">
                  A rejection from one institution needn&apos;t end the case — consider an
                  alternative application for this student.
                </p>
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button
            disabled={!valid || saving}
            onClick={submit}
            className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white"
          >
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
