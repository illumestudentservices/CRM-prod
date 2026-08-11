"use client";

import * as React from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useChartTheme } from "@/hooks/use-chart-theme";

interface EnrollmentTarget {
  id: string;
  year: number;
  target: number;
  actual: number;
}

interface EnrollmentChartProps {
  targets: EnrollmentTarget[];
}

export function EnrollmentChart({ targets }: EnrollmentChartProps) {
  const chart = useChartTheme();
  if (targets.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
        No enrollment data available yet.
      </div>
    );
  }

  const data = targets.map((t) => ({
    year: t.year.toString(),
    Target: t.target,
    Actual: t.actual,
  }));

  return (
    <div className="h-64 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} />
          <XAxis
            dataKey="year"
            tick={{ ...chart.tickStyle, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ ...chart.tickStyle, fontSize: 12 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={chart.tooltipCursor}
            contentStyle={chart.tooltipContentStyle}
          />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }}
          />
          <Bar dataKey="Target" fill={chart.neutralSeries} radius={[4, 4, 0, 0]} maxBarSize={48} />
          <Bar dataKey="Actual" fill="#1E3A5F" radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
