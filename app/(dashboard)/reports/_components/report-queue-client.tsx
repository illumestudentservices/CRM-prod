"use client";

import { useState, useEffect, useCallback } from "react";
import { StatCard } from "@/components/shared/stat-card";
import { ReportList, type ReportRow } from "./report-list";
import { cn } from "@/lib/utils";

interface Summary {
  draft: number;
  pendingReview: number;
  regionalApproved: number;
  hqReview: number;
  finalApproved: number;
  returned: number;
}

interface ReportQueueClientProps {
  userRole: string;
  isHQ: boolean;
  isRM: boolean;
  isICR: boolean;
  isSuperAdmin: boolean;
  summary: Summary;
}

interface ApiResponse {
  reports: ReportRow[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}

const TABS = [
  { label: "All",   status: "" },
  { label: "Draft", status: "DRAFT" },
] as const;

export function ReportQueueClient({
  userRole,
  isHQ,
  isRM,
  isICR,
  isSuperAdmin,
  summary,
}: ReportQueueClientProps) {
  const tabs = TABS;
  const [activeStatus, setActiveStatus] = useState<string>(tabs[0].status);
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);

  const fetchReports = useCallback(async (currentPage: number, status: string) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(currentPage), limit: "20" });
      if (status) params.set("status", status);
      const res = await fetch(`/api/reports?${params.toString()}`);
      if (!res.ok) {
        console.error("Failed to fetch reports:", res.status);
        return;
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      console.error("Error fetching reports:", e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchReports(page, activeStatus);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, activeStatus]);

  function handleTabChange(status: string) {
    if (status === activeStatus) return;
    setPage(1);
    setActiveStatus(status);
  }

  const total = summary.draft + summary.pendingReview + summary.finalApproved + summary.returned;
  const statCards = [
    { title: "Total Reports", value: total,         icon: "FileText" as const,    iconColor: "text-[#1E3A5F] dark:text-blue-300",   iconBg: "bg-[#1E3A5F]/10 dark:bg-blue-500/15", status: "" },
    { title: "Draft",         value: summary.draft,  icon: "ClipboardList" as const, iconColor: "text-slate-500 dark:text-slate-400",   iconBg: "bg-slate-100 dark:bg-slate-800",    status: "DRAFT" },
  ];

  return (
    <div className="space-y-6">
      {/* Stat cards — clicking filters the list */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {statCards.map((card) => (
          <StatCard
            key={card.title}
            title={card.title}
            value={card.value}
            icon={card.icon}
            iconColor={cn(card.iconColor, activeStatus === card.status && "ring-2 ring-offset-2")}
            iconBg={card.iconBg}
            className={cn(
              "cursor-pointer transition-all",
              activeStatus === card.status && "ring-2 ring-[#1E3A5F] ring-offset-1"
            )}
            onClick={() => handleTabChange(card.status)}
          />
        ))}
      </div>

      {/* Status tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
        {tabs.map((tab) => (
          <button
            key={tab.status}
            onClick={() => handleTabChange(tab.status)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeStatus === tab.status
                ? "border-[#1E3A5F] text-[#1E3A5F] dark:border-blue-400 dark:text-blue-300"
                : "border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:border-slate-300 dark:hover:border-slate-600"
            )}
          >
            {tab.label}
            {tab.status === "DRAFT" && summary.draft > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs">
                {summary.draft}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Report list */}
      <ReportList
        reports={data?.reports ?? []}
        loading={loading}
        userRole={userRole}
        pagination={data?.pagination}
        onPageChange={(p) => setPage(p)}
        onRefresh={() => fetchReports(page, activeStatus)}
      />
    </div>
  );
}
