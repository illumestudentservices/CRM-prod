"use client";

/**
 * Approve a leave request. For most staff this is a one-click approve. For an
 * ICR it opens a short checklist the approving manager must confirm before the
 * leave can be approved: that the institution representative is informed, and
 * that the ICR's work is covered while they are away (with an optional note).
 * The same rule is enforced server-side in PATCH /api/hr/leave/[id].
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle, Loader2 } from "lucide-react";

interface ApprovableLeave {
  id: string;
  employee: { user: { name: string | null; role?: string | null } };
}

const GREEN = "text-green-600 border-green-300 dark:text-green-400 dark:border-green-500/40 dark:hover:bg-green-500/10";

export function LeaveApproveButton({
  request,
  onDecided,
  size = "sm",
}: {
  request: ApprovableLeave;
  onDecided?: () => void;
  size?: "sm" | "default";
}) {
  const { toast } = useToast();
  const isICR = request.employee.user.role === "ICR";
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [verified, setVerified] = useState(false);
  const [covered, setCovered] = useState(false);
  const [note, setNote] = useState("");

  async function approve(extra: Record<string, unknown>) {
    setBusy(true);
    try {
      const res = await fetch(`/api/hr/leave/${request.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "APPROVED", ...extra }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not approve", description: data.error ?? "Please try again.", variant: "destructive" });
        return;
      }
      toast({ title: "Leave approved" });
      setOpen(false); setVerified(false); setCovered(false); setNote("");
      onDecided?.();
    } finally {
      setBusy(false);
    }
  }

  if (!isICR) {
    return (
      <Button size={size} variant="outline" className={`h-7 ${GREEN}`} disabled={busy} onClick={() => approve({})}>
        <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
      </Button>
    );
  }

  return (
    <>
      <Button size={size} variant="outline" className={`h-7 ${GREEN}`} disabled={busy} onClick={() => setOpen(true)}>
        <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
      </Button>
      <Dialog open={open} onOpenChange={(v) => { if (!v) { setOpen(false); } }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Approve ICR leave</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <p className="text-sm text-muted-foreground">
              Before approving {request.employee.user.name ?? "this ICR"}&apos;s leave, confirm:
            </p>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <Checkbox checked={verified} onCheckedChange={(v) => setVerified(v === true)} className="mt-0.5" />
              <span className="text-sm">I have verified the institution representative is informed.</span>
            </label>
            <label className="flex items-start gap-2.5 cursor-pointer">
              <Checkbox checked={covered} onCheckedChange={(v) => setCovered(v === true)} className="mt-0.5" />
              <span className="text-sm">Work is covered while they are on leave.</span>
            </label>
            <div className="space-y-1.5">
              <Label htmlFor="coverage-note">Coverage note (optional)</Label>
              <Textarea id="coverage-note" rows={2} value={note}
                placeholder="e.g. Jane covering the University of X account"
                onChange={(e) => setNote(e.target.value)} />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button type="button" disabled={!verified || !covered || busy}
                className="bg-[#1E3A5F] hover:bg-[#1E3A5F]/90 text-white gap-1.5"
                onClick={() => approve({ coverageVerified: verified, workCovered: covered, coverageNote: note })}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />} Approve leave
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
