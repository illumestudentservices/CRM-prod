"use client";

import { PIPELINE_STAGES, STAGE_LABELS, STAGE_HEX } from "@/lib/lead-pipeline";

// The funnel shows only the live pipeline; closed outcomes aren't funnel steps.
// Derived rather than duplicated: the previous local copies were untyped, so a
// stage rename left this rendering all zeros with no compile error.
const STAGE_ORDER = PIPELINE_STAGES;
const STAGE_COLORS = PIPELINE_STAGES.map((s) => STAGE_HEX[s]);


interface ConversionFunnelProps {
  stageBreakdown: Record<string, number>;
  onStageClick?: (stage: string) => void;
}

export function ConversionFunnel({ stageBreakdown, onStageClick }: ConversionFunnelProps) {
  /**
   * stageBreakdown is a snapshot: how many leads are sitting at each stage RIGHT
   * NOW. A lead that reached Enrolled is no longer counted under New Lead, so the
   * buckets are not nested and dividing one by the previous one is meaningless —
   * it read "Overall Conversion 111%" (Enrolled 10 / New Lead 9) and
   * "Application Submitted 117%" on real data.
   *
   * A funnel needs cumulative volume: how many leads got *to this stage or
   * beyond*, which is the suffix sum of the snapshot. That is monotonically
   * decreasing by construction, so no step can exceed 100%.
   *
   * Note this counts only the live pipeline — closed outcomes (Lost, Deferred,
   * Rejected) are not stages in PIPELINE_STAGES, so a lead that dropped out is
   * not in any bucket. "Reached New Lead" therefore means "still in play".
   */
  const snapshot = STAGE_ORDER.map((key) => stageBreakdown[key] ?? 0);
  const reached = snapshot.map((_, i) => snapshot.slice(i).reduce((a, b) => a + b, 0));

  const stages = STAGE_ORDER.map((key, i) => ({
    key,
    label: STAGE_LABELS[key] ?? key,
    /** Cumulative — matches the bar and the percentage beside it. */
    count: reached[i],
    /** How many are sitting at exactly this stage, for the tooltip. */
    atStage: snapshot[i],
  }));

  const maxCount = Math.max(reached[0], 1);

  return (
    <div className="space-y-2">
      {stages.map((stage, index) => {
        const prevCount = index > 0 ? stages[index - 1].count : null;
        // Both sides are cumulative now, so this cannot exceed 100. Clamped
        // anyway: a percentage over 100 on a funnel is the kind of thing a
        // partner notices, and a rounding surprise should not put it there.
        const conversionRate =
          prevCount !== null && prevCount > 0
            ? Math.min(100, Math.round((stage.count / prevCount) * 100))
            : null;

        const barWidth = maxCount > 0 ? (stage.count / maxCount) * 100 : 0;

        return (
          <div
            key={stage.key}
            className={`group ${onStageClick && stage.count > 0 ? "cursor-pointer" : ""}`}
            onClick={() => onStageClick && stage.count > 0 && onStageClick(stage.key)}
          >
            <div className="flex items-center justify-between mb-1">
              <span
                title={`${stage.count} reached ${stage.label} or beyond · ${stage.atStage} currently at this stage`}
                className={`text-xs font-medium text-slate-600 dark:text-slate-300 ${onStageClick && stage.count > 0 ? "group-hover:text-[#0EA5E9] transition-colors" : ""}`}
              >
                {stage.label}
              </span>
              <div className="flex items-center gap-2">
                {conversionRate !== null && (
                  <span className="text-xs text-slate-400 dark:text-slate-500">{conversionRate}%</span>
                )}
                <span className="text-xs font-bold text-slate-800 dark:text-slate-200 w-8 text-right">
                  {stage.count.toLocaleString()}
                </span>
              </div>
            </div>
            <div className="relative h-6 bg-slate-100 dark:bg-slate-800 rounded overflow-hidden">
              <div
                className="h-full rounded transition-all duration-700 ease-out group-hover:opacity-80"
                style={{
                  width: `${barWidth}%`,
                  backgroundColor: STAGE_COLORS[index] ?? "#0EA5E9",
                  minWidth: stage.count > 0 ? "4px" : "0",
                }}
              />
            </div>
          </div>
        );
      })}

      {/* Total */}
      <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500 dark:text-slate-400">Overall Conversion</span>
          <span className="font-bold text-[#22C55E]">
            {stages[0].count > 0
              ? `${Math.min(100, Math.round(((stages[stages.length - 1].count) / stages[0].count) * 100))}%`
              : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
