"use client";

import { useState } from "react";
import Link from "next/link";
import { Plus, FileText, CalendarRange, BarChart3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ReportQueueClient } from "./report-queue-client";
import { WeeklyActivitiesPanel } from "./weekly-activities-panel";

interface Summary {
  draft: number;
  pendingReview: number;
  regionalApproved: number;
  hqReview: number;
  finalApproved: number;
  returned: number;
}

interface ReportsTabsProps {
  userRole: string;
  isHQ: boolean;
  isRM: boolean;
  isICR: boolean;
  isSuperAdmin: boolean;
  canCreate: boolean;
  summary: Summary;
}

type TopTab = "monthly" | "weekly" | "qbr";

export function ReportsTabs({
  userRole,
  isHQ,
  isRM,
  isICR,
  isSuperAdmin,
  canCreate,
  summary,
}: ReportsTabsProps) {
  const [tab, setTab] = useState<TopTab>("monthly");

  const showQBRTab = isHQ || isRM;

  return (
    <div className="space-y-6">
      {/* Top-level switcher + contextual action */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl w-fit">
          <button
            onClick={() => setTab("monthly")}
            className={cn(
              "flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-150",
              tab === "monthly"
                ? "bg-white dark:bg-slate-900 shadow-sm text-slate-900 dark:text-slate-100"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            )}
          >
            <FileText className="h-4 w-4" />
            Monthly Reports
          </button>
          <button
            onClick={() => setTab("weekly")}
            className={cn(
              "flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-150",
              tab === "weekly"
                ? "bg-white dark:bg-slate-900 shadow-sm text-slate-900 dark:text-slate-100"
                : "text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200"
            )}
          >
            <CalendarRange className="h-4 w-4" />
            Weekly Activities
          </button>
          {showQBRTab && (
            <Link
              href="/reports/qbr"
              className={cn(
                "flex items-center gap-2 px-4 py-1.5 rounded-lg text-sm font-medium transition-all duration-150",
                tab === "qbr"
                  ? "bg-white dark:bg-slate-900 shadow-sm text-slate-900 dark:text-slate-100"
                  : "text-slate-500 hover:text-slate-800"
              )}
            >
              <BarChart3 className="h-4 w-4" />
              QBR
            </Link>
          )}
        </div>

        {tab === "monthly" && canCreate && (
          <Button asChild className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white">
            <Link href="/reports/new">
              <Plus className="h-4 w-4 mr-2" />
              New Report
            </Link>
          </Button>
        )}
      </div>

      {tab === "monthly" ? (
        <ReportQueueClient
          userRole={userRole}
          isHQ={isHQ}
          isRM={isRM}
          isICR={isICR}
          isSuperAdmin={isSuperAdmin}
          summary={summary}
        />
      ) : (
        <WeeklyActivitiesPanel role={userRole} isICR={isICR} />
      )}
    </div>
  );
}
