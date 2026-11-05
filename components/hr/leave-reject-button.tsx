"use client";

/**
 * Reject a leave request with an optional comment. The comment is stored on the
 * request (rejectionNote) and included in the employee's rejection email.
 * Used wherever a manager/HR can reject — the approvals queue and the HR table.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { XCircle, Loader2 } from "lucide-react";

const RED = "text-red-600 border-red-300 dark:text-red-400 dark:border-red-500/40 dark:hover:bg-red-500/10";

export function LeaveRejectButton({
  requestId,
  onDecided,
  size = "sm",
}: {
  requestId: string;
  onDecided?: () => void;
  size?: "sm" | "default";
}) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");

  async function reject() {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/leave/${requestId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "REJECTED", ...(note.trim() ? { rejectionNote: note.trim() } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not reject", description: data.error ?? "Please try again.", variant: "destructive" });
        return;
      }
      toast({ title: "Leave rejected", variant: "destructive" });
      setOpen(false); setNote("");
      onDecided?.();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button size={size} variant="outline" className={`h-7 ${RED}`} onClick={() => setOpen(true)}>
        <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
      </Button>
      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); setNote(""); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Reject leave request</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <div className="space-y-1.5">
              <Label htmlFor="leave-reject-note">Comment (optional)</Label>
              <Textarea id="leave-reject-note" rows={3} value={note}
                placeholder="Reason for rejection (optional — shared with the employee)"
                onChange={(e) => setNote(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="button" variant="destructive" disabled={busy} onClick={reject} className="gap-1.5">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Reject
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
