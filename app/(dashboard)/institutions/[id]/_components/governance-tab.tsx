"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatPercent } from "@/lib/utils";
import { HEALTH_LABELS } from "@/lib/account-health";
import {
  CheckCircle2, AlertTriangle, Clock, TrendingUp,
  DollarSign, Target, Activity, Users,
} from "lucide-react";

interface GovernanceTabProps {
  stats: {
    totalLeads: number;
    enrolledCount: number;
    activitiesCount: number;
    openRisks: number;
    openCompliance: number;
    openIssues?: number;
    deliverablesPending: number;
    deliverablesCompleted: number;
  };
  /// Spec §11 — traffic-light account health, replacing the old numeric
  /// healthScore. `null` for GREY (not assessed). Optional to keep this
  /// component tolerant during rollout.
  accountHealth?: "GREEN" | "AMBER" | "RED" | "GREY" | null;
  kpis: Array<{
    id: string;
    name: string;
    category: string;
    targetValue: number;
    currentValue: number;
    unit: string;
  }>;
  recentActivities: Array<{
    id: string;
    title: string;
    type: string;
    date: string | Date;
    outcomes: string | null;
  }>;
}

/**
 * Spec §11 — traffic-light presentation.
 *
 * The label comes from lib/account-health.ts. This tile used to say "Healthy"
 * where the panel directly below it said "Green" and the client list said
 * "Alarmed" — three names for one column on a single screen. The captions stay
 * local because they describe what to do about the rating rather than what it
 * is called.
 */
const HEALTH_CONFIG: Record<
  "GREEN" | "AMBER" | "RED" | "GREY",
  { label: string; className: string; caption: string }
> = {
  GREEN: {
    label: HEALTH_LABELS.GREEN.sentiment,
    className: "bg-green-100 text-green-700 border-green-200 dark:bg-green-500/15 dark:text-green-300 dark:border-green-500/30",
    caption: "On track",
  },
  AMBER: {
    label: HEALTH_LABELS.AMBER.sentiment,
    className: "bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:border-amber-500/30",
    caption: "Needs review",
  },
  RED: {
    label: HEALTH_LABELS.RED.sentiment,
    className: "bg-red-100 text-red-700 border-red-200 dark:bg-red-500/15 dark:text-red-300 dark:border-red-500/30",
    caption: "Action required",
  },
  GREY: {
    label: HEALTH_LABELS.GREY.sentiment,
    className: "bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700",
    caption: "Set by Account Manager",
  },
};

export function GovernanceTab({ stats, accountHealth, kpis, recentActivities }: GovernanceTabProps) {
  const health = accountHealth ?? "GREY";
  const healthCfg = HEALTH_CONFIG[health];
  // Prefer the new dedicated open-issues count if present, else fall back to
  // the legacy risks+compliance stand-in.
  const openIssues = stats.openIssues ?? stats.openRisks + stats.openCompliance;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-4 w-4 text-cyan-600" />
              <span className="text-xs text-slate-500 dark:text-slate-400">Pipeline</span>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{stats.totalLeads}</p>
            <p className="text-xs text-green-600 dark:text-green-400 mt-1">{stats.enrolledCount} enrolled</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4 text-blue-600" />
              <span className="text-xs text-slate-500 dark:text-slate-400">Activities</span>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{stats.activitiesCount}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">delivered</p>
          </CardContent>
        </Card>
        {/* Spec §11 — Account Health replaces the (spec-forbidden) Budget card. */}
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="h-4 w-4 text-emerald-600" />
              <span className="text-xs text-slate-500 dark:text-slate-400">Account Health</span>
            </div>
            <Badge variant="outline" className={healthCfg.className}>
              {healthCfg.label}
            </Badge>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">{healthCfg.caption}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="text-xs text-slate-500 dark:text-slate-400">Open Issues</span>
            </div>
            <p className="text-2xl font-bold text-slate-900 dark:text-slate-100">{openIssues}</p>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              {stats.openIssues !== undefined
                ? "client issues"
                : `${stats.openRisks} risks · ${stats.openCompliance} compliance`}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* KPI Achievement */}
      {kpis.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">KPI Achievement</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {kpis.map((kpi) => {
              const pct = kpi.targetValue > 0 ? kpi.currentValue / kpi.targetValue : 0;
              return (
                <div key={kpi.id}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm text-slate-700 dark:text-slate-300">{kpi.name}</span>
                    <span className="text-xs text-slate-500 dark:text-slate-400">
                      {kpi.currentValue} / {kpi.targetValue} {kpi.unit}
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        pct >= 1 ? "bg-green-500" : pct >= 0.7 ? "bg-cyan-500" : pct >= 0.4 ? "bg-amber-500" : "bg-red-500"
                      }`}
                      style={{ width: `${Math.min(pct * 100, 100)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}

      {/* Deliverables + Recent Activities side by side */}
      <div className="grid lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Delivery Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm text-slate-600 dark:text-slate-400">{stats.deliverablesCompleted} completed</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-500" />
                <span className="text-sm text-slate-600 dark:text-slate-400">{stats.deliverablesPending} pending</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-700 dark:text-slate-300">Recent Activities</CardTitle>
          </CardHeader>
          <CardContent>
            {recentActivities.length === 0 ? (
              <p className="text-sm text-slate-400 dark:text-slate-500">No activities recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {recentActivities.slice(0, 5).map((a) => (
                  <div key={a.id} className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 mt-2 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-slate-700 dark:text-slate-300 truncate">{a.title}</p>
                      <p className="text-xs text-slate-400 dark:text-slate-500">
                        {a.type.replace(/_/g, " ")} ·{" "}
                        {new Date(a.date).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
