"use client";

import * as React from "react";
import { TrendingUp, TrendingDown, DollarSign, Users, GraduationCap } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency, formatPercent, cn } from "@/lib/utils";

// ─── Types ─────────────────────────────────────────────────────────────────

interface ROICardProps {
  totalCost: number;
  leadsCount: number;
  enrollmentsCount: number;
  budget: number | null;
}

// ─── Constants ─────────────────────────────────────────────────────────────

const AVG_ENROLLMENT_VALUE = 5000; // USD

// ─── Component ─────────────────────────────────────────────────────────────

export function ROICard({
  totalCost,
  leadsCount,
  enrollmentsCount,
  budget,
}: ROICardProps) {
  const roi =
    totalCost > 0
      ? ((enrollmentsCount * AVG_ENROLLMENT_VALUE - totalCost) / totalCost) * 100
      : null;

  const costPerLead = leadsCount > 0 && totalCost > 0 ? totalCost / leadsCount : null;
  const costPerEnrollment =
    enrollmentsCount > 0 && totalCost > 0 ? totalCost / enrollmentsCount : null;

  const isPositive = roi !== null && roi >= 0;

  return (
    <Card className="border-slate-200">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          {roi !== null ? (
            isPositive ? (
              <TrendingUp className="h-4 w-4 text-green-500" />
            ) : (
              <TrendingDown className="h-4 w-4 text-red-500" />
            )
          ) : (
            <TrendingUp className="h-4 w-4 text-slate-400" />
          )}
          ROI Summary
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* ROI % */}
        <div className="text-center py-4 bg-slate-50 rounded-xl">
          {roi !== null ? (
            <>
              <p
                className={cn(
                  "text-4xl font-bold tracking-tight",
                  isPositive ? "text-green-600" : "text-red-600"
                )}
              >
                {isPositive ? "+" : ""}
                {formatPercent(roi)}
              </p>
              <p className="text-xs text-slate-500 mt-1">Return on Investment</p>
            </>
          ) : (
            <>
              <p className="text-4xl font-bold text-slate-300">—</p>
              <p className="text-xs text-slate-400 mt-1">No costs recorded yet</p>
            </>
          )}
        </div>

        {/* Metrics grid */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm text-slate-600">
              <DollarSign className="h-4 w-4 text-slate-400" />
              Total Cost
            </div>
            <span className="text-sm font-semibold text-slate-900">
              {formatCurrency(totalCost)}
            </span>
          </div>

          {budget !== null && (
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <DollarSign className="h-4 w-4 text-slate-400" />
                Budget
              </div>
              <span className="text-sm font-semibold text-slate-900">
                {formatCurrency(budget)}
              </span>
            </div>
          )}

          <div className="border-t border-slate-100 pt-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <Users className="h-4 w-4 text-slate-400" />
                Leads Generated
              </div>
              <span className="text-sm font-semibold text-slate-900">{leadsCount}</span>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-slate-600">
                <GraduationCap className="h-4 w-4 text-slate-400" />
                Enrollments
              </div>
              <span className="text-sm font-semibold text-green-700">
                {enrollmentsCount}
              </span>
            </div>
          </div>

          <div className="border-t border-slate-100 pt-3 space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">Cost per Lead</span>
              <span className="text-sm font-semibold text-slate-900">
                {costPerLead !== null ? formatCurrency(costPerLead) : "—"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-600">Cost per Enrollment</span>
              <span className="text-sm font-semibold text-slate-900">
                {costPerEnrollment !== null ? formatCurrency(costPerEnrollment) : "—"}
              </span>
            </div>
          </div>
        </div>

        {/* Formula note */}
        <p className="text-[11px] text-slate-400 border-t border-slate-100 pt-3">
          ROI = ((Enrollments × $5,000) − Cost) / Cost × 100
        </p>
      </CardContent>
    </Card>
  );
}
