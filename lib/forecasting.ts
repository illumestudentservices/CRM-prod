import type {
  ForecastStatus,
  ForecastSegmentKey,
  PipelineMaturity,
  Role,
} from "@prisma/client";

/**
 * Forecasting — workflow rules, segments and derived figures.
 *
 * No database access, so the rules stay testable and the module cannot be
 * pulled into a client bundle by accident.
 *
 * The spec's shape in one line: "CRM provides the facts. ICR provides the
 * forecast judgement. RM provides regional oversight. VP accepts." Everything
 * here enforces that separation — most importantly that an RM adjustment never
 * destroys what the ICR said.
 */

// ─── Segments ────────────────────────────────────────────────────────────────

/** Spec §3. Every forecast is these four; the total is derived, never entered. */
export const FORECAST_SEGMENTS = [
  "DIRECT_UG",
  "DIRECT_PG",
  "INDIRECT_UG",
  "INDIRECT_PG",
] as const satisfies readonly ForecastSegmentKey[];

type UncoveredSegment = Exclude<ForecastSegmentKey, (typeof FORECAST_SEGMENTS)[number]>;
const _segmentCoverage: [UncoveredSegment] extends [never]
  ? true
  : { ERROR: "ForecastSegmentKey missing from FORECAST_SEGMENTS"; missing: UncoveredSegment } = true;
void _segmentCoverage;

export const SEGMENT_LABELS: Record<ForecastSegmentKey, string> = {
  DIRECT_UG: "Direct — Undergraduate",
  DIRECT_PG: "Direct — Postgraduate",
  INDIRECT_UG: "Indirect — Undergraduate",
  INDIRECT_PG: "Indirect — Postgraduate",
};

// ─── Statuses ────────────────────────────────────────────────────────────────

export const FORECAST_STATUSES = [
  "DRAFT",
  "SUBMITTED_TO_RM",
  "RETURNED_TO_ICR",
  "RM_REVIEWED",
  "REGIONAL_SUBMITTED",
  "RETURNED_TO_RM",
  "ACCEPTED",
  "ARCHIVED",
] as const satisfies readonly ForecastStatus[];

type UncoveredStatus = Exclude<ForecastStatus, (typeof FORECAST_STATUSES)[number]>;
const _statusCoverage: [UncoveredStatus] extends [never]
  ? true
  : { ERROR: "ForecastStatus missing from FORECAST_STATUSES"; missing: UncoveredStatus } = true;
void _statusCoverage;

/**
 * Legal moves. Spec §11–§18.
 *
 * Not linear. An RM can send a forecast back to the ICR, and a VP can send a
 * regional submission back to the RM, so two states re-enter the flow from
 * later points. ACCEPTED is terminal apart from archiving — a forecast that has
 * been accepted is the number the business planned against, and editing it
 * afterwards would make accuracy analysis meaningless.
 */
export const FORECAST_FLOW: Record<ForecastStatus, readonly ForecastStatus[]> = {
  DRAFT: ["SUBMITTED_TO_RM"],
  SUBMITTED_TO_RM: ["RETURNED_TO_ICR", "RM_REVIEWED"],
  RETURNED_TO_ICR: ["SUBMITTED_TO_RM"],
  RM_REVIEWED: ["REGIONAL_SUBMITTED"],
  REGIONAL_SUBMITTED: ["RETURNED_TO_RM", "ACCEPTED"],
  RETURNED_TO_RM: ["REGIONAL_SUBMITTED"],
  ACCEPTED: ["ARCHIVED"],
  ARCHIVED: [],
};

export function canMove(from: ForecastStatus, to: ForecastStatus): boolean {
  return FORECAST_FLOW[from].includes(to);
}

/** Accepted and archived forecasts are history. */
export function isLocked(status: ForecastStatus): boolean {
  return status === "ACCEPTED" || status === "ARCHIVED";
}

/** The ICR may edit their numbers only while the forecast is theirs. */
export function isIcrEditable(status: ForecastStatus): boolean {
  return status === "DRAFT" || status === "RETURNED_TO_ICR";
}

/** The RM may adjust only while reviewing. */
export function isRmEditable(status: ForecastStatus): boolean {
  return status === "SUBMITTED_TO_RM" || status === "RETURNED_TO_RM";
}

// ─── Segment values ──────────────────────────────────────────────────────────

export interface SegmentValues {
  segment: ForecastSegmentKey;
  icrApplications: number;
  icrDeposits: number;
  icrEnrolments: number;
  rmApplications: number | null;
  rmDeposits: number | null;
  rmEnrolments: number | null;
}

/**
 * The number that counts.
 *
 * Spec §13: the RM's figure supersedes the ICR's for planning, but the ICR's is
 * retained. `null` on an RM column means "not adjusted" — which is why these
 * are nullable and why `?? icr` is the right operator rather than a truthiness
 * check. An RM who deliberately adjusts a segment to zero must not have that
 * silently replaced by the ICR's number.
 */
export function effectiveValues(s: SegmentValues) {
  return {
    applications: s.rmApplications ?? s.icrApplications,
    deposits: s.rmDeposits ?? s.icrDeposits,
    enrolments: s.rmEnrolments ?? s.icrEnrolments,
  };
}

export function wasAdjusted(s: SegmentValues): boolean {
  return s.rmApplications !== null || s.rmDeposits !== null || s.rmEnrolments !== null;
}

/** Totals across segments. Spec §3: "the system calculates the total". */
export function totals(segments: readonly SegmentValues[]) {
  const icr = { applications: 0, deposits: 0, enrolments: 0 };
  const effective = { applications: 0, deposits: 0, enrolments: 0 };
  for (const s of segments) {
    icr.applications += s.icrApplications;
    icr.deposits += s.icrDeposits;
    icr.enrolments += s.icrEnrolments;
    const e = effectiveValues(s);
    effective.applications += e.applications;
    effective.deposits += e.deposits;
    effective.enrolments += e.enrolments;
  }
  return { icr, effective, adjusted: segments.some(wasAdjusted) };
}

// ─── Direction ───────────────────────────────────────────────────────────────

export interface Direction {
  change: number;
  percent: number | null;
  label: "up" | "down" | "flat" | "first";
  text: string;
}

/**
 * Spec §8. Movement against the previous ACCEPTED forecast, not the previous
 * draft — comparing against something nobody agreed to would make the direction
 * meaningless.
 */
export function direction(current: number, previousAccepted: number | null): Direction {
  if (previousAccepted === null) {
    return { change: 0, percent: null, label: "first", text: "First forecast for this intake" };
  }
  const change = current - previousAccepted;
  // Guard the zero baseline: going from 0 to 5 is not a percentage increase,
  // and reporting Infinity% would be worse than reporting nothing.
  const percent = previousAccepted === 0 ? null : Math.round((change / previousAccepted) * 100);
  if (change === 0) return { change: 0, percent: 0, label: "flat", text: "Unchanged" };
  const dir = change > 0 ? "up" : "down";
  const pct = percent === null ? "" : ` ${Math.abs(percent)}%`;
  return {
    change,
    percent,
    label: dir,
    text: `Forecast ${dir}${pct} (${change > 0 ? "+" : ""}${change})`,
  };
}

// ─── Pipeline maturity ───────────────────────────────────────────────────────

export interface PipelineCounts {
  activeLeads: number;
  qualified: number;
  applications: number;
  offers: number;
  deposits: number;
}

/**
 * Spec §10 and §15. A system assessment of where the pipeline actually sits,
 * deliberately separate from the ICR's confidence score.
 *
 * The distinction the spec draws: "Confidence Score = ICR judgement. Pipeline
 * Maturity = system assessment based on where forecasted students currently sit
 * in the funnel." A forecast of 30 backed by 30 deposits is a different
 * proposition from 30 backed by 30 enquiries, and the number alone cannot tell
 * you which.
 */
export function pipelineMaturity(p: PipelineCounts): PipelineMaturity {
  const total = p.activeLeads + p.qualified + p.applications + p.offers + p.deposits;
  if (total === 0) return "EARLY_STAGE";
  // Weight by how committed each stage is. Deposits are near-certain; raw leads
  // are barely evidence of anything.
  const weighted =
    p.deposits * 1 + p.offers * 0.7 + p.applications * 0.4 + p.qualified * 0.2 + p.activeLeads * 0.05;
  const ratio = weighted / total;
  if (ratio >= 0.6) return "HIGH_MATURITY";
  if (ratio >= 0.35) return "MODERATE_MATURITY";
  if (ratio >= 0.15) return "PIPELINE_DEPENDENT";
  return "EARLY_STAGE";
}

export const MATURITY_LABELS: Record<PipelineMaturity, string> = {
  EARLY_STAGE: "Early stage",
  PIPELINE_DEPENDENT: "Pipeline dependent",
  MODERATE_MATURITY: "Moderate maturity",
  HIGH_MATURITY: "High maturity",
};

// ─── Submission gate ─────────────────────────────────────────────────────────

export interface GateResult {
  ok: boolean;
  errors: string[];
}

/**
 * Spec §6 and §9. A forecast cannot be submitted without the judgement that
 * makes it reviewable: the numbers, a confidence score, and a reason.
 *
 * Zeroes are allowed — forecasting nothing is a legitimate forecast — but the
 * rationale is not optional, because a number with no reasoning can only be
 * accepted or rejected on faith.
 */
export function canSubmit(
  segments: readonly SegmentValues[],
  confidenceScore: number | null,
  rationale: string | null
): GateResult {
  const errors: string[] = [];

  if (segments.length !== FORECAST_SEGMENTS.length) {
    errors.push("All four forecast segments must be present.");
  }
  if (confidenceScore === null || confidenceScore < 1 || confidenceScore > 5) {
    errors.push("Enter a confidence score from 1 to 5.");
  }
  if (!rationale?.trim()) {
    errors.push("Enter a forecast rationale.");
  }
  if (segments.some((s) =>
    [s.icrApplications, s.icrDeposits, s.icrEnrolments].some((n) => n < 0)
  )) {
    errors.push("Forecast figures cannot be negative.");
  }
  // A funnel that widens as it descends is an entry error, not a judgement.
  for (const s of segments) {
    if (s.icrDeposits > s.icrApplications || s.icrEnrolments > s.icrDeposits) {
      errors.push(
        `${SEGMENT_LABELS[s.segment]}: deposits cannot exceed applications, and enrolments cannot exceed deposits.`
      );
    }
  }

  return { ok: errors.length === 0, errors };
}

// ─── Who may act ─────────────────────────────────────────────────────────────

export interface ForecastActors {
  icrId: string;
  regionalManagerId: string | null;
}

export function canEditIcrValues(
  f: ForecastActors & { status: ForecastStatus },
  userId: string,
  role: Role
): boolean {
  if (isLocked(f.status)) return false;
  if (role === "SUPER_ADMIN") return true;
  return f.icrId === userId && isIcrEditable(f.status);
}

/**
 * Review is the RM's, never the author's.
 *
 * The explicit self-review check matters because an RM can also be the ICR on
 * their own forecast, and role alone would let them review it.
 */
export function canReview(
  f: ForecastActors & { status: ForecastStatus },
  userId: string,
  role: Role
): boolean {
  if (isLocked(f.status)) return false;
  if (f.icrId === userId) return false;
  if (role === "SUPER_ADMIN") return true;
  return role === "REGIONAL_MANAGER" && isRmEditable(f.status);
}

/**
 * Whether the RM may ADVANCE the workflow, as opposed to edit figures.
 *
 * Distinct from canReview on purpose. canReview governs writing rm* values and
 * is therefore limited to the states where an adjustment is meaningful. But the
 * RM also has to move a reviewed forecast on to regional submission, and at
 * that point the forecast is no longer editable — using canReview for both made
 * RM_REVIEWED a dead end, with the forecast stuck one step short of the VP.
 */
export function canAdvanceAsRm(
  f: ForecastActors & { status: ForecastStatus },
  userId: string,
  role: Role
): boolean {
  if (isLocked(f.status)) return false;
  if (f.icrId === userId) return false;
  if (role !== "REGIONAL_MANAGER" && role !== "SUPER_ADMIN") return false;
  return (
    f.status === "SUBMITTED_TO_RM" ||
    f.status === "RETURNED_TO_RM" ||
    f.status === "RM_REVIEWED"
  );
}

/** Spec §17. Acceptance is the VP's alone. */
export function canAccept(
  f: ForecastActors & { status: ForecastStatus },
  userId: string,
  role: Role
): boolean {
  if (isLocked(f.status)) return false;
  if (f.icrId === userId) return false;
  return (
    (role === "VP_GLOBAL_SALES" || role === "SUPER_ADMIN") &&
    (f.status === "REGIONAL_SUBMITTED" || f.status === "RETURNED_TO_RM")
  );
}

// ─── Accuracy ────────────────────────────────────────────────────────────────

/**
 * Spec §31. Measured against the ACCEPTED forecast and the actual intake.
 *
 * The spec is careful that this "should not initially be treated as an employee
 * performance score. It is primarily a planning-quality measure", so this
 * returns the variance and leaves interpretation to the reader.
 */
export function accuracy(accepted: number, actual: number) {
  const variance = actual - accepted;
  const percent = accepted === 0 ? null : Math.round((variance / accepted) * 100);
  return {
    accepted,
    actual,
    variance,
    percent,
    text:
      variance === 0
        ? "Exactly on forecast"
        : `${Math.abs(variance)} ${variance > 0 ? "above" : "below"} forecast${percent === null ? "" : ` (${percent > 0 ? "+" : ""}${percent}%)`}`,
  };
}
