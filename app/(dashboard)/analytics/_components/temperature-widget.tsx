"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { temperatureBadgeClass, temperatureLabel } from "@/lib/lead-options";

export interface TemperatureBreakdown {
  HOT: number;
  WARM: number;
  COLD: number;
  UNSET?: number;
}

/**
 * Lead temperature at a glance — three clickable tiles. A click hands the chosen
 * temperature up (the dashboard opens its drill-down filtered to it).
 */
export function TemperatureWidget({
  breakdown,
  onPick,
  loading,
}: {
  breakdown?: TemperatureBreakdown | null;
  onPick: (temp: "HOT" | "WARM" | "COLD") => void;
  loading?: boolean;
}) {
  const b = breakdown ?? { HOT: 0, WARM: 0, COLD: 0, UNSET: 0 };
  const tiles: Array<"HOT" | "WARM" | "COLD"> = ["HOT", "WARM", "COLD"];

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base font-semibold text-slate-800 dark:text-slate-200">Lead Temperature</CardTitle>
        <p className="text-xs text-slate-500 dark:text-slate-400">Click a tile to view those leads</p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-3">
          {tiles.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => onPick(t)}
              className={cn(
                "rounded-lg border px-3 py-4 text-center transition-transform hover:shadow-sm active:scale-[0.98] cursor-pointer",
                temperatureBadgeClass(t)
              )}
            >
              <div className="text-2xl font-bold tabular-nums">{loading ? "—" : b[t] ?? 0}</div>
              <div className="text-xs font-medium mt-0.5">{temperatureLabel(t)}</div>
            </button>
          ))}
        </div>
        {!loading && (b.UNSET ?? 0) > 0 && (
          <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-2 text-center">
            {b.UNSET} not set yet
          </p>
        )}
      </CardContent>
    </Card>
  );
}
