"use client";

import Link from "next/link";
import { Eye, Download, ChevronLeft, ChevronRight } from "lucide-react";
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
  DRAFT: { label: "Draft", className: "bg-slate-100 text-slate-600 border-slate-200" },
  PENDING_REVIEW: { label: "Submitted", className: "bg-blue-100 text-blue-800 border-blue-200" },
  REGIONAL_APPROVED: { label: "Submitted", className: "bg-blue-100 text-blue-800 border-blue-200" },
  HQ_REVIEW: { label: "Submitted", className: "bg-blue-100 text-blue-800 border-blue-200" },
  FINAL_APPROVED: { label: "Submitted", className: "bg-blue-100 text-blue-800 border-blue-200" },
  RETURNED: { label: "Submitted", className: "bg-blue-100 text-blue-800 border-blue-200" },
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
      <div className="text-center py-16 text-slate-400 text-sm border border-dashed border-slate-200 rounded-xl">
        No reports found.
      </div>
    );
  }

  return (
    <>
      <div className="flex justify-end mb-3">
        <ExportButton
          data={reports.map((r) => ({
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
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 hover:bg-slate-50">
              <TableHead className="text-xs font-semibold text-slate-500">ICR</TableHead>
              <TableHead className="text-xs font-semibold text-slate-500">Institution</TableHead>
              <TableHead className="text-xs font-semibold text-slate-500">Period</TableHead>
              <TableHead className="text-xs font-semibold text-slate-500">Status</TableHead>
              <TableHead className="text-xs font-semibold text-slate-500">Created</TableHead>
              <TableHead className="text-xs font-semibold text-slate-500 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.map((report) => (
              <TableRow key={report.id} className="hover:bg-slate-50/50">
                <TableCell className="text-sm font-medium text-slate-800">
                  {report.icr.name ?? report.icr.email}
                </TableCell>
                <TableCell className="text-sm text-slate-600">{report.institution.name}</TableCell>
                <TableCell className="text-sm text-slate-600">
                  {MONTH_NAMES[report.reportingMonth]} {report.reportingYear}
                </TableCell>
                <TableCell>
                  <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_CONFIG[report.status].className}`}>
                    {STATUS_CONFIG[report.status].label}
                  </span>
                </TableCell>
                <TableCell className="text-xs text-slate-500">
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
          <p className="text-sm text-slate-500">
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
