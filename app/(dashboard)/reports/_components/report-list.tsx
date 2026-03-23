"use client";

import { useState } from "react";
import Link from "next/link";
import { Eye, CheckCircle, XCircle, Download, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
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
  PENDING_REVIEW: { label: "Pending Review", className: "bg-amber-100 text-amber-800 border-amber-200" },
  REGIONAL_APPROVED: { label: "Regionally Approved", className: "bg-blue-100 text-blue-800 border-blue-200" },
  HQ_REVIEW: { label: "HQ Review", className: "bg-indigo-100 text-indigo-800 border-indigo-200" },
  FINAL_APPROVED: { label: "Final Approved", className: "bg-green-100 text-green-800 border-green-200" },
  RETURNED: { label: "Returned", className: "bg-red-100 text-red-800 border-red-200" },
};

const CAN_APPROVE: Record<string, ReportStatus[]> = {
  REGIONAL_MANAGER: ["PENDING_REVIEW"],
  HQ_EXECUTIVE: ["REGIONAL_APPROVED", "HQ_REVIEW"],
  HQ_ANALYTICS: ["REGIONAL_APPROVED", "HQ_REVIEW"],
  SUPER_ADMIN: ["PENDING_REVIEW", "REGIONAL_APPROVED", "HQ_REVIEW"],
};

export function ReportList({
  reports,
  loading = false,
  userRole,
  pagination,
  onPageChange,
  onRefresh,
}: ReportListProps) {
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnComment, setReturnComment] = useState("");
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const approveableStatuses = CAN_APPROVE[userRole] ?? [];

  async function handleApprove(reportId: string) {
    setActionLoading(reportId);
    try {
      const isHQ = ["HQ_EXECUTIVE", "HQ_ANALYTICS", "SUPER_ADMIN"].includes(userRole);
      const action = isHQ ? "FINAL_APPROVE" : "APPROVE";
      const res = await fetch(`/api/reports/${reportId}/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "Failed to approve");
        return;
      }
      onRefresh?.();
    } finally {
      setActionLoading(null);
    }
  }

  async function handleReturn() {
    if (!selectedReportId || !returnComment.trim()) return;
    setActionLoading(selectedReportId);
    try {
      const res = await fetch(`/api/reports/${selectedReportId}/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "RETURN", comment: returnComment }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(err.error ?? "Failed to return report");
        return;
      }
      setReturnDialogOpen(false);
      setReturnComment("");
      setSelectedReportId(null);
      onRefresh?.();
    } finally {
      setActionLoading(null);
    }
  }

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
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow className="bg-slate-50 hover:bg-slate-50">
              <TableHead className="text-xs font-semibold text-slate-500">ICR</TableHead>
              <TableHead className="text-xs font-semibold text-slate-500">Institution</TableHead>
              <TableHead className="text-xs font-semibold text-slate-500">Period</TableHead>
              <TableHead className="text-xs font-semibold text-slate-500">Status</TableHead>
              <TableHead className="text-xs font-semibold text-slate-500">Submitted</TableHead>
              <TableHead className="text-xs font-semibold text-slate-500">Approved</TableHead>
              <TableHead className="text-xs font-semibold text-slate-500 text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reports.map((report) => {
              const canApproveThis = approveableStatuses.includes(report.status);
              const isActioning = actionLoading === report.id;

              return (
                <TableRow key={report.id} className="hover:bg-slate-50/50">
                  <TableCell className="text-sm font-medium text-slate-800">
                    {report.icr.name ?? report.icr.email}
                  </TableCell>
                  <TableCell className="text-sm text-slate-600">{report.institution.name}</TableCell>
                  <TableCell className="text-sm text-slate-600">
                    {MONTH_NAMES[report.reportingMonth]} {report.reportingYear}
                  </TableCell>
                  <TableCell>
                    <span
                      className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_CONFIG[report.status].className}`}
                    >
                      {STATUS_CONFIG[report.status].label}
                    </span>
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {report.submittedAt
                      ? new Date(report.submittedAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "—"}
                  </TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {report.finalApprovedAt
                      ? new Date(report.finalApprovedAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "—"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center justify-end gap-1">
                      <Button variant="ghost" size="sm" asChild className="h-7 px-2">
                        <Link href={`/reports/${report.id}`}>
                          <Eye className="h-3.5 w-3.5 mr-1" />
                          View
                        </Link>
                      </Button>

                      {canApproveThis && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[#22C55E] hover:text-[#22C55E] hover:bg-green-50"
                          disabled={isActioning}
                          onClick={() => handleApprove(report.id)}
                        >
                          <CheckCircle className="h-3.5 w-3.5 mr-1" />
                          Approve
                        </Button>
                      )}

                      {canApproveThis && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-[#EF4444] hover:text-[#EF4444] hover:bg-red-50"
                          disabled={isActioning}
                          onClick={() => {
                            setSelectedReportId(report.id);
                            setReturnDialogOpen(true);
                          }}
                        >
                          <XCircle className="h-3.5 w-3.5 mr-1" />
                          Return
                        </Button>
                      )}

                      {report.pdfUrl && (
                        <Button variant="ghost" size="sm" className="h-7 px-2" asChild>
                          <a href={report.pdfUrl} target="_blank" rel="noopener noreferrer">
                            <Download className="h-3.5 w-3.5 mr-1" />
                            PDF
                          </a>
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-slate-500">
            Page {pagination.page} of {pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(pagination.page - 1)}
              disabled={pagination.page <= 1}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => onPageChange?.(pagination.page + 1)}
              disabled={pagination.page >= pagination.totalPages}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Return dialog */}
      <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Return Report for Revision</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-500">
              Provide a comment explaining what needs to be revised. The ICR will be notified.
            </p>
            <Textarea
              placeholder="Enter feedback for the ICR..."
              value={returnComment}
              onChange={(e) => setReturnComment(e.target.value)}
              rows={4}
              className="resize-none"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReturn}
              disabled={!returnComment.trim() || actionLoading !== null}
            >
              Return Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
