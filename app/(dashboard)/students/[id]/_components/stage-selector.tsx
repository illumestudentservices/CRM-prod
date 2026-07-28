"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronRight, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import type { LeadStage } from "@prisma/client";
import { PIPELINE_STAGES, CLOSED_STAGES, STAGE_LABELS } from "@/lib/lead-pipeline";

// Ordering, labels and colours come from lib/lead-pipeline.ts.
const STAGE_ORDER: readonly LeadStage[] = PIPELINE_STAGES;
const TERMINAL_STAGES: readonly LeadStage[] = CLOSED_STAGES;
const TERMINAL_COLORS: Record<string, string> = {
  DEFERRED: "bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-200",
  APPLICATION_REJECTED: "bg-red-100 text-red-700 border-red-200 hover:bg-red-200",
  LOST: "bg-gray-100 text-gray-600 border-gray-200 hover:bg-gray-200",
};

interface StageSelectorProps {
  leadId: string;
  currentStage: LeadStage;
}

export function StageSelector({ leadId, currentStage }: StageSelectorProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = React.useState(false);
  const [pendingStage, setPendingStage] = React.useState<LeadStage | null>(null);
  const [showConfirm, setShowConfirm] = React.useState(false);

  const currentMainIndex = STAGE_ORDER.indexOf(currentStage);

  async function applyStageChange(stage: LeadStage) {
    setLoading(true);
    try {
      const res = await fetch(`/api/leads/${leadId}/stage`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to update stage");
      }

      toast({
        title: "Stage updated",
        description: `Lead moved to ${STAGE_LABELS[stage]}.`,
        variant: "success",
      });

      router.refresh();
    } catch (err) {
      toast({
        title: "Error",
        description: err instanceof Error ? err.message : "Failed to update stage.",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  function handleStageClick(stage: LeadStage) {
    if (stage === currentStage || loading) return;

    if (TERMINAL_STAGES.includes(stage)) {
      setPendingStage(stage);
      setShowConfirm(true);
      return;
    }

    applyStageChange(stage);
  }

  function confirmTerminal() {
    if (pendingStage) {
      applyStageChange(pendingStage);
      setShowConfirm(false);
      setPendingStage(null);
    }
  }

  const isTerminalCurrent = TERMINAL_STAGES.includes(currentStage);

  return (
    <div className="space-y-4">
      {/* Main pipeline steps */}
      <div className="flex items-center gap-0 overflow-x-auto pb-1">
        {STAGE_ORDER.map((stage, index) => {
          const stageIndex = STAGE_ORDER.indexOf(stage);
          const isCurrentMain = !isTerminalCurrent && stageIndex === currentMainIndex;
          const isCompleted = !isTerminalCurrent && stageIndex < currentMainIndex;
          const isFuture = isTerminalCurrent || stageIndex > currentMainIndex;
          const isLast = index === STAGE_ORDER.length - 1;

          return (
            <React.Fragment key={stage}>
              <button
                onClick={() => handleStageClick(stage)}
                disabled={loading || stage === currentStage}
                className={cn(
                  "flex flex-col items-center gap-1.5 px-3 py-2 rounded-lg transition-all min-w-[90px]",
                  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[#1E3A5F]",
                  "disabled:cursor-default",
                  isCompleted &&
                    "cursor-pointer hover:bg-green-50",
                  isCurrentMain &&
                    "cursor-default bg-[#1E3A5F]/5",
                  isFuture && !isCurrentMain &&
                    "cursor-pointer hover:bg-slate-50 opacity-70 hover:opacity-100"
                )}
                aria-current={isCurrentMain ? "step" : undefined}
              >
                {/* Step indicator */}
                <div
                  className={cn(
                    "h-8 w-8 rounded-full flex items-center justify-center border-2 text-xs font-bold transition-all",
                    isCompleted &&
                      "bg-green-500 border-green-500 text-white",
                    isCurrentMain &&
                      "bg-[#1E3A5F] border-[#1E3A5F] text-white shadow-md scale-110",
                    isFuture && !isCurrentMain &&
                      "bg-white border-slate-300 text-slate-400"
                  )}
                >
                  {isCompleted ? (
                    <Check className="h-4 w-4" />
                  ) : (
                    <span>{index + 1}</span>
                  )}
                </div>

                {/* Label */}
                <span
                  className={cn(
                    "text-[10px] font-medium text-center leading-tight whitespace-nowrap",
                    isCompleted && "text-green-700",
                    isCurrentMain && "text-[#1E3A5F]",
                    isFuture && !isCurrentMain && "text-slate-400"
                  )}
                >
                  {STAGE_LABELS[stage]}
                </span>
              </button>

              {!isLast && (
                <ChevronRight
                  className={cn(
                    "h-4 w-4 shrink-0",
                    isCompleted ? "text-green-400" : "text-slate-200"
                  )}
                />
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Terminal stage buttons */}
      <div className="flex flex-wrap gap-2">
        <span className="text-xs text-slate-500 self-center mr-1">Mark as:</span>
        {TERMINAL_STAGES.map((stage) => (
          <button
            key={stage}
            onClick={() => handleStageClick(stage)}
            disabled={loading || stage === currentStage}
            className={cn(
              "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1",
              "disabled:cursor-default",
              stage === currentStage
                ? cn(TERMINAL_COLORS[stage], "border-2 font-semibold")
                : cn(TERMINAL_COLORS[stage], "opacity-70 hover:opacity-100")
            )}
          >
            {stage === currentStage && <Check className="h-3 w-3" />}
            {STAGE_LABELS[stage]}
          </button>
        ))}
      </div>

      {/* Confirmation dialog */}
      {showConfirm && pendingStage && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-xl border border-slate-200 p-6 max-w-sm mx-4 space-y-4">
            <div className="flex items-start gap-3">
              <div className="h-9 w-9 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">
                  Mark as {STAGE_LABELS[pendingStage]}?
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  This will move the lead to a terminal stage. You can change it back at any time.
                </p>
              </div>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setShowConfirm(false);
                  setPendingStage(null);
                }}
                className="px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 rounded-md transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={confirmTerminal}
                className="px-3 py-1.5 text-sm font-medium bg-[#1E3A5F] text-white rounded-md hover:bg-[#1E3A5F]/90 transition-colors"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
