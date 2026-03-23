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

// Status tabs for Super Admin (sees everything)
const SUPER_ADMIN_TABS = [
  { label: "All",             status: "" },
  { label: "Draft",           status: "DRAFT" },
  { label: "Pending Review",  status: "PENDING_REVIEW" },
  { label: "Awaiting HQ",     status: "REGIONAL_APPROVED" },
  { label: "HQ Review",       status: "HQ_REVIEW" },
  { label: "Approved",        status: "FINAL_APPROVED" },
  { label: "Returned",        status: "RETURNED" },
] as const;

// Status tabs for HQ
const HQ_TABS = [
  { label: "Awaiting Review", status: "REGIONAL_APPROVED" },
  { label: "HQ Review",       status: "HQ_REVIEW" },
  { label: "Approved",        status: "FINAL_APPROVED" },
  { label: "Returned",        status: "RETURNED" },
  { label: "All",             status: "" },
] as const;

// Status tabs for RM
const RM_TABS = [
  { label: "Pending Review",  status: "PENDING_REVIEW" },
  { label: "Approved",        status: "REGIONAL_APPROVED" },
  { label: "Returned",        status: "RETURNED" },
  { label: "All",             status: "" },
] as const;

// Status tabs for ICR
const ICR_TABS = [
  { label: "Draft",           status: "DRAFT" },
  { label: "Under Review",    status: "PENDING_REVIEW" },
  { label: "Approved",        status: "FINAL_APPROVED" },
  { label: "Returned",        status: "RETURNED" },
  { label: "All",             status: "" },
] as const;

export function ReportQueueClient({
  userRole,
  isHQ,
  isRM,
  isICR,
  isSuperAdmin,
  summary,
}: ReportQueueClientProps) {
  const tabs = isSuperAdmin ? SUPER_ADMIN_TABS : isHQ ? HQ_TABS : isRM ? RM_TABS : ICR_TABS;
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

  // Stat cards config
  const statCards = isSuperAdmin
    ? [
        { title: "Draft",           value: summary.draft,            icon: "FileText" as const,    iconColor: "text-slate-500",   iconBg: "bg-slate-100",   status: "DRAFT" },
        { title: "Pending Review",  value: summary.pendingReview,    icon: "Clock" as const,       iconColor: "text-amber-600",   iconBg: "bg-amber-50",    status: "PENDING_REVIEW" },
        { title: "Final Approved",  value: summary.finalApproved,    icon: "CheckCircle" as const, iconColor: "text-emerald-600", iconBg: "bg-emerald-50",  status: "FINAL_APPROVED" },
        { title: "Returned",        value: summary.returned,         icon: "RotateCcw" as const,   iconColor: "text-red-500",     iconBg: "bg-red-50",      status: "RETURNED" },
      ]
    : isHQ
    ? [
        { title: "Awaiting HQ Review", value: summary.regionalApproved, icon: "ClipboardList" as const, iconColor: "text-blue-600", iconBg: "bg-blue-50", status: "REGIONAL_APPROVED" },
        { title: "In HQ Review",       value: summary.hqReview,         icon: "Clock" as const,    iconColor: "text-indigo-600", iconBg: "bg-indigo-50", status: "HQ_REVIEW" },
        { title: "Final Approved",     value: summary.finalApproved,    icon: "CheckCircle" as const, iconColor: "text-emerald-600", iconBg: "bg-emerald-50", status: "FINAL_APPROVED" },
        { title: "Returned",           value: summary.returned,         icon: "RotateCcw" as const, iconColor: "text-red-500", iconBg: "bg-red-50", status: "RETURNED" },
      ]
    : isRM
    ? [
        { title: "Pending Review", value: summary.pendingReview,    icon: "Clock" as const,       iconColor: "text-amber-600", iconBg: "bg-amber-50", status: "PENDING_REVIEW" },
        { title: "Approved",       value: summary.regionalApproved, icon: "CheckCircle" as const, iconColor: "text-emerald-600", iconBg: "bg-emerald-50", status: "REGIONAL_APPROVED" },
        { title: "Returned",       value: summary.returned,         icon: "RotateCcw" as const,   iconColor: "text-red-500", iconBg: "bg-red-50", status: "RETURNED" },
        { title: "Final Approved", value: summary.finalApproved,    icon: "Globe" as const,       iconColor: "text-sky-600", iconBg: "bg-sky-50", status: "FINAL_APPROVED" },
      ]
    : [
        { title: "Draft",        value: summary.draft,         icon: "FileText" as const,    iconColor: "text-slate-500", iconBg: "bg-slate-100", status: "DRAFT" },
        { title: "Under Review", value: summary.pendingReview, icon: "Clock" as const,       iconColor: "text-amber-600", iconBg: "bg-amber-50", status: "PENDING_REVIEW" },
        { title: "Approved",     value: summary.finalApproved, icon: "CheckCircle" as const, iconColor: "text-emerald-600", iconBg: "bg-emerald-50", status: "FINAL_APPROVED" },
        { title: "Returned",     value: summary.returned,      icon: "RotateCcw" as const,   iconColor: "text-red-500", iconBg: "bg-red-50", status: "RETURNED" },
      ];

  return (
    <div className="space-y-6">
      {/* Stat cards — clicking filters the list */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
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
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map((tab) => (
          <button
            key={tab.status}
            onClick={() => handleTabChange(tab.status)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              activeStatus === tab.status
                ? "border-[#1E3A5F] text-[#1E3A5F]"
                : "border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300"
            )}
          >
            {tab.label}
            {tab.status && (() => {
              const count =
                tab.status === "DRAFT" ? summary.draft
                : tab.status === "PENDING_REVIEW" ? summary.pendingReview
                : tab.status === "REGIONAL_APPROVED" ? summary.regionalApproved
                : tab.status === "HQ_REVIEW" ? summary.hqReview
                : tab.status === "FINAL_APPROVED" ? summary.finalApproved
                : tab.status === "RETURNED" ? summary.returned
                : null;
              return count !== null && count > 0 ? (
                <span className="ml-1.5 px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-600 text-xs">
                  {count}
                </span>
              ) : null;
            })()}
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
