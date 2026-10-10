"use client";

/**
 * Leave your team has already taken, or had refused.
 *
 * The sibling of team-leave-approvals.tsx, and deliberately separate from it.
 * That one is a queue: short, urgent, and it disappears when it is empty.
 * This is a record — longer, read-only, and most useful precisely when nothing
 * is pending, which is when the queue is showing nothing at all.
 *
 * A manager could already see their team's BALANCES and approve their
 * requests, but not what those requests had been. Deciding whether a fourth
 * week off in a quarter is reasonable needs the three before it, and without
 * this the only way to find out was to ask HR.
 *
 * Only the manager's own direct reports are returned — the server decides
 * that from `?scope=team`, not this component — and the payload carries no
 * personal detail beyond a name and an avatar. See the select in
 * app/api/hr/leave/route.ts for why that is spelled out there.
 */

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { History, ChevronDown } from "lucide-react";
import { LEAVE_TYPE_LABELS } from "@/lib/leave-policy";

interface TeamLeaveRow {
  id: string;
  leaveType: string;
  startDate: string;
  endDate: string;
  days: number;
  reason: string | null;
  status: string;
  createdAt: string;
  employee: {
    id: string;
    employeeId: string;
    user: { id: string; name: string | null; image: string | null };
  };
}

const STATUS_BADGE: Record<string, string> = {
  APPROVED: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300",
  REJECTED: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300",
  PENDING: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  CANCELLED: "bg-slate-100 text-slate-600 dark:bg-slate-500/15 dark:text-slate-300",
};

/** "12 Mar 2026" — written out, because 03/12 is two dates. */
function fmt(d: string) {
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

const INITIAL_ROWS = 8;

export function TeamLeaveHistory() {
  const [rows, setRows] = useState<TeamLeaveRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/hr/leave?scope=team");
      const data = await res.json();
      setRows(data.requests ?? []);
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  // Nothing to show and nothing to explain: a manager with no reports, or a
  // team that has never booked a day. An empty card would just be noise.
  if (loading || rows.length === 0) return null;

  // Pending ones live in the approvals card above; repeating them here would
  // read as two queues disagreeing about what needs doing.
  const decided = rows.filter((r) => r.status !== "PENDING");
  if (decided.length === 0) return null;

  const visible = showAll ? decided : decided.slice(0, INITIAL_ROWS);

  return (
    <Card>
      <CardHeader className="py-3 px-4">
        <CardTitle className="text-base flex items-center gap-2">
          <History className="h-4 w-4" />
          Your team&apos;s leave history
          <span className="text-xs font-normal text-muted-foreground">
            ({decided.length})
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-2">
        {visible.map((r) => (
          <div
            key={r.id}
            className="flex items-start justify-between gap-3 p-3 rounded-lg bg-muted/30 border text-sm"
          >
            <div className="min-w-0">
              <p className="font-medium">
                {r.employee.user.name ?? "Unknown"}
                <span className="text-xs text-muted-foreground ml-2">
                  {r.employee.employeeId}
                </span>
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {LEAVE_TYPE_LABELS[r.leaveType as keyof typeof LEAVE_TYPE_LABELS] ?? r.leaveType}
                {" · "}
                {fmt(r.startDate)} – {fmt(r.endDate)}
                {" · "}
                {r.days} day{r.days === 1 ? "" : "s"}
              </p>
              {r.reason && (
                <p className="text-xs text-muted-foreground mt-1 truncate max-w-[460px]">
                  {r.reason}
                </p>
              )}
            </div>
            <Badge variant="outline" className={`shrink-0 ${STATUS_BADGE[r.status] ?? ""}`}>
              {r.status.charAt(0) + r.status.slice(1).toLowerCase()}
            </Badge>
          </div>
        ))}

        {decided.length > INITIAL_ROWS && !showAll && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full text-xs"
            onClick={() => setShowAll(true)}
          >
            <ChevronDown className="h-3.5 w-3.5 mr-1" />
            Show all {decided.length}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
