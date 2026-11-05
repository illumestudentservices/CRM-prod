"use client";

import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { STAGE_LABELS, STAGE_BADGE_CLASSES } from "@/lib/lead-pipeline";
import type { LeadStage } from "@prisma/client";

/**
 * Spec §2 (Clients) — Individual Client Overview → Student Pipeline panel.
 *
 * "Display CRM-generated student counts by stage: New Lead / Contacted /
 * Qualified / Application Submitted / Awaiting Decision / Offer Received /
 * Deposit Paid / Enrolled."
 *
 * Counts are derived from Lead.stage server-side (institution.leads is
 * already loaded on the detail page) — this component only renders. Closed
 * outcomes (LOST, DEFERRED, APPLICATION_REJECTED, WITHDRAWN, VISA_REFUSED)
 * are excluded from the "active pipeline" figure but their totals are shown
 * as small side numbers so an RM can spot leakage.
 */

const ACTIVE_STAGES: LeadStage[] = [
  "NEW_LEAD",
  "CONTACTED",
  "QUALIFIED",
  "APPLICATION_SUBMITTED",
  "AWAITING_DECISION",
  "OFFER_RECEIVED",
  "DEPOSIT_PAID",
  "ENROLLED",
];

const CLOSED_STAGES: LeadStage[] = [
  "LOST",
  "DEFERRED",
  "APPLICATION_REJECTED",
  "WITHDRAWN",
  "VISA_REFUSED",
];

interface PipelinePanelProps {
  leads: Array<{ id: string; stage: LeadStage }>;
  /** When set, each stage tile links to the pipeline filtered to this client +
   *  stage. Omitted on surfaces that render the panel without a client scope. */
  institutionId?: string;
}

export function PipelinePanel({ leads, institutionId }: PipelinePanelProps) {
  const counts = new Map<LeadStage, number>();
  for (const l of leads) {
    counts.set(l.stage, (counts.get(l.stage) ?? 0) + 1);
  }
  const activeTotal = ACTIVE_STAGES.reduce((sum, s) => sum + (counts.get(s) ?? 0), 0);
  const enrolledTotal = counts.get("ENROLLED") ?? 0;
  const closedTotal = CLOSED_STAGES.reduce((sum, s) => sum + (counts.get(s) ?? 0), 0);

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center justify-between">
          <span>Student Pipeline</span>
          <span className="text-xs font-normal text-slate-500 dark:text-slate-400">
            {activeTotal} active · {enrolledTotal} enrolled · {closedTotal} closed
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {ACTIVE_STAGES.map((stage) => {
            const count = counts.get(stage) ?? 0;
            const pct = activeTotal > 0 ? Math.round((count / activeTotal) * 100) : 0;
            const body = (
              <>
                <p className="text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {STAGE_LABELS[stage]}
                </p>
                <div className="mt-1 flex items-baseline gap-2">
                  <p className="text-lg font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                    {count}
                  </p>
                  {activeTotal > 0 && count > 0 && (
                    <span className="text-xs text-slate-500 dark:text-slate-400">{pct}%</span>
                  )}
                </div>
                <div className="mt-1.5 h-1 w-full rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full ${STAGE_BADGE_CLASSES[stage]?.split(" ")[0] ?? "bg-slate-300"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </>
            );
            const cls = "rounded-md border border-slate-200 bg-white dark:bg-slate-900 dark:border-slate-800 p-3";
            if (institutionId) {
              return (
                <Link
                  key={stage}
                  href={`/students?institution=${institutionId}&stage=${stage}`}
                  title={`Open ${STAGE_LABELS[stage]} students for this client`}
                  className={`${cls} block transition-shadow hover:shadow-md active:scale-[0.99]`}
                >
                  {body}
                </Link>
              );
            }
            return <div key={stage} className={cls}>{body}</div>;
          })}
        </div>

        {closedTotal > 0 && (
          <div className="mt-3 rounded-md border border-slate-100 bg-slate-50 dark:bg-slate-900/40 dark:border-slate-800 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-1.5">
              Closed / lost outcomes
            </p>
            <div className="flex flex-wrap gap-1.5">
              {CLOSED_STAGES.map((stage) => {
                const count = counts.get(stage) ?? 0;
                if (count === 0) return null;
                const chipCls = "inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-medium border bg-white text-slate-600 border-slate-200 dark:bg-slate-900 dark:text-slate-400 dark:border-slate-700";
                const chipBody = (<>{STAGE_LABELS[stage]}<span className="font-semibold">{count}</span></>);
                return institutionId ? (
                  <Link key={stage} href={`/students?institution=${institutionId}&stage=${stage}`} className={`${chipCls} hover:shadow-sm`}>
                    {chipBody}
                  </Link>
                ) : (
                  <span key={stage} className={chipCls}>{chipBody}</span>
                );
              })}
            </div>
          </div>
        )}

        <p className="mt-3 text-[11px] text-slate-400 dark:text-slate-500">
          Based on student records maintained within Illume CRM.
        </p>
      </CardContent>
    </Card>
  );
}
