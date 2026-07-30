"use client";

import * as React from "react";
import {
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LEAVE_TYPE_COLORS, leaveTypeLabel } from "@/lib/leave-policy";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DeptHeadcount {
  name: string;
  count: number;
}

interface LeaveUtilization {
  type: string;
  used: number;
  total: number;
}

interface HRDashboardStatsProps {
  deptHeadcount: DeptHeadcount[];
  leaveUtilization: LeaveUtilization[];
  trainingCompletion: number; // percentage 0-100
  perfScoreDistribution: { score: number }[];
}

// ─── Color palette ────────────────────────────────────────────────────────────

const COLORS = ["#1E3A5F", "#0EA5E9", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6"];


// ─── Component ────────────────────────────────────────────────────────────────

export function HRDashboardStats({
  deptHeadcount,
  leaveUtilization,
  trainingCompletion,
  perfScoreDistribution,
}: HRDashboardStatsProps) {
  // Convert trainingCompletion % to pie data
  const trainingData = [
    { name: "Completed", value: trainingCompletion },
    { name: "Pending", value: 100 - trainingCompletion },
  ];
  // Convert perfScores to distribution buckets
  const buckets: Record<string, number> = { "1-2": 0, "2-3": 0, "3-4": 0, "4-5": 0 };
  for (const p of perfScoreDistribution) {
    if (p.score < 2) buckets["1-2"]++;
    else if (p.score < 3) buckets["2-3"]++;
    else if (p.score < 4) buckets["3-4"]++;
    else buckets["4-5"]++;
  }
  const perfData = Object.entries(buckets).map(([range, count]) => ({ range, count }));
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Headcount by Department */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-700">
            Headcount by Department
          </CardTitle>
        </CardHeader>
        <CardContent>
          {deptHeadcount.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">No department data</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={deptHeadcount} margin={{ top: 0, right: 10, left: -10, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                  cursor={{ fill: "#f8fafc" }}
                />
                <Bar dataKey="count" fill="#1E3A5F" radius={[4, 4, 0, 0]} name="Employees" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Leave Utilization by Type */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-700">
            Leave Utilization by Type
          </CardTitle>
        </CardHeader>
        <CardContent>
          {leaveUtilization.filter((l) => l.total > 0).length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">No leave data</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={leaveUtilization
                  .filter((l) => l.total > 0)
                  .map((l) => ({
                    name: l.type.charAt(0) + l.type.slice(1).toLowerCase().replace("_", " "),
                    Allocated: l.total,
                    Used: l.used,
                  }))}
                margin={{ top: 0, right: 10, left: -10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
                <Tooltip
                  formatter={(value, name) => [`${value} days`, name] as [string, string]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
                <Legend formatter={(value) => <span style={{ fontSize: 11, color: "#64748b" }}>{value}</span>} />
                <Bar dataKey="Allocated" fill="#cbd5e1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Used" radius={[4, 4, 0, 0]}>
                  {leaveUtilization
                    .filter((l) => l.total > 0)
                    .map((entry, index) => (
                      <Cell key={entry.type} fill={(LEAVE_TYPE_COLORS as Record<string,string>)[entry.type] ?? COLORS[index % COLORS.length]} />
                    ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Training Completion Rate */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-700">
            Training Completion Rate
          </CardTitle>
        </CardHeader>
        <CardContent>
          {trainingCompletion === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">No training data</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={trainingData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={80}
                >
                  {trainingData.map((entry, index) => (
                    <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  formatter={(value) => [`${value}%`] as [string]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                />
                <Legend
                  formatter={(value) => (
                    <span style={{ fontSize: 11, color: "#64748b" }}>{value}</span>
                  )}
                />
              </PieChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Performance Score Distribution */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-semibold text-slate-700">
            Performance Score Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          {perfScoreDistribution.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">No performance data</p>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart
                data={perfData}
                margin={{ top: 0, right: 10, left: -10, bottom: 0 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                <XAxis
                  dataKey="range"
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11, fill: "#64748b" }}
                  axisLine={false}
                  tickLine={false}
                />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e2e8f0" }}
                  cursor={{ fill: "#f8fafc" }}
                />
                <Bar dataKey="count" fill="#0EA5E9" radius={[4, 4, 0, 0]} name="Employees" />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
