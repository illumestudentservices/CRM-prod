"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send, CheckCircle, XCircle, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

type ReportStatus =
  | "DRAFT"
  | "PENDING_REVIEW"
  | "REGIONAL_APPROVED"
  | "HQ_REVIEW"
  | "FINAL_APPROVED"
  | "RETURNED";

interface ApprovalActionsProps {
  reportId: string;
  reportStatus: ReportStatus;
  userRole: string;
  userId: string;
  icrId: string;
}

export function ApprovalActions({
  reportId,
  reportStatus,
  userRole,
  userId,
  icrId,
}: ApprovalActionsProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);
  const [returnComment, setReturnComment] = useState("");
  const [error, setError] = useState<string | null>(null);

  const isICR = userRole === "ICR" && userId === icrId;
  // Regional Manager gives the single, final approval. Super Admin can act too.
  const isApprover = userRole === "REGIONAL_MANAGER" || userRole === "SUPER_ADMIN";

  // Determine what buttons to show
  const showSubmit = isICR && (reportStatus === "DRAFT" || reportStatus === "RETURNED");
  const showApprove = isApprover && reportStatus === "PENDING_REVIEW";
  const showReturn = isApprover && reportStatus === "PENDING_REVIEW";

  if (!showSubmit && !showApprove && !showReturn) {
    return null;
  }

  async function callApprove(action: string, comment?: string) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/reports/${reportId}/approve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment }),
      });

      if (!res.ok) {
        const err = await res.json();
        setError(err.error ?? "Action failed");
        return;
      }

      router.refresh();
    } catch (e) {
      setError("An unexpected error occurred");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  async function handleReturn() {
    if (!returnComment.trim()) return;
    await callApprove("RETURN", returnComment);
    if (!error) {
      setReturnDialogOpen(false);
      setReturnComment("");
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {showSubmit && (
          <Button
            onClick={() => callApprove("SUBMIT")}
            disabled={loading}
            className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white"
          >
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
            Send report
          </Button>
        )}

        {showApprove && (
          <Button
            onClick={() => callApprove("APPROVE")}
            disabled={loading}
            className="bg-[#22C55E] hover:bg-[#22C55E]/90 text-white"
          >
            {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <CheckCircle className="h-4 w-4 mr-2" />}
            Approve
          </Button>
        )}

        {showReturn && (
          <Button
            variant="outline"
            onClick={() => setReturnDialogOpen(true)}
            disabled={loading}
            className="border-[#EF4444] text-[#EF4444] hover:bg-red-50"
          >
            <XCircle className="h-4 w-4 mr-2" />
            Return with Comment
          </Button>
        )}

        {error && (
          <p className="text-sm text-[#EF4444]">{error}</p>
        )}
      </div>

      {/* Return dialog */}
      <Dialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Return Report for Revision</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-slate-500">
              Provide detailed feedback so the ICR knows what to revise.
            </p>
            <div className="space-y-1.5">
              <Label>Feedback Comment</Label>
              <Textarea
                placeholder="Explain what needs to be corrected or added..."
                value={returnComment}
                onChange={(e) => setReturnComment(e.target.value)}
                rows={5}
                className="resize-none"
              />
            </div>
            {error && <p className="text-sm text-[#EF4444]">{error}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReturnDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleReturn}
              disabled={!returnComment.trim() || loading}
            >
              {loading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              Return Report
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
