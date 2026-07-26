"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatCurrency, formatPercent } from "@/lib/utils";
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
    deliverablesPending: number;
    deliverablesCompleted: number;
  };
  budget: { total: number | null; used: number | null };
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

export function GovernanceTab({ stats, budget, kpis, recentActivities }: GovernanceTabProps) {
  const budgetPct = budget.total && budget.total > 0
    ? (budget.used ?? 0) / budget.total
    : null;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Target className="h-4 w-4 text-cyan-600" />
              <span className="text-xs text-slate-500">Pipeline</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{stats.totalLeads}</p>
            <p className="text-xs text-green-600 mt-1">{stats.enrolledCount} enrolled</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Activity className="h-4 w-4 text-blue-600" />
              <span className="text-xs text-slate-500">Activities</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{stats.activitiesCount}</p>
            <p className="text-xs text-slate-500 mt-1">delivered</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="h-4 w-4 text-emerald-600" />
              <span className="text-xs text-slate-500">Budget</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">
              {budget.total ? formatCurrency(budget.used ?? 0) : "—"}
            </p>
            {budgetPct !== null && (
              <p className={`text-xs mt-1 ${budgetPct > 0.9 ? "text-red-600" : "text-slate-500"}`}>
                {formatPercent(budgetPct)} of {formatCurrency(budget.total!)}
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="text-xs text-slate-500">Open Issues</span>
            </div>
            <p className="text-2xl font-bold text-slate-900">{stats.openRisks + stats.openCompliance}</p>
            <p className="text-xs text-slate-500 mt-1">
              {stats.openRisks} risks · {stats.openCompliance} compliance
            </p>
          </CardContent>
        </Card>
      </div>

      {/* KPI Achievement */}
      {kpis.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-700">KPI Achievement</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {kpis.map((kpi) => {
              const pct = kpi.targetValue > 0 ? kpi.currentValue / kpi.targetValue : 0;
              return (
                <div key={kpi.id}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm text-slate-700">{kpi.name}</span>
                    <span className="text-xs text-slate-500">
                      {kpi.currentValue} / {kpi.targetValue} {kpi.unit}
                    </span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
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
            <CardTitle className="text-sm font-semibold text-slate-700">Delivery Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-green-500" />
                <span className="text-sm text-slate-600">{stats.deliverablesCompleted} completed</span>
              </div>
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-amber-500" />
                <span className="text-sm text-slate-600">{stats.deliverablesPending} pending</span>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-semibold text-slate-700">Recent Activities</CardTitle>
          </CardHeader>
          <CardContent>
            {recentActivities.length === 0 ? (
              <p className="text-sm text-slate-400">No activities recorded yet.</p>
            ) : (
              <div className="space-y-3">
                {recentActivities.slice(0, 5).map((a) => (
                  <div key={a.id} className="flex items-start gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-500 mt-2 shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm text-slate-700 truncate">{a.title}</p>
                      <p className="text-xs text-slate-400">
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
