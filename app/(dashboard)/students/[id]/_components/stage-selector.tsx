"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import {
  Check,
  ChevronRight,
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
}

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
  DEFERRED: "border-orange-200 text-orange-700 hover:bg-orange-50",
  APPLICATION_REJECTED: "border-red-200 text-red-700 hover:bg-red-50",
  LOST: "border-gray-200 text-gray-600 hover:bg-gray-50",
};

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
          <Clock className="h-3.5 w-3.5 text-slate-400" />
          <span className="text-slate-500">
            {daysInStage === 0
              ? "Entered this stage today"
              : `${daysInStage} day${daysInStage === 1 ? "" : "s"} in ${STAGE_LABELS[currentStage]}`}
          </span>
          {daysInStage >= 21 ? (
            <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700 font-medium">
              Escalated
            </span>
          ) : daysInStage >= 14 ? (
            <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
              Overdue
            </span>
          ) : null}
        </div>
        <p className="text-xs text-slate-400">{STAGE_OBJECTIVES[currentStage]}</p>
      </div>

      {isClosed ? (
        <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 flex items-start gap-3">
          <XCircle className="h-5 w-5 text-slate-400 shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-800">
              This student is closed as {STAGE_LABELS[currentStage]}.
            </p>
            <p className="text-xs text-slate-500 mt-0.5">
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
                  {i > 0 && <ChevronRight className="h-3 w-3 text-slate-300 shrink-0" />}
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
                      isDone && !isCurrent && "bg-green-50 text-green-700 border-green-200",
                      !isCurrent && !isDone && blocked && "bg-slate-50 text-slate-400 border-slate-200",
                      !isCurrent &&
                        !isDone &&
                        !blocked &&
                        "bg-white text-slate-600 border-slate-200 hover:border-[#0EA5E9] hover:text-[#0EA5E9]",
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

          {nextStage && nextGate && !nextGate.canProgress && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-amber-900">
                    To move to {STAGE_LABELS[nextStage]}:
                  </p>
                  <ul className="mt-1 space-y-0.5">
                    {nextGate.blockers.map((b, i) => (
                      <li key={i} className="text-xs text-amber-800 flex gap-1.5">
                        <span className="text-amber-400">•</span>
                        <span>{b.message}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          )}

          {/* Closed outcomes — reachable from any stage */}
          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <span className="text-xs text-slate-400">Close as:</span>
            {CLOSED_STAGES.map((stage) => (
              <button
                key={stage}
                disabled={loading}
                onClick={() => setCloseOpen(stage)}
                className={cn(
                  "px-2 py-1 rounded-md text-xs font-medium border bg-white transition-colors",
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
              <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                <p className="text-xs font-semibold text-amber-900 mb-1">You are bypassing:</p>
                <ul className="space-y-0.5">
                  {blockedTarget.blockers.map((b, i) => (
                    <li key={i} className="text-xs text-amber-800">
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
              <p className="text-xs text-slate-400">At least 10 characters.</p>
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
