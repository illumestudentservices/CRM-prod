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
  const stages = STAGE_ORDER.map((key) => ({
    key,
    label: STAGE_LABELS[key] ?? key,
    count: stageBreakdown[key] ?? 0,
  }));

  const maxCount = Math.max(...stages.map((s) => s.count), 1);

  return (
    <div className="space-y-2">
      {stages.map((stage, index) => {
        const prevCount = index > 0 ? stages[index - 1].count : null;
        const conversionRate =
          prevCount !== null && prevCount > 0
            ? Math.round((stage.count / prevCount) * 100)
            : null;

        const barWidth = maxCount > 0 ? (stage.count / maxCount) * 100 : 0;

        return (
          <div
            key={stage.key}
            className={`group ${onStageClick && stage.count > 0 ? "cursor-pointer" : ""}`}
            onClick={() => onStageClick && stage.count > 0 && onStageClick(stage.key)}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-xs font-medium text-slate-600 dark:text-slate-300 ${onStageClick && stage.count > 0 ? "group-hover:text-[#0EA5E9] transition-colors" : ""}`}>{stage.label}</span>
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
              ? `${Math.round(((stages[stages.length - 1].count) / stages[0].count) * 100)}%`
              : "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
