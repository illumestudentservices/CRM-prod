"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  Lock,
  AlertTriangle,
  Loader2,
  ShieldAlert,
  Clock,
  XCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import type { LeadStage } from "@prisma/client";
import {
  PIPELINE_STAGES,
  CLOSED_STAGES,
  STAGE_LABELS,
  STAGE_OBJECTIVES,
  stageIndex,
  daysSince,
} from "@/lib/lead-pipeline";
import type { Requirement, RequirementTarget } from "@/lib/lead-gate";
import { requestLeadFocus } from "@/lib/lead-focus";
import { CloseOutcomeDialog } from "./close-outcome-dialog";

interface Blocker {
  kind: string;
  message: string;
  field?: string;
}

interface GateEntry {
  stage: LeadStage;
  canProgress: boolean;
  blockers: Blocker[];
  /** Every rule for this move, met and unmet. Drives the checklist below. */
  requirements: Requirement[];
}

/**
 * What the button on a pending requirement says.
 *
 * Naming the destination rather than saying "Fix" everywhere is the point of
 * the exercise: the complaint this replaced was that the blocker list named a
 * field and left you to find it, and the fields live in four different places.
 */
const TARGET_LABELS: Record<RequirementTarget["where"], string> = {
  lead: "Open",
  application: "Open",
  interest: "Open",
  interestCreate: "Add interest",
  activityLog: "Log it",
  activitySchedule: "Book it",
  checklist: "Open checklist",
  none: "",
};

interface StageSelectorProps {
  leadId: string;
  currentStage: LeadStage;
  stageEnteredAt: string;
  /**
   * Evaluated on the server for this request.
   *
   * Passed in rather than fetched here so that editing a field, logging an
   * activity or ticking a checklist item clears its own blocker immediately:
   * every one of those calls router.refresh(), which re-runs the server
   * component and delivers new props. Held in client state instead, the list
   * stayed frozen at whatever it was on mount and only a full page reload
   * would update it.
   */
  gates: GateEntry[];
  canOverride: boolean;
}

const CLOSED_STYLES: Record<string, string> = {
  DEFERRED: "border-orange-200 text-orange-700 hover:bg-orange-50 dark:border-orange-500/30 dark:text-orange-300 dark:hover:bg-orange-500/10",
  APPLICATION_REJECTED: "border-red-200 text-red-700 hover:bg-red-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-500/10",
  LOST: "border-gray-200 text-gray-600 hover:bg-gray-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800/60",
  // Spec §15. Colours follow STAGE_HEX in lead-pipeline.ts: zinc for withdrawn
  // (a neutral, non-competitive exit), rose for visa refused (a hard refusal).
  WITHDRAWN: "border-zinc-200 text-zinc-700 hover:bg-zinc-50 dark:border-zinc-500/30 dark:text-zinc-300 dark:hover:bg-zinc-500/10",
  VISA_REFUSED: "border-rose-200 text-rose-700 hover:bg-rose-50 dark:border-rose-500/30 dark:text-rose-300 dark:hover:bg-rose-500/10",
};

/**
 * "What this stage still needs", as a checklist you can act on.
 *
 * ── WHAT THIS REPLACED, AND WHY ─────────────────────────────────────────────
 *
 * A bulleted list of failure messages — "Budget range is required", "Initial
 * counselling must be completed in this stage" — and nothing else. Three
 * problems with it, all reported from real use:
 *
 *  1. It named a field without saying where the field was. The fields for a
 *     single stage are spread across the edit form, the journey panel, the
 *     application panel and an activity dialog, so every line was the start of
 *     a hunt. Each row is now a button that opens the right one.
 *  2. It showed only what was wrong. With seven rules and five met, you could
 *     not tell whether you were nearly there or had barely started, and work
 *     already done was invisible. Met rules are now listed too, ticked.
 *  3. It appeared only while blocked and vanished at the moment it became
 *     useful, taking the "you may now move on" moment with it. It now stays,
 *     and turns into the move button.
 */
function StageRequirements({
  nextStage,
  gate,
  onMove,
  moving,
}: {
  nextStage: LeadStage;
  gate: GateEntry;
  onMove: () => void;
  moving: boolean;
}) {
  const [showDone, setShowDone] = React.useState(false);

  const reqs = gate.requirements ?? [];
  const pending = reqs.filter((r) => !r.done);
  const done = reqs.filter((r) => r.done);

  // An illegal transition is not a to-do list — there is nothing to tick off,
  // and offering "Open" against it would be offering to fix the unfixable.
  const impossible = pending.some((r) => r.target.where === "none");

  if (gate.canProgress) {
    return (
      <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-500/30 dark:bg-green-500/10 p-3 flex items-center gap-3">
        <CircleCheck className="h-5 w-5 text-green-600 dark:text-green-400 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold text-green-900 dark:text-green-200">
            Everything {STAGE_LABELS[nextStage]} needs is done.
          </p>
          {done.length > 0 && (
            <p className="text-xs text-green-700 dark:text-green-300/80 mt-0.5">
              {done.length} requirement{done.length === 1 ? "" : "s"} met.
            </p>
          )}
        </div>
        <Button
          size="sm"
          disabled={moving}
          onClick={onMove}
          className="bg-green-600 hover:bg-green-700 text-white shrink-0 gap-1.5"
        >
          {moving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          Move to {STAGE_LABELS[nextStage]}
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10 p-3">
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-2 flex-wrap">
            <p className="text-xs font-semibold text-amber-900 dark:text-amber-200">
              To move to {STAGE_LABELS[nextStage]}:
            </p>
            {reqs.length > 0 && !impossible && (
              <p className="text-xs text-amber-700 dark:text-amber-300/80">
                {done.length} of {reqs.length} done
              </p>
            )}
          </div>

          <ul className="mt-2 space-y-1">
            {pending.map((r) => (
              <RequirementRow key={r.id} req={r} />
            ))}
          </ul>

          {done.length > 0 && (
            <>
              <button
                onClick={() => setShowDone((s) => !s)}
                className="mt-2 inline-flex items-center gap-1 text-xs text-amber-700 dark:text-amber-300/80 hover:text-amber-900 dark:hover:text-amber-200"
              >
                {showDone ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {showDone ? "Hide" : "Show"} the {done.length} already done
              </button>
              {showDone && (
                <ul className="mt-1 space-y-1">
                  {done.map((r) => (
                    <RequirementRow key={r.id} req={r} />
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** One rule. Clickable while it is outstanding, a ticked line once it is not. */
function RequirementRow({ req }: { req: Requirement }) {
  if (req.done) {
    return (
      <li className="flex items-start gap-1.5 text-xs text-amber-700/70 dark:text-amber-300/60">
        <CircleCheck className="h-3.5 w-3.5 shrink-0 mt-px text-green-600 dark:text-green-400" />
        <span className="line-through decoration-amber-700/30">{req.label}</span>
        {req.doneNote && <span className="not-italic">· {req.doneNote}</span>}
      </li>
    );
  }

  const actionable = req.target.where !== "none";

  return (
    <li>
      <button
        type="button"
        disabled={!actionable}
        onClick={() => requestLeadFocus(req.target)}
        className={cn(
          "w-full flex items-start gap-1.5 text-left rounded-md px-1.5 py-1 -mx-1.5 transition-colors",
          actionable
            ? "hover:bg-amber-100/70 dark:hover:bg-amber-500/15 cursor-pointer"
            : "cursor-default"
        )}
      >
        <Circle className="h-3.5 w-3.5 shrink-0 mt-px text-amber-500 dark:text-amber-400" />
        <span className="min-w-0 flex-1 text-xs text-amber-900 dark:text-amber-200">
          <span className="font-medium">{req.label}</span>
          {req.detail && (
            <span className="text-amber-700 dark:text-amber-300/80"> — {req.detail}</span>
          )}
        </span>
        {actionable && (
          <span className="shrink-0 inline-flex items-center gap-0.5 text-xs font-medium text-amber-700 dark:text-amber-300">
            {TARGET_LABELS[req.target.where]}
            <ChevronRight className="h-3 w-3" />
          </span>
        )}
      </button>
    </li>
  );
}

export function StageSelector({
  leadId,
  currentStage,
  stageEnteredAt,
  gates,
  canOverride,
}: StageSelectorProps) {
  const router = useRouter();
  const { toast } = useToast();

  const [loading, setLoading] = React.useState(false);
  const [pending, setPending] = React.useState<LeadStage | null>(null);
  const [overrideOpen, setOverrideOpen] = React.useState(false);
  const [overrideReason, setOverrideReason] = React.useState("");
  const [closeOpen, setCloseOpen] = React.useState<LeadStage | null>(null);

  const isClosed = (CLOSED_STAGES as readonly string[]).includes(currentStage);
  const currentIndex = stageIndex(currentStage);
  const daysInStage = daysSince(stageEnteredAt) ?? 0;


  const gateFor = (stage: LeadStage) => gates.find((g) => g.stage === stage);

  async function move(stage: LeadStage, override?: string) {
    setLoading(true);
    setPending(stage);
    try {
      const res = await fetch(`/api/leads/${leadId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          override ? { stage, override: true, overrideReason: override } : { stage }
        ),
      });
      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        toast({
          title: data.error ?? "Could not move stage",
          description:
            (data.blockers ?? []).map((b: Blocker) => b.message).join(" · ") || undefined,
          variant: "destructive",
        });
        router.refresh();
        return;
      }

      toast({
        title: `Moved to ${STAGE_LABELS[stage]}`,
        description: override ? "Recorded as a manager override." : undefined,
      });
      setOverrideOpen(false);
      setOverrideReason("");
      router.refresh();
    } finally {
      setLoading(false);
      setPending(null);
    }
  }

  function handleClick(stage: LeadStage) {
    const gate = gateFor(stage);
    if (gate && !gate.canProgress) {
      // Blocked. Managers get the option to force it; everyone else is told why.
      if (canOverride) {
        setPending(stage);
        setOverrideOpen(true);
      } else {
        toast({
          title: `Cannot move to ${STAGE_LABELS[stage]} yet`,
          description: gate.blockers.map((b) => b.message).join(" · "),
          variant: "destructive",
        });
      }
      return;
    }
    move(stage);
  }

  const blockedTarget = pending ? gateFor(pending) : null;
  const nextStage = currentIndex >= 0 ? PIPELINE_STAGES[currentIndex + 1] : undefined;
  const nextGate = nextStage ? gateFor(nextStage) : null;

  return (
    <div className="space-y-4">
      {/* Days in current stage — the spec asks for this on every record */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 text-xs">
          <Clock className="h-3.5 w-3.5 text-slate-400 dark:text-slate-500" />
          <span className="text-slate-500 dark:text-slate-400">
            {daysInStage === 0
              ? "Entered this stage today"
              : `${daysInStage} day${daysInStage === 1 ? "" : "s"} in ${STAGE_LABELS[currentStage]}`}
          </span>
          {daysInStage >= 21 ? (
            <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300 font-medium">
              Escalated
            </span>
          ) : daysInStage >= 14 ? (
            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300 font-medium">
              Overdue
            </span>
          ) : null}
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">{STAGE_OBJECTIVES[currentStage]}</p>
      </div>

      {isClosed ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-900/40 p-4 flex items-start gap-3">
          <XCircle className="h-5 w-5 text-slate-400 dark:text-slate-500 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-800 dark:text-slate-200">
              This student is closed as {STAGE_LABELS[currentStage]}.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Reopening restores the stage they were closed from. Fresh activity will be
              required before they can progress again.
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              const res = await fetch(`/api/leads/${leadId}/close`, { method: "DELETE" });
              setLoading(false);
              if (res.ok) {
                toast({ title: "Student reopened" });
                router.refresh();
              } else {
                toast({ title: "Could not reopen", variant: "destructive" });
              }
            }}
          >
            Reopen
          </Button>
        </div>
      ) : (
        <>
          <div className="flex items-center gap-1 overflow-x-auto pb-1">
            {PIPELINE_STAGES.map((stage, i) => {
              const isCurrent = stage === currentStage;
              const isDone = currentIndex >= 0 && i < currentIndex;
              const gate = gateFor(stage);
              const blocked = !!gate && !gate.canProgress;
              const isNext = i === currentIndex + 1;

              return (
                <React.Fragment key={stage}>
                  {i > 0 && <ChevronRight className="h-3 w-3 text-slate-300 dark:text-slate-600 shrink-0" />}
                  <button
                    disabled={loading || isCurrent}
                    onClick={() => handleClick(stage)}
                    title={
                      blocked
                        ? gate!.blockers.map((b) => b.message).join("\n")
                        : STAGE_OBJECTIVES[stage]
                    }
                    className={cn(
                      "shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium border transition-colors",
                      isCurrent && "bg-[#1E3A5F] text-white border-[#1E3A5F] cursor-default",
                      isDone && !isCurrent && "bg-green-50 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30",
                      !isCurrent && !isDone && blocked && "bg-slate-50 text-slate-400 border-slate-200 dark:bg-slate-800/40 dark:text-slate-500 dark:border-slate-800",
                      !isCurrent &&
                        !isDone &&
                        !blocked &&
                        "bg-white text-slate-600 border-slate-200 hover:border-[#0EA5E9] hover:text-[#0EA5E9] dark:bg-slate-900 dark:text-slate-300 dark:border-slate-800 dark:hover:border-sky-500 dark:hover:text-sky-400",
                      isNext && !blocked && "ring-1 ring-[#0EA5E9]/40"
                    )}
                  >
                    {pending === stage && loading ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : isDone ? (
                      <Check className="h-3 w-3" />
                    ) : blocked ? (
                      <Lock className="h-3 w-3" />
                    ) : null}
                    {STAGE_LABELS[stage]}
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          {nextStage && nextGate && (
            <StageRequirements
              nextStage={nextStage}
              gate={nextGate}
              onMove={() => move(nextStage)}
              moving={loading && pending === nextStage}
            />
          )}

          {/* Closed outcomes — reachable from any stage */}
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <span className="text-xs text-slate-400 dark:text-slate-500">Close as:</span>
            {CLOSED_STAGES.map((stage) => (
              <button
                key={stage}
                disabled={loading}
                onClick={() => setCloseOpen(stage)}
                className={cn(
                  "px-2 py-1 rounded-md text-xs font-medium border bg-white dark:bg-slate-900 transition-colors",
                  CLOSED_STYLES[stage]
                )}
              >
                {STAGE_LABELS[stage]}
              </button>
            ))}
          </div>
        </>
      )}

      <Dialog
        open={overrideOpen}
        onOpenChange={(o) => {
          if (!o) {
            setOverrideOpen(false);
            setPending(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
              Override the stage requirements
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {blockedTarget && (
              <div className="rounded-lg bg-amber-50 border border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/30 p-3">
                <p className="text-xs font-semibold text-amber-900 dark:text-amber-200 mb-1">You are bypassing:</p>
                <ul className="space-y-0.5">
                  {blockedTarget.blockers.map((b, i) => (
                    <li key={i} className="text-xs text-amber-800 dark:text-amber-300">
                      • {b.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div className="space-y-1.5">
              <Label>Reason (recorded in the audit log)</Label>
              <Textarea
                rows={3}
                value={overrideReason}
                onChange={(e) => setOverrideReason(e.target.value)}
                placeholder="Why is it right to move this student on despite the above?"
              />
              <p className="text-xs text-slate-400 dark:text-slate-500">At least 10 characters.</p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setOverrideOpen(false);
                setPending(null);
              }}
            >
              Cancel
            </Button>
            <Button
              disabled={overrideReason.trim().length < 10 || loading}
              onClick={() => pending && move(pending, overrideReason.trim())}
              className="bg-amber-600 hover:bg-amber-700 text-white"
            >
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Override and move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {closeOpen && (
        <CloseOutcomeDialog
          leadId={leadId}
          outcome={closeOpen}
          open={!!closeOpen}
          onClose={() => setCloseOpen(null)}
          onDone={() => {
            setCloseOpen(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
