"use client";

import * as React from "react";
import {
  TrendingUp, TrendingDown, Minus,
  Users, GraduationCap, Building2, CalendarDays, CalendarOff,
  ClipboardList, CheckSquare, CheckCircle, Briefcase, Target,
  BarChart2, FileText, Bell, Settings, Award, Clock,
  Globe, Megaphone, Handshake, AlertCircle, XCircle, RotateCcw,
  Mail, Phone, MapPin, User, Calendar,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICON_MAP: Record<string, React.ElementType> = {
  Users, GraduationCap, Building2, CalendarDays, CalendarOff,
  TrendingUp, ClipboardList, CheckSquare, CheckCircle, Briefcase,
  Target, BarChart2, FileText, Bell, Settings, Award, Clock,
  Globe, Megaphone, Handshake, AlertCircle, XCircle, RotateCcw,
  Mail, Phone, MapPin, User, Calendar,
};
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import {
  Area,
  AreaChart,
  ResponsiveContainer,
  Tooltip,
} from "recharts";

interface SparklineDataPoint {
  value: number;
}

interface StatCardProps {
  title: string;
  value: string | number;
  change?: number;
  changeLabel?: string;
  icon?: React.ElementType | string;
  iconColor?: string;
  iconBg?: string;
  sparklineData?: SparklineDataPoint[];
  sparklineColor?: string;
  className?: string;
  loading?: boolean;
  onClick?: () => void;
  href?: string;
}

export function StatCard({
  title,
  value,
  change,
  changeLabel = "vs last month",
  icon: iconProp,
  iconColor = "text-[#1E3A5F]",
  iconBg = "bg-[#1E3A5F]/10",
  sparklineData,
  sparklineColor = "#0EA5E9",
  className,
  loading = false,
  onClick,
  href,
}: StatCardProps) {
  const Icon = typeof iconProp === "string" ? ICON_MAP[iconProp] : iconProp;

  const isPositive = change !== undefined && change > 0;
  const isNegative = change !== undefined && change < 0;
  const isNeutral = change !== undefined && change === 0;

  const changeColor = isPositive
    ? "text-[#22C55E]"
    : isNegative
    ? "text-[#EF4444]"
    : "text-slate-500";

  const ChangeTrendIcon = isPositive
    ? TrendingUp
    : isNegative
    ? TrendingDown
    : Minus;

  if (loading) {
    return (
      <Card className={cn("overflow-hidden", className)}>
        <CardContent className="p-5">
          <div className="animate-pulse space-y-3">
            <div className="h-4 w-24 bg-slate-100 rounded" />
            <div className="h-8 w-32 bg-slate-100 rounded" />
            <div className="h-3 w-20 bg-slate-100 rounded" />
          </div>
        </CardContent>
      </Card>
    );
  }

  const card = (
    <Card
      className={cn(
        "overflow-hidden hover:shadow-md transition-shadow duration-200",
        (onClick || href) && "cursor-pointer active:scale-[0.98] transition-transform",
        className
      )}
      onClick={onClick}
    >
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-slate-500 truncate">{title}</p>
            <p className="mt-1.5 text-2xl font-bold text-slate-900 tracking-tight">
              {value}
            </p>

            {change !== undefined && (
              <div className="mt-2 flex items-center gap-1">
                <ChangeTrendIcon className={cn("h-3.5 w-3.5 shrink-0", changeColor)} />
                <span className={cn("text-xs font-semibold", changeColor)}>
                  {isPositive ? "+" : ""}
                  {change.toFixed(1)}%
                </span>
                <span className="text-xs text-slate-400">{changeLabel}</span>
              </div>
            )}
          </div>

          {Icon && (
            <div
              className={cn(
                "flex items-center justify-center h-10 w-10 rounded-xl shrink-0",
                iconBg
              )}
            >
              <Icon className={cn("h-5 w-5", iconColor)} />
            </div>
          )}
        </div>

        {sparklineData && sparklineData.length > 0 && (
          <div className="mt-4 h-12 -mx-1">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={sparklineData}
                margin={{ top: 0, right: 0, left: 0, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id={`spark-gradient-${title.replace(/\s/g, "-")}`}
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="5%"
                      stopColor={sparklineColor}
                      stopOpacity={0.3}
                    />
                    <stop
                      offset="95%"
                      stopColor={sparklineColor}
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-slate-900 text-white text-xs px-2 py-1 rounded shadow">
                          {payload[0].value}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="value"
                  stroke={sparklineColor}
                  strokeWidth={1.5}
                  fill={`url(#spark-gradient-${title.replace(/\s/g, "-")})`}
                  dot={false}
                  activeDot={{ r: 3, fill: sparklineColor }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );

  if (href) {
    return <Link href={href} className="block">{card}</Link>;
  }

  return card;
}
