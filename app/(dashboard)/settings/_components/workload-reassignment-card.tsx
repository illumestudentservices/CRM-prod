"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";

/**
 * Surfaces workload reassignment inside Settings → Security.
 *
 * The tool itself lives on the Offboarding tab in HR, because a handover is
 * almost always driven by a departure and the leaver needs to be pre-selected.
 * This card exists for the same reason as RecycleBinCard and MfaStatusCard
 * before it: people look in Settings first, and twice now a feature has been
 * reported as missing because it was only reachable from where it logically
 * belonged rather than from where it was sought.
 *
 * It is not just a link — it carries the count of departures currently held up,
 * because that number is the security-relevant one: each is a person whose
 * access cannot be closed until someone acts.
 */
export function WorkloadReassignmentCard() {
  const [blocked, setBlocked] = useState<number | null>(null);
  const [records, setRecords] = useState(0);

  useEffect(() => {
    fetch("/api/hr/offboarding-requests")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const workloads = (d?.workloads ?? {}) as Record<
          string,
          { total: number; isClear: boolean }
        >;
        const stuck = Object.values(workloads).filter((w) => !w.isClear);
        setBlocked(stuck.length);
        setRecords(stuck.reduce((sum, w) => sum + w.total, 0));
      })
      // A failure here must not render as "0 blocked", which would read as an
      // all-clear. Left at null, the card says it could not check.
      .catch(() => setBlocked(null));
  }, []);

  return (
    <div className="border rounded-xl p-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-start gap-3">
          <div className="h-9 w-9 rounded-lg bg-slate-100 dark:bg-slate-500/15 flex items-center justify-center shrink-0">
            <ArrowRightLeft className="h-5 w-5 text-slate-600 dark:text-slate-300" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              Workload Reassignment
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 max-w-md">
              {blocked === null
                ? "Hand a departing colleague's live students, tasks and field work to someone else."
                : blocked === 0
                  ? "No departures are waiting on a handover. Access can be revoked as soon as it is approved."
                  : `${blocked} approved departure${blocked === 1 ? "" : "s"} cannot have access revoked until ${records} live record${records === 1 ? "" : "s"} ${records === 1 ? "is" : "are"} handed over.`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {blocked !== null && blocked > 0 && (
            <span className="text-xs px-2 py-1 rounded-full font-medium bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
              {blocked}
            </span>
          )}
          <Button asChild size="sm" variant="outline">
            <Link href="/hr?tab=offboarding">
              Open
              <ArrowRight className="h-3.5 w-3.5 ml-1.5" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
