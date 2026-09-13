"use client";

import * as React from "react";
import { ChevronRight, Loader2, ShieldAlert, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import type { LeadStage } from "@prisma/client";
import { PIPELINE_STAGES, STAGE_LABELS, STAGE_OBJECTIVES, stageIndex } from "@/lib/lead-pipeline";

/**
 * Moves ONE Institution Interest through the eight-stage pipeline.
 *
 * Spec page 3 puts the pipeline on the Institution Interest rather than on the
 * Student Profile, and until now no screen in the product could advance one:
 * the interests panel could create, close and reopen a journey but never move
 * it. The stage route existed and nothing called it, so the specification's
 * model had no interface behind it and the pipeline was driven entirely from
 * the Student Profile — the opposite of what the spec describes.
 *
 * Unlike the Student Profile's stage selector, blockers are not pre-evaluated
 * on the server. That one receives a gate result per stage as props, which is
 * affordable for one record; doing the same here would mean evaluating the gate
 * for every journey on every page render. Instead the move is attempted and the
 * route's own refusal is rendered — the same rules, reported by the only thing
 * that actually enforces them. The blockers stay on screen rather than living in
 * a toast, because they are a list of work to do, not a notification.
 */

interface Blocker {
  kind: string;
  message: string;
  field?: string;
}

const MIN_OVERRIDE_REASON = 10;

export function InterestStageControl({
  interestId,
  stage,
  onChanged,
}: {
  interestId: string;
  stage: string;
  /** Called after any successful move so the parent can refresh its list. */
  onChanged: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = React.useState(false);
  const [blockers, setBlockers] = React.useState<Blocker[] | null>(null);
  const [canOverride, setCanOverride] = React.useState(false);
  const [overrideOpen, setOverrideOpen] = React.useState(false);
  const [overrideReason, setOverrideReason] = React.useState("");
  const [backOpen, setBackOpen] = React.useState(false);
  const [backStage, setBackStage] = React.useState<string>("");
  const [backReason, setBackReason] = React.useState("");

  const idx = stageIndex(stage as LeadStage);
  const next = idx >= 0 ? PIPELINE_STAGES[idx + 1] : undefined;
  const earlier = idx > 0 ? PIPELINE_STAGES.slice(0, idx) : [];

  async function post(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/institution-interests/${interestId}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        // A gate refusal carries a blocker list; anything else is a plain error.
        if (Array.isArray(data.blockers) && data.blockers.length > 0) {
          setBlockers(data.blockers);
          setCanOverride(data.canOverride === true);
        } else {
          setBlockers(null);
          toast({
            title: data.error ?? "Could not change stage",
            variant: "destructive",
          });
        }
        return false;
      }

      setBlockers(null);
      toast({ title: `Moved to ${STAGE_LABELS[body.toStage as LeadStage]}` });
      onChanged();
      return true;
    } finally {
      setBusy(false);
    }
  }

  async function advance() {
    if (!next) return;
    await post({ toStage: next });
  }

  async function forceAdvance() {
    if (!next) return;
    const okDone = await post({
      toStage: next,
      override: true,
      overrideReason: overrideReason.trim(),
    });
    if (okDone) {
      setOverrideOpen(false);
      setOverrideReason("");
    }
  }

  async function moveBack() {
    if (!backStage || !backReason.trim()) return;
    const okDone = await post({ toStage: backStage, reason: backReason.trim() });
    if (okDone) {
      setBackOpen(false);
      setBackStage("");
      setBackReason("");
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        {next ? (
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            disabled={busy}
            onClick={advance}
          >
            {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <ChevronRight className="h-3 w-3" />}
            Advance to {STAGE_LABELS[next]}
          </Button>
        ) : (
          <span className="text-xs text-muted-foreground">
            Enrolled — the journey is complete.
          </span>
        )}

        {earlier.length > 0 && (
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs gap-1 text-muted-foreground"
            disabled={busy}
            onClick={() => setBackOpen(true)}
          >
            <Undo2 className="h-3 w-3" />
            Move back
          </Button>
        )}
      </div>

      {next && (
        <p className="text-[11px] text-muted-foreground">{STAGE_OBJECTIVES[next]}</p>
      )}

      {/* The refusal, kept on screen. Each line is a piece of work to do. */}
      {blockers && blockers.length > 0 && (
        <div className="rounded border border-amber-200 bg-amber-50/60 dark:border-amber-500/30 dark:bg-amber-500/10 p-2.5">
          <p className="text-xs font-medium text-amber-900 dark:text-amber-200 mb-1">
            Cannot advance yet — {blockers.length} outstanding:
          </p>
          <ul className="space-y-0.5">
            {blockers.map((b, i) => (
              <li key={i} className="text-[11px] text-amber-800 dark:text-amber-300 flex gap-1.5">
                <span aria-hidden>•</span>
                <span>{b.message}</span>
              </li>
            ))}
          </ul>
          {canOverride && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs gap-1 mt-2"
              onClick={() => setOverrideOpen(true)}
            >
              <ShieldAlert className="h-3 w-3" />
              Override with a reason
            </Button>
          )}
        </div>
      )}

      {/* Override — the reason is recorded against the student, so it is not
          a confirmation step but a written justification. */}
      <Dialog open={overrideOpen} onOpenChange={setOverrideOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              Force this journey to {next ? STAGE_LABELS[next] : ""}?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">
              The pipeline rules below are not met. Your reason is recorded against this
              student&apos;s history and is visible to anyone reviewing the journey.
            </p>
            <ul className="text-xs text-muted-foreground space-y-0.5 pl-4 list-disc">
              {(blockers ?? []).map((b, i) => (
                <li key={i}>{b.message}</li>
              ))}
            </ul>
            <Label className="text-xs">Reason for the override</Label>
            <Textarea
              rows={3}
              value={overrideReason}
              onChange={(e) => setOverrideReason(e.target.value)}
              placeholder="Why is it correct to move this journey on despite the above?"
            />
            <p className="text-[11px] text-muted-foreground">
              At least {MIN_OVERRIDE_REASON} characters.
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOverrideOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={forceAdvance}
              disabled={busy || overrideReason.trim().length < MIN_OVERRIDE_REASON}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Override and move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Backwards — spec §13 requires a reason, and the route enforces it. */}
      <Dialog open={backOpen} onOpenChange={setBackOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move this journey back</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Correcting a journey that was advanced in error. The reason is required and is
              recorded on the student&apos;s history.
            </p>
            <div className="space-y-1">
              <Label className="text-xs">Move back to</Label>
              <select
                value={backStage}
                onChange={(e) => setBackStage(e.target.value)}
                className="w-full border rounded px-2 py-1.5 text-sm bg-white dark:bg-slate-900 dark:border-slate-700 dark:text-slate-200"
              >
                <option value="">Select a stage</option>
                {earlier.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Reason</Label>
              <Textarea
                rows={3}
                value={backReason}
                onChange={(e) => setBackReason(e.target.value)}
                placeholder="Why is this journey being moved back?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setBackOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={moveBack}
              disabled={busy || !backStage || backReason.trim().length === 0}
              className={cn(busy && "opacity-70")}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin mr-1" />}
              Move back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
