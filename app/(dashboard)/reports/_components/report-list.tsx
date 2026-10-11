"use client";

import Link from "next/link";
import { useState } from "react";
import { Eye, Download, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { ExportButton } from "@/components/shared/export-button";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

export type ReportStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "REGIONAL_APPROVED"
  | "HQ_REVIEW"
  | "FINAL_APPROVED"
  | "RETURNED";

export interface ReportRow {
  id: string;
  icr: { id: string; name: string | null; email: string };
  institution: { id: string; name: string };
  reportingMonth: number;
  reportingYear: number;
  status: ReportStatus;
  submittedAt: string | null;
  finalApprovedAt: string | null;
  pdfUrl: string | null;
}

interface ReportListProps {
  reports: ReportRow[];
  loading?: boolean;
  userRole: string;
  pagination?: { page: number; totalPages: number };
  onPageChange?: (page: number) => void;
  onRefresh?: () => void;
}

const MONTH_NAMES = ["", "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const STATUS_CONFIG: Record<ReportStatus, { label: string; className: string }> = {
  DRAFT: { label: "Draft", className: "bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700" },
  PENDING_REVIEW: { label: "Submitted", className: "bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-500/30" },
  REGIONAL_APPROVED: { label: "Submitted", className: "bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-500/30" },
  HQ_REVIEW: { label: "Submitted", className: "bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-500/30" },
  FINAL_APPROVED: { label: "Submitted", className: "bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-500/30" },
  RETURNED: { label: "Submitted", className: "bg-blue-100 dark:bg-blue-500/15 text-blue-800 dark:text-blue-300 border-blue-200 dark:border-blue-500/30" },
};

export function ReportList({
  reports,
  loading = false,
  pagination,
  onPageChange,
}: ReportListProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {Array(5).fill(0).map((_, i) => (
          <Skeleton key={i} className="h-14 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!reports.length) {
    return (
      <div className="text-center py-16 text-slate-400 dark:text-slate-500 text-sm border border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
        No reports found.
      </div>
    );
  }

  // No way to find a report existed on this screen at all.
  const [search, setSearch] = useState("");
  const q = search.trim().toLowerCase();
  const shown = !q ? reports : reports.filter((r) =>
    [
      r.icr.name ?? "", r.icr.email, r.institution.name,
      `${MONTH_NAMES[r.reportingMonth]} ${r.reportingYear}`,
      STATUS_CONFIG[r.status].label,
    ].join(" ").toLowerCase().includes(q));

  return (
    <>
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400 pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search ICR, institution, period or status…"
            className="pl-9 h-9 w-80"
          />
        </div>
        <span className="text-sm text-muted-foreground ml-auto">
          {shown.length} of {reports.length}
        </span>
        {/* The export follows the search, so the file matches the screen. */}
        <ExportButton
          data={shown.map((r) => ({
            icr: r.icr.name ?? r.icr.email,
            institution: r.institution.name,
            period: `${MONTH_NAMES[r.reportingMonth]} ${r.reportingYear}`,
            status: STATUS_CONFIG[r.status].label,
            created: r.submittedAt
              ? new Date(r.submittedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
              : "—",
          }))}
          columns={[
            { key: "icr", header: "ICR" },
            { key: "institution", header: "Institution" },
            { key: "period", header: "Period" },
            { key: "status", header: "Status" },
            { key: "created", header: "Created" },
          ]}
          filename="reports"
          title="Export Reports"
        />
      </div>
      <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 dark:bg-slate-900/40 hover:bg-slate-50 dark:hover:bg-slate-900/40">
              <TableHead className="text-xs font-semibold text-slate-500 dark:text-slate-400">ICR</TableHead>
              <TableHead className="text-xs font-semibold text-slate-500 dark:text-slate-400">Institution</TableHead>
              <TableHead className="text-xs font-semibold text-slate-500 dark:text-slate-400">Period</TableHead>
              <TableHead className="text-xs font-semibold text-slate-500 dark:text-slate-400">Status</TableHead>
              <TableHead className="text-xs font-semibold text-slate-500 dark:text-slate-400">Created</TableHead>
              <TableHead className="text-xs font-semibold text-slate-500 dark:text-slate-400 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="p-8 text-center text-muted-foreground text-sm">
                  No reports match &ldquo;{search}&rdquo;.
                </TableCell>
              </TableRow>
            ) : shown.map((report) => (
              <TableRow key={report.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/60">
                <TableCell className="text-sm font-medium text-slate-800 dark:text-slate-200">
                  {report.icr.name ?? report.icr.email}
                </TableCell>
                <TableCell className="text-sm text-slate-600 dark:text-slate-300">{report.institution.name}</TableCell>
                <TableCell className="text-sm text-slate-600 dark:text-slate-300">
                  {MONTH_NAMES[report.reportingMonth]} {report.reportingYear}
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_CONFIG[report.status].className}`}>
                    {STATUS_CONFIG[report.status].label}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-slate-500 dark:text-slate-400">
                  {report.submittedAt
                    ? new Date(report.submittedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
                    : "—"}
                </TableCell>
                <TableCell>
                  <div className="flex items-center justify-end gap-1">
                    <Button variant="ghost" size="sm" asChild className="h-7 px-2">
                      <Link href={`/reports/${report.id}`}>
                        <Eye className="h-3.5 w-3.5 mr-1" /> View
                      </Link>
                    </Button>
                    {report.pdfUrl && (
                      <Button variant="ghost" size="sm" className="h-7 px-2" asChild>
                        <a href={report.pdfUrl} target="_blank" rel="noopener noreferrer">
                          <Download className="h-3.5 w-3.5 mr-1" /> PDF
                        </a>
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Page {pagination.page} of {pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => onPageChange?.(pagination.page - 1)} disabled={pagination.page <= 1}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button variant="outline" size="sm" onClick={() => onPageChange?.(pagination.page + 1)} disabled={pagination.page >= pagination.totalPages}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
