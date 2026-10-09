"use client";

/**
 * The leave requests waiting on the signed-in manager, with the controls to
 * decide them.
 *
 * This exists because the permission and the screen had drifted apart.
 * `PATCH /api/hr/leave/[id]` has always accepted a direct manager — its own
 * refusal text reads "only HR managers or direct manager can approve/reject" —
 * but the single screen that renders an Approve button lives on the HR tab and
 * is gated on `isHR`, and `GET /api/hr/leave` sent every non-HR caller down to
 * their own rows. So a manager was emailed "Action Required" and given nowhere
 * to act. Only SUPER_ADMIN and HR_MANAGER count as HR, which left every other
 * line manager in the company in that position.
 *
 * Rendered in two places on purpose:
 *   - the HR tab, for a manager whose role lets them reach /hr, and
 *   - their own employee profile, because an EMPLOYEE is redirected off /hr to
 *     that page and would otherwise never see this at all.
 *
 * It returns null when there is nothing waiting, so it costs a non-manager
 * nothing.
 */

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { formatDate } from "@/lib/utils";
import { leaveTypeLabel } from "@/lib/leave-policy";
import { CheckCircle, XCircle, Users } from "lucide-react";

interface TeamLeaveRequest {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: string;
  canDecide: boolean;
  employee: { employeeId: string; user: { name: string | null } };
}

export function TeamLeaveApprovals({ onDecided }: { onDecided?: () => void }) {
  const { toast } = useToast();
  const [requests, setRequests] = useState<TeamLeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/hr/leave?scope=team&status=PENDING");
      if (!res.ok) { setRequests([]); return; }
      const data = await res.json();
      setRequests(data.requests ?? []);
    } catch {
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  async function decide(id: string, action: "APPROVED" | "REJECTED") {
    setBusyId(id);
    try {
      const res = await fetch(`/api/hr/leave/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: "Could not update", description: data.error ?? "Please try again.", variant: "destructive" });
        return;
      }
      toast({
        title: action === "APPROVED" ? "Leave approved" : "Leave rejected",
        variant: action === "APPROVED" ? "default" : "destructive",
      });
      await load();
      onDecided?.();
    } finally {
      setBusyId(null);
    }
  }

  // Nothing waiting is the common case for most of the company. Rendering an
  // empty "no requests" card on every employee's profile would be noise.
  if (loading || requests.length === 0) return null;

  return (
    <Card className="border-amber-200 dark:border-amber-500/30">
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-base flex items-center gap-2">
          <Users className="h-4 w-4 text-amber-600 dark:text-amber-300" />
          Awaiting your approval
          <Badge variant="warning">{requests.length}</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {requests.map((r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-lg bg-muted/30 border text-sm"
          >
            <div className="min-w-0">
              <p className="font-medium">
                {r.employee.user.name}{" "}
                <span className="text-xs text-muted-foreground font-mono">{r.employee.employeeId}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {leaveTypeLabel(r.leaveType)} · {formatDate(r.startDate)} — {formatDate(r.endDate)} ({r.days}d)
              </p>
              {r.reason && (
                <p className="text-xs text-muted-foreground truncate max-w-[420px]">{r.reason}</p>
              )}
            </div>
            {/*
              canDecide comes from the server, which knows the manager
              relationship. Rendering the buttons on a row the server would
              refuse is worse than not rendering them.
            */}
            {r.canDecide && (
              <div className="flex gap-2 shrink-0">
                <Button
                  size="sm" variant="outline" disabled={busyId === r.id}
                  className="h-7 text-green-600 border-green-300 dark:text-green-400 dark:border-green-500/40 dark:hover:bg-green-500/10"
                  onClick={() => decide(r.id, "APPROVED")}
                >
                  <CheckCircle className="h-3.5 w-3.5 mr-1" /> Approve
                </Button>
                <Button
                  size="sm" variant="outline" disabled={busyId === r.id}
                  className="h-7 text-red-600 border-red-300 dark:text-red-400 dark:border-red-500/40 dark:hover:bg-red-500/10"
                  onClick={() => decide(r.id, "REJECTED")}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" /> Reject
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
