"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { useChartTheme } from "@/hooks/use-chart-theme";

interface MonthDataPoint {
  month: string;
  current: number;
  lastYear: number;
}

interface LeadsTrendChartProps {
  data: MonthDataPoint[];
}

const CustomTooltip = ({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) => {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg shadow-lg p-3 text-sm">
      <p className="font-semibold text-slate-700 dark:text-slate-300 mb-1">{label}</p>
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
          <span className="text-slate-500 dark:text-slate-400">{entry.name}:</span>
          <span className="font-semibold text-slate-800 dark:text-slate-200">{entry.value}</span>
        </div>
      ))}
    </div>
  );
};

export function LeadsTrendChart({ data }: LeadsTrendChartProps) {
  const chart = useChartTheme();
  return (
    <ResponsiveContainer width="100%" height={280}>
      <LineChart data={data} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={chart.grid} vertical={false} />
        <XAxis
          dataKey="month"
          tick={{ ...chart.tickStyle, fontSize: 12 }}
          axisLine={{ stroke: chart.axis }}
          tickLine={false}
        />
        <YAxis
          tick={{ ...chart.tickStyle, fontSize: 12 }}
          axisLine={false}
          tickLine={false}
          width={35}
        />
        <Tooltip content={<CustomTooltip />} />
        <Legend
          wrapperStyle={{ fontSize: "12px", paddingTop: "12px" }}
          iconType="circle"
          iconSize={8}
        />
        <Line
          type="monotone"
          dataKey="current"
          name="This Year"
          stroke="#0EA5E9"
          strokeWidth={2.5}
          dot={{ fill: "#0EA5E9", r: 3, strokeWidth: 0 }}
          activeDot={{ r: 5, fill: "#0EA5E9", strokeWidth: 0 }}
        />
        <Line
          type="monotone"
          dataKey="lastYear"
          name="Last Year"
          stroke={chart.axisText}
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={{ fill: chart.axisText, r: 3, strokeWidth: 0 }}
          activeDot={{ r: 5, fill: chart.axisText, strokeWidth: 0 }}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
