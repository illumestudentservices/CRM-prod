import type { LeadStage } from "@prisma/client";

/**
 * Single source of truth for the recruitment pipeline.
 *
 * Every stage order, label and colour in the app must import from here. Local
 * copies are what made the previous enum rename dangerous: several of them
 * widened `stage` to `string`, so they compiled fine and silently rendered
 * zeros. The `Record<LeadStage, ...>` maps below are deliberately exhaustive —
 * adding a stage to the enum without updating them fails the build.
 *
 * All date arithmetic here is UTC. The app spans regions; local-time day
 * boundaries would make "days in stage" differ by where the viewer happens
 * to be sitting.
 */

// ─── Stage ordering ──────────────────────────────────────────────────────────

/** The eight live pipeline stages, in funnel order. */
export const PIPELINE_STAGES = [
  "NEW_LEAD",
  "CONTACTED",
  "QUALIFIED",
  "APPLICATION_SUBMITTED",
  "AWAITING_DECISION",
  "OFFER_RECEIVED",
  "DEPOSIT_PAID",
  "ENROLLED",
] as const satisfies readonly LeadStage[];

/** Outcomes reachable from any stage. Not part of the funnel. */
export const CLOSED_STAGES = [
  "LOST",
  "DEFERRED",
  "APPLICATION_REJECTED",
] as const satisfies readonly LeadStage[];

export const ALL_STAGES: readonly LeadStage[] = [
  ...PIPELINE_STAGES,
  ...CLOSED_STAGES,
];

/**
 * Stages counted as a won conversion. Every conversion-rate calculation must
 * use this rather than comparing to a literal, so there is one place to change
 * if "converted" ever stops meaning exactly "enrolled".
 */
export const CONVERTED_STAGES: readonly LeadStage[] = ["ENROLLED"];

/** Stages where the lead is no longer being actively worked. */
export const INACTIVE_STAGES: readonly LeadStage[] = [
  ...CLOSED_STAGES,
  "ENROLLED",
];

/**
 * These accept `string` rather than `LeadStage` on purpose. Callers frequently
 * hold a stage that came back through JSON or a `groupBy` key, where the type
 * has already widened; forcing a cast at every call site is how untyped local
 * copies crept in last time.
 */
export function isClosedStage(stage: string): boolean {
  return (CLOSED_STAGES as readonly string[]).includes(stage);
}

export function isConvertedStage(stage: string): boolean {
  return (CONVERTED_STAGES as readonly string[]).includes(stage);
}

/** True for closed outcomes and Enrolled — i.e. no longer being worked. */
export function isInactiveStage(stage: string): boolean {
  return (INACTIVE_STAGES as readonly string[]).includes(stage);
}

/** Colour lookup that tolerates historical stage names from archived JSON. */
export function stageHex(stage: string): string {
  return STAGE_HEX[stage as LeadStage] ?? "#94A3B8";
}

export function stageBadgeClass(stage: string): string {
  return (
    STAGE_BADGE_CLASSES[stage as LeadStage] ??
    "bg-slate-100 text-slate-600 border-slate-200"
  );
}

/** Position in the funnel, or -1 for closed outcomes. */
export function stageIndex(stage: LeadStage): number {
  return (PIPELINE_STAGES as readonly LeadStage[]).indexOf(stage);
}

// ─── Presentation ────────────────────────────────────────────────────────────

export const STAGE_LABELS: Record<LeadStage, string> = {
  NEW_LEAD: "New Lead",
  CONTACTED: "Contacted",
  QUALIFIED: "Qualified",
  APPLICATION_SUBMITTED: "Application Submitted",
  AWAITING_DECISION: "Awaiting Decision",
  OFFER_RECEIVED: "Offer Received",
  DEPOSIT_PAID: "Deposit Paid",
  ENROLLED: "Enrolled",
  LOST: "Lost",
  DEFERRED: "Deferred",
  APPLICATION_REJECTED: "Application Rejected",
  WITHDRAWN: "Withdrawn",
  VISA_REFUSED: "Visa Refused",
};

/** What the stage means, shown as help text on the pipeline stepper. */
export const STAGE_OBJECTIVES: Record<LeadStage, string> = {
  NEW_LEAD: "Lead captured and first follow-up planned",
  CONTACTED: "Initial counselling completed",
  QUALIFIED: "Student assessed and ready to apply",
  APPLICATION_SUBMITTED: "Complete application submitted to institution",
  AWAITING_DECISION: "Application under institutional review",
  OFFER_RECEIVED: "Offer received and discussed with student",
  DEPOSIT_PAID: "Student committed to institution",
  ENROLLED: "Student officially enrolled",
  LOST: "Student is no longer proceeding",
  DEFERRED: "Student postponed to a future intake",
  APPLICATION_REJECTED: "Application unsuccessful at this institution",
  WITHDRAWN: "Student withdrew from the process",
  VISA_REFUSED: "Visa refused; alternative outcome required",
};

/** Tailwind classes for badges. */
export const STAGE_BADGE_CLASSES: Record<LeadStage, string> = {
  NEW_LEAD: "bg-slate-100 text-slate-700 border-slate-200",
  CONTACTED: "bg-sky-100 text-sky-700 border-sky-200",
  QUALIFIED: "bg-cyan-100 text-cyan-700 border-cyan-200",
  APPLICATION_SUBMITTED: "bg-indigo-100 text-indigo-700 border-indigo-200",
  AWAITING_DECISION: "bg-violet-100 text-violet-700 border-violet-200",
  OFFER_RECEIVED: "bg-blue-100 text-blue-700 border-blue-200",
  DEPOSIT_PAID: "bg-teal-100 text-teal-700 border-teal-200",
  ENROLLED: "bg-green-100 text-green-700 border-green-200",
  LOST: "bg-gray-100 text-gray-600 border-gray-200",
  DEFERRED: "bg-orange-100 text-orange-700 border-orange-200",
  APPLICATION_REJECTED: "bg-red-100 text-red-700 border-red-200",
  WITHDRAWN: "bg-zinc-100 text-zinc-700 border-zinc-200",
  VISA_REFUSED: "bg-rose-100 text-rose-700 border-rose-200",
};

/** Hex values, for chart libraries that can't take Tailwind classes. */
export const STAGE_HEX: Record<LeadStage, string> = {
  NEW_LEAD: "#64748B",
  CONTACTED: "#0EA5E9",
  QUALIFIED: "#06B6D4",
  APPLICATION_SUBMITTED: "#6366F1",
  AWAITING_DECISION: "#8B5CF6",
  OFFER_RECEIVED: "#3B82F6",
  DEPOSIT_PAID: "#14B8A6",
  ENROLLED: "#22C55E",
  LOST: "#94A3B8",
  DEFERRED: "#F97316",
  APPLICATION_REJECTED: "#EF4444",
  WITHDRAWN: "#71717A",
  VISA_REFUSED: "#E11D48",
};

/**
 * Tolerates unknown values on purpose. Historical `MonthlyReport.leadsData`
 * JSON has old stage names baked in as object keys; those reports must still
 * render rather than showing blanks or throwing.
 */
export function stageLabel(stage: string): string {
  return (
    STAGE_LABELS[stage as LeadStage] ??
    stage.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

// ─── Time ────────────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/** Whole days elapsed since `from`, floored, in UTC. */
export function daysSince(from: Date | string | null | undefined, now: Date = new Date()): number | null {
  if (!from) return null;
  const t = typeof from === "string" ? new Date(from) : from;
  if (Number.isNaN(t.getTime())) return null;
  return Math.floor((now.getTime() - t.getTime()) / MS_PER_DAY);
}

/** Thresholds from the pipeline spec's inactivity rules. */
export const INACTIVITY_REMINDER_DAYS = 14;
export const INACTIVITY_ESCALATION_DAYS = 21;

/** A record is overdue once it passes the ICR reminder threshold. */
export function isOverdue(lastActivityAt: Date | string | null | undefined, now: Date = new Date()): boolean {
  const d = daysSince(lastActivityAt, now);
  return d !== null && d >= INACTIVITY_REMINDER_DAYS;
}
