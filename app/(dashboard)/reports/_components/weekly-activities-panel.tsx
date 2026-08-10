"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  WEEKLY_ACTIVITY_LIST,
  WEEKS_OF_MONTH,
  MONTH_LABELS,
  type WeeklyActivityType,
} from "@/lib/weekly-activities";

interface ActivityRow {
  id: string;
  icrId: string;
  icr: { id: string; name: string | null };
  year: number;
  month: number;
  weekOfMonth: number;
  type: WeeklyActivityType;
  target: number;
  completed: number;
  detail: string | null;
}

interface WeeklyActivitiesPanelProps {
  role: string;
  isICR: boolean;
}

const cellKey = (type: string, week: number) => `${type}-${week}`;

interface CellState {
  completed: number;
  target: number;
  detail: string;
  saving: boolean;
  saved: boolean;
}

export function WeeklyActivitiesPanel({ isICR }: WeeklyActivitiesPanelProps) {
  const now = useMemo(() => new Date(), []);
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth() + 1); // 1-12
  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ActivityRow[]>([]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/reports/weekly-activities?year=${year}&month=${month}`);
      if (!res.ok) {
        console.error("Failed to load weekly activities:", res.status);
        setRows([]);
        return;
      }
      const json = await res.json();
      setRows(json.activities ?? []);
    } catch (e) {
      console.error("Error loading weekly activities:", e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [year, month]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function prevMonth() {
    if (month === 1) {
      setMonth(12);
      setYear((y) => y - 1);
    } else {
      setMonth((m) => m - 1);
    }
  }
  function nextMonth() {
    if (month === 12) {
      setMonth(1);
      setYear((y) => y + 1);
    } else {
      setMonth((m) => m + 1);
    }
  }

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <button
            onClick={prevMonth}
            className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="text-sm font-semibold text-slate-900 dark:text-slate-100 w-36 text-center tabular-nums">
            {MONTH_LABELS[month - 1]} {year}
          </span>
          <button
            onClick={nextMonth}
            className="h-8 w-8 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-800/60 hover:text-slate-800 dark:hover:text-slate-200 transition-colors"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <p className="text-xs text-slate-400 dark:text-slate-500">
          {isICR
            ? "Fill in what you did each week — like the planner sheet"
            : "Read-only view of your region's ICRs"}
        </p>
      </div>

      {loading ? (
        <Card>
          <CardContent className="py-16 flex items-center justify-center text-slate-400 dark:text-slate-500 gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </CardContent>
        </Card>
      ) : isICR ? (
        <EditableGrid
          rows={rows}
          year={year}
          month={month}
          onSaved={(saved) => {
            setRows((prev) => {
              const idx = prev.findIndex(
                (r) => r.type === saved.type && r.weekOfMonth === saved.weekOfMonth
              );
              if (idx >= 0) {
                const copy = [...prev];
                copy[idx] = saved;
                return copy;
              }
              return [...prev, saved];
            });
          }}
        />
      ) : (
        <ReadOnlyGroupedGrids rows={rows} />
      )}
    </div>
  );
}

// ─── Editable grid (ICR's own activities — planner format) ───────────────────

function EditableGrid({
  rows,
  year,
  month,
  onSaved,
}: {
  rows: ActivityRow[];
  year: number;
  month: number;
  onSaved: (saved: ActivityRow) => void;
}) {
  const [cells, setCells] = useState<Record<string, CellState>>({});

  // (Re)hydrate local cell state whenever the loaded rows change.
  useEffect(() => {
    const next: Record<string, CellState> = {};
    for (const def of WEEKLY_ACTIVITY_LIST) {
      for (const week of WEEKS_OF_MONTH) {
        const existing = rows.find((r) => r.type === def.type && r.weekOfMonth === week);
        next[cellKey(def.type, week)] = {
          completed: existing?.completed ?? 0,
          target: existing?.target ?? def.defaultTarget,
          detail: existing?.detail ?? "",
          saving: false,
          saved: false,
        };
      }
    }
    setCells(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, rows.length]);

  const setCell = (key: string, patch: Partial<CellState>) =>
    setCells((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));

  const save = useCallback(
    async (type: WeeklyActivityType, week: number) => {
      const key = cellKey(type, week);
      const cell = cells[key];
      if (!cell) return;
      setCell(key, { saving: true, saved: false });
      try {
        const res = await fetch("/api/reports/weekly-activities", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            year,
            month,
            weekOfMonth: week,
            type,
            target: cell.target,
            completed: cell.completed,
            detail: cell.detail || null,
          }),
        });
        if (!res.ok) {
          console.error("Save failed:", res.status);
          setCell(key, { saving: false });
          return;
        }
        const json = await res.json();
        setCell(key, { saving: false, saved: true });
        setTimeout(() => setCell(key, { saved: false }), 1500);
        if (json.activity) onSaved(json.activity as ActivityRow);
      } catch (e) {
        console.error("Save error:", e);
        setCell(key, { saving: false });
      }
    },
    [cells, year, month, onSaved]
  );

  return (
    <Card>
      <CardContent className="p-0 overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40">
              <th className="text-left text-xs font-semibold text-slate-500 dark:text-slate-400 px-4 py-3 min-w-[300px] sticky left-0 bg-slate-50/70 dark:bg-slate-900/40 align-top">
                Mandatory activity
              </th>
              {WEEKS_OF_MONTH.map((w) => (
                <th
                  key={w}
                  className="text-left text-xs font-semibold text-slate-500 dark:text-slate-400 px-3 py-3 min-w-[200px] align-top"
                >
                  Week {w}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {WEEKLY_ACTIVITY_LIST.map((def) => {
              const monthCompleted = WEEKS_OF_MONTH.reduce(
                (sum, w) => sum + (cells[cellKey(def.type, w)]?.completed ?? 0),
                0
              );
              const monthTarget =
                def.cadence === "MONTHLY" ? def.defaultTarget : def.defaultTarget * WEEKS_OF_MONTH.length;
              const pct = monthTarget > 0 ? Math.round((monthCompleted / monthTarget) * 100) : 0;
              return (
                <tr key={def.type} className="align-top">
                  {/* Activity + description (sheet's first two columns) */}
                  <td className="px-4 py-3 sticky left-0 bg-white dark:bg-slate-900 align-top">
                    <p className="font-semibold text-slate-900 dark:text-slate-100">{def.label}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">{def.description}</p>
                    <div className="mt-2 flex items-center gap-2">
                      <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 shrink-0">
                        {monthCompleted}/{monthTarget}
                      </span>
                      <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden min-w-[40px]">
                        <div
                          className={cn(
                            "h-full rounded-full transition-all",
                            pct >= 100 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-400" : "bg-red-400"
                          )}
                          style={{ width: `${Math.min(pct, 100)}%` }}
                        />
                      </div>
                    </div>
                  </td>

                  {/* One free-text cell per week, with a small count */}
                  {WEEKS_OF_MONTH.map((w) => {
                    const key = cellKey(def.type, w);
                    const cell = cells[key];
                    return (
                      <td key={w} className="px-3 py-3 align-top">
                        <div className="space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <Input
                              type="number"
                              min={0}
                              value={cell?.completed ?? 0}
                              onChange={(e) =>
                                setCell(key, { completed: Math.max(0, parseInt(e.target.value || "0", 10)) })
                              }
                              onBlur={() => save(def.type, w)}
                              className="h-7 w-12 text-center px-1 tabular-nums text-xs"
                              aria-label={`${def.short} week ${w} count`}
                            />
                            <span className="text-[11px] text-slate-400 dark:text-slate-500">done</span>
                            <span className="ml-auto w-4">
                              {cell?.saving ? (
                                <Loader2 className="h-3.5 w-3.5 text-slate-300 dark:text-slate-600 animate-spin" />
                              ) : cell?.saved ? (
                                <Check className="h-3.5 w-3.5 text-emerald-500" />
                              ) : null}
                            </span>
                          </div>
                          <Textarea
                            value={cell?.detail ?? ""}
                            placeholder={def.examples[w - 1] || "Add details…"}
                            rows={3}
                            onChange={(e) => setCell(key, { detail: e.target.value })}
                            onBlur={() => save(def.type, w)}
                            className="text-xs resize-y min-h-[60px] leading-relaxed"
                          />
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
}

// ─── Read-only grouped grids (RM / Admin) ────────────────────────────────────

function ReadOnlyGroupedGrids({ rows }: { rows: ActivityRow[] }) {
  const groups = useMemo(() => {
    const map = new Map<string, { name: string; rows: ActivityRow[] }>();
    for (const r of rows) {
      const g = map.get(r.icrId) ?? { name: r.icr?.name ?? "Unknown ICR", rows: [] };
      g.rows.push(r);
      map.set(r.icrId, g);
    }
    return [...map.entries()].map(([icrId, g]) => ({ icrId, ...g }));
  }, [rows]);

  if (groups.length === 0) {
    return (
      <Card>
        <CardContent className="py-16 text-center text-sm text-slate-400 dark:text-slate-500">
          No weekly activities logged for this month yet.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {groups.map((group) => (
        <Card key={group.icrId}>
          <CardContent className="p-0 overflow-x-auto">
            <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40">
              <span className="text-sm font-semibold text-slate-900 dark:text-slate-100">{group.name}</span>
            </div>
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="border-b border-slate-100 dark:border-slate-800">
                  <th className="text-left text-xs font-semibold text-slate-500 dark:text-slate-400 px-4 py-2.5 min-w-[200px] align-top">
                    Activity
                  </th>
                  {WEEKS_OF_MONTH.map((w) => (
                    <th
                      key={w}
                      className="text-left text-xs font-semibold text-slate-500 dark:text-slate-400 px-3 py-2.5 min-w-[180px] align-top"
                    >
                      Week {w}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {WEEKLY_ACTIVITY_LIST.map((def) => (
                  <tr key={def.type} className="align-top">
                    <td className="px-4 py-3 align-top">
                      <p className="font-medium text-slate-800 dark:text-slate-200">{def.short}</p>
                      <p className="text-[11px] text-slate-400 dark:text-slate-500">
                        Target {def.defaultTarget}
                        {def.cadence === "WEEKLY" ? "/wk" : "/mo"}
                      </p>
                    </td>
                    {WEEKS_OF_MONTH.map((w) => {
                      const cell = group.rows.find((r) => r.type === def.type && r.weekOfMonth === w);
                      return (
                        <td key={w} className="px-3 py-3 align-top text-slate-700 dark:text-slate-300">
                          {cell && (cell.completed > 0 || cell.detail) ? (
                            <div className="space-y-1">
                              <span className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 tabular-nums">
                                {cell.completed} done
                              </span>
                              {cell.detail && (
                                <p className="text-xs text-slate-600 dark:text-slate-400 whitespace-pre-wrap leading-relaxed">
                                  {cell.detail}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600">·</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
