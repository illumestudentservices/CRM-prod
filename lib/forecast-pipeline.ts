import { db } from "@/lib/db";
import type { ForecastSegmentKey, LeadStage } from "@prisma/client";
import { FORECAST_SEGMENTS } from "@/lib/forecasting";

/**
 * The live pipeline behind a forecast (spec §5).
 *
 * Read, never stored. The spec states these figures are "system-generated and
 * should not be manually editable from Forecasting", so they are computed from
 * the Institution Interests that own them on every request. Copying them into
 * the forecast would create a second set of numbers that drifts from the first
 * the moment a student moves stage — which is the duplication spec §3 of the
 * architecture rules forbids.
 *
 * Segmentation is derived, not entered:
 *   Direct / Indirect — whether the student's source is a recruitment agent.
 *   UG / PG           — the study level on the interest.
 */

/** Spec §5's pipeline stages, in funnel order. */
export const PIPELINE_BUCKETS = [
  "activeLeads",
  "qualified",
  "applicationsSubmitted",
  "awaitingDecision",
  "offersReceived",
  "deposits",
  "enrolled",
] as const;

export type PipelineBucket = (typeof PIPELINE_BUCKETS)[number];

export type PipelineGrid = Record<ForecastSegmentKey, Record<PipelineBucket, number>>;

/**
 * Which bucket a stage counts in.
 *
 * LOST and DEFERRED are deliberately absent: a lost student is not pipeline,
 * and counting them would inflate every figure the ICR is asked to forecast
 * against. Returning null keeps that explicit rather than letting an unmapped
 * stage fall silently into a bucket.
 */
function bucketFor(stage: LeadStage): PipelineBucket | null {
  switch (stage) {
    case "NEW_LEAD":
    case "CONTACTED":
      return "activeLeads";
    case "QUALIFIED":
      return "qualified";
    case "APPLICATION_SUBMITTED":
      return "applicationsSubmitted";
    case "AWAITING_DECISION":
      return "awaitingDecision";
    case "OFFER_RECEIVED":
      return "offersReceived";
    case "DEPOSIT_PAID":
      return "deposits";
    case "ENROLLED":
      return "enrolled";
    default:
      return null;
  }
}

/**
 * UG or PG.
 *
 * PATHWAY and FOUNDATION are pre-degree routes into undergraduate study, so
 * they count as UG rather than being dropped — a forecast that silently omitted
 * them would understate the pipeline. The spec only names UG and PG, so this is
 * a judgement; it is here in one place rather than spread across queries.
 */
function isPostgraduate(studyLevel: string): boolean {
  return studyLevel === "POSTGRADUATE";
}

function emptyGrid(): PipelineGrid {
  const grid = {} as PipelineGrid;
  for (const seg of FORECAST_SEGMENTS) {
    grid[seg] = {
      activeLeads: 0, qualified: 0, applicationsSubmitted: 0,
      awaitingDecision: 0, offersReceived: 0, deposits: 0, enrolled: 0,
    };
  }
  return grid;
}

export interface PipelineResult {
  grid: PipelineGrid;
  totals: Record<PipelineBucket, number>;
  /** Rows counted, so a zero grid can be told apart from a broken query. */
  interestsCounted: number;
}

/**
 * Compute the pipeline for one institution and intake.
 *
 * Scoped to the ICR whose forecast this is, because a forecast is that person's
 * judgement about their own pipeline — spec §3 keys a forecast on the ICR.
 */
export async function computePipeline(opts: {
  institutionId: string;
  intakeYear: number;
  intakeMonth: number;
  icrId?: string | null;
}): Promise<PipelineResult> {
  const interests = await db.institutionInterest.findMany({
    where: {
      institutionId: opts.institutionId,
      intakeYear: opts.intakeYear,
      intakeMonth: opts.intakeMonth,
      closedAt: null,
      ...(opts.icrId ? { assignedICRId: opts.icrId } : {}),
    },
    select: {
      stage: true,
      studyLevel: true,
      // Agent affiliation lives on the student, not the interest.
      lead: { select: { source: { select: { type: true } } } },
    },
  });

  const grid = emptyGrid();
  const totals = {
    activeLeads: 0, qualified: 0, applicationsSubmitted: 0,
    awaitingDecision: 0, offersReceived: 0, deposits: 0, enrolled: 0,
  } as Record<PipelineBucket, number>;

  for (const i of interests) {
    const bucket = bucketFor(i.stage);
    if (!bucket) continue; // lost or deferred — not pipeline
    const indirect = i.lead?.source?.type === "AGENT";
    const pg = isPostgraduate(i.studyLevel);
    const key = (`${indirect ? "INDIRECT" : "DIRECT"}_${pg ? "PG" : "UG"}`) as ForecastSegmentKey;
    grid[key][bucket] += 1;
    totals[bucket] += 1;
  }

  return { grid, totals, interestsCounted: interests.length };
}

/** Flattened counts for the maturity calculation in lib/forecasting.ts. */
export function maturityInput(p: PipelineResult) {
  return {
    activeLeads: p.totals.activeLeads,
    qualified: p.totals.qualified,
    applications: p.totals.applicationsSubmitted + p.totals.awaitingDecision,
    offers: p.totals.offersReceived,
    deposits: p.totals.deposits + p.totals.enrolled,
  };
}
