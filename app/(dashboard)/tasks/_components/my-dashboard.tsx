"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface DashboardData {
  dueToday: number;
  overdue: number;
  dueThisWeek: number;
  waitingExternal: number;
  completedThisWeek: number;
  byCategory: Record<string, number>;
}

/// Spec §9 — Personal task dashboard.
export function MyDashboard() {
  const [d, setD] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const r = await fetch("/api/tasks/dashboard");
      if (r.ok) setD(await r.json());
      setLoading(false);
    })();
  }, []);

  if (loading) return <div className="text-sm text-muted-foreground p-4">Loading dashboard…</div>;
  if (!d) return null;

  return (
    <div className="border rounded p-4 bg-blue-50/50 dark:bg-blue-500/10 dark:border-blue-500/30">
      <h3 className="text-sm font-semibold mb-3">My Task Dashboard</h3>
      <div className="grid grid-cols-5 gap-3 text-sm">
        <Metric label="Due today"     value={d.dueToday}       color="text-blue-700 dark:text-blue-300" />
        <Metric label="Overdue"       value={d.overdue}        color="text-red-700 dark:text-red-300" />
        <Metric label="Due this week" value={d.dueThisWeek}    color="text-yellow-700 dark:text-yellow-300" />
        <Metric label="Waiting"       value={d.waitingExternal} color="text-purple-700 dark:text-purple-300" />
        <Metric label="Done this week" value={d.completedThisWeek} color="text-green-700 dark:text-green-300" />
      </div>
      {Object.keys(d.byCategory).length > 0 && (
        <div className="mt-3 text-xs text-muted-foreground">
          Open by category:{" "}
          {Object.entries(d.byCategory).map(([cat, n]) => (
            <span key={cat} className="inline-block mr-3">{cat}: <strong>{n}</strong></span>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="border rounded bg-white dark:bg-slate-900 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-2xl font-semibold ${color}`}>{value}</div>
    </div>
  );
}
