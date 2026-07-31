import type {
  LeadStage,
  LeadEngagementType,
  LeadActivityKind,
} from "@prisma/client";
import { PIPELINE_STAGES, CLOSED_STAGES, STAGE_LABELS, stageIndex } from "./lead-pipeline";

/**
 * The stage gate.
 *
 * Decides whether a student may move from one pipeline stage to the next, and
 * says precisely what is missing when they may not. Used both to enforce on the
 * server and to render the blocker list in the UI, so the two can never
 * disagree about the rules.
 *
 * Two readings of the spec are settled here, and both were deliberate:
 *
 *  - The universal rule demands a completed activity in every stage, but
 *    Stage 1 never asks for one and Stage 5 states it has no mandatory tasks.
 *    The stage-specific rule wins: you cannot have "completed an activity" with
 *    a brand-new lead you have not yet contacted, and while waiting on an
 *    institution there is genuinely nothing to do but chase.
 *
 *  - Fields marked "(if known)" and "(if applicable)" are not simply optional.
 *    Left optional they would be silently skipped forever. They are modelled as
 *    conditional: required unless the case genuinely does not apply, which the
 *    user must state explicitly rather than by omission.
 */

// ─── Types ───────────────────────────────────────────────────────────────────

export type BlockerKind =
  | "FIELD"
  | "ACTIVITY_COMPLETED"
  | "ACTIVITY_SCHEDULED"
  | "CHECKLIST"
  | "TRANSITION";

export interface Blocker {
  kind: BlockerKind;
  message: string;
  /** Field key, where the blocker points at one — lets the UI focus it. */
  field?: string;
}

export interface GateResult {
  canProgress: boolean;
  blockers: Blocker[];
}

/** The minimum shape the gate needs. Deliberately not the full Prisma model. */
export interface GateLead {
  stage: LeadStage;
  stageEnteredAt: Date | string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
  nationality?: string | null;
  countryOfResidence?: string | null;
  sourceId?: string | null;
  intakeYear?: number | null;
  intakeMonth?: number | null;
  intendedDestination?: string | null;
  preferredCountry?: string | null;
  interestedProgram?: string | null;
  budgetRange?: string | null;
  currentQualification?: string | null;
  counsellingOutcome?: string | null;
  institutionId?: string | null;
  academicQualification?: string | null;
  englishStatus?: string | null;
  enrolmentDate?: Date | string | null;
}

export interface GateApplication {
  applicationNumber?: string | null;
  submissionDate?: Date | string | null;
  submissionMethod?: string | null;
  offerType?: string | null;
  studentDecision?: string | null;
  depositDeadline?: Date | string | null;
  depositDeadlineNotApplicable?: boolean | null;
  depositPaid?: boolean | null;
  depositDate?: Date | string | null;
  acceptanceStatus?: string | null;
}

export interface GateActivity {
  kind: LeadActivityKind;
  engagementType?: LeadEngagementType | null;
  stageAtCompletion?: LeadStage | null;
  scheduledFor?: Date | string | null;
  completedAt?: Date | string | null;
  cancelledAt?: Date | string | null;
}

export interface GateChecklistItem {
  category: string;
}

// ─── Field requirements ──────────────────────────────────────────────────────

type Source = "lead" | "application";

type FieldReq =
  /** A single value that must be present. */
  | { kind: "field"; key: string; label: string; source?: Source }
  /**
   * At least one of several. The spec says "Email or Phone" — one requirement
   * satisfied two ways, not two requirements.
   */
  | { kind: "anyOf"; keys: string[]; label: string; source?: Source }
  /**
   * Required unless explicitly marked not applicable. `naKey` names the boolean
   * that records that decision, so "deliberately N/A" stays distinguishable
   * from "nobody has filled this in".
   */
  | { kind: "conditional"; key: string; label: string; naKey?: string; source?: Source };

interface StageConfig {
  requiredFields: FieldReq[];
  /** The stage's Required Tasks, as activity types that must be completed. */
  requiredCompletedTypes: LeadEngagementType[];
  /** Stages reachable from here, excluding closed outcomes. */
  allowedNext: LeadStage[];
  /** Universal rule overrides. Default true for both. */
  requireCompletedActivity?: boolean;
  requireFutureActivity?: boolean;
  /** Checklist category that must have been generated before leaving. */
  requiresChecklist?: string;
  /**
   * Check this stage's own requirements when *entering* it, not when leaving.
   *
   * Needed for terminal stages: Enrolled has no onward transition, so its
   * required fields would never be evaluated at all — a student could be marked
   * Enrolled, and therefore converted and commission-eligible, with no
   * enrolment date recorded.
   */
  validateOnEntry?: boolean;
}

export const STAGE_CONFIG: Record<LeadStage, StageConfig> = {
  NEW_LEAD: {
    requiredFields: [
      { kind: "field", key: "firstName", label: "First name" },
      { kind: "field", key: "lastName", label: "Last name" },
      { kind: "anyOf", keys: ["email", "phone"], label: "Email or phone" },
      { kind: "field", key: "countryOfResidence", label: "Country of residence" },
      { kind: "field", key: "nationality", label: "Citizenship" },
      { kind: "field", key: "sourceId", label: "Lead source" },
      { kind: "field", key: "intakeYear", label: "Intended intake" },
      { kind: "field", key: "intendedDestination", label: "Intended destination" },
    ],
    requiredCompletedTypes: [],
    // You have not spoken to them yet — that is what the next stage means.
    requireCompletedActivity: false,
    allowedNext: ["CONTACTED"],
  },

  CONTACTED: {
    requiredFields: [
      { kind: "field", key: "preferredCountry", label: "Preferred country" },
      // "(if known)" in the spec
      { kind: "conditional", key: "interestedProgram", label: "Intended programme" },
      { kind: "field", key: "budgetRange", label: "Budget range" },
      { kind: "field", key: "intakeYear", label: "Intended intake" },
      { kind: "field", key: "currentQualification", label: "Current qualification" },
      { kind: "field", key: "counsellingOutcome", label: "Counselling outcome" },
    ],
    requiredCompletedTypes: ["COUNSELLING"],
    allowedNext: ["QUALIFIED"],
  },

  QUALIFIED: {
    requiredFields: [
      { kind: "field", key: "institutionId", label: "Institution" },
      { kind: "field", key: "interestedProgram", label: "Programme" },
      { kind: "field", key: "academicQualification", label: "Academic qualification" },
      { kind: "field", key: "englishStatus", label: "English status" },
    ],
    requiredCompletedTypes: ["ELIGIBILITY_REVIEW"],
    requiresChecklist: "DOCUMENT",
    allowedNext: ["APPLICATION_SUBMITTED"],
  },

  APPLICATION_SUBMITTED: {
    requiredFields: [
      { kind: "field", key: "applicationNumber", label: "Application number", source: "application" },
      { kind: "field", key: "submissionDate", label: "Submission date", source: "application" },
      { kind: "field", key: "submissionMethod", label: "Submission method", source: "application" },
    ],
    requiredCompletedTypes: [],
    allowedNext: ["AWAITING_DECISION"],
  },

  AWAITING_DECISION: {
    requiredFields: [],
    requiredCompletedTypes: [],
    // System-monitored: the institution holds the next move, so there is no
    // task to complete — but the chase must still be booked.
    requireCompletedActivity: false,
    // Spec: may only progress when an offer arrives or the application fails.
    allowedNext: ["OFFER_RECEIVED", "APPLICATION_REJECTED"],
  },

  OFFER_RECEIVED: {
    requiredFields: [
      { kind: "field", key: "offerType", label: "Offer type", source: "application" },
      { kind: "field", key: "studentDecision", label: "Student decision", source: "application" },
      // "(if applicable)" — dismissible, but only deliberately
      {
        kind: "conditional",
        key: "depositDeadline",
        label: "Deposit deadline",
        naKey: "depositDeadlineNotApplicable",
        source: "application",
      },
    ],
    requiredCompletedTypes: ["OFFER_REVIEW"],
    allowedNext: ["DEPOSIT_PAID"],
  },

  DEPOSIT_PAID: {
    requiredFields: [
      { kind: "field", key: "depositPaid", label: "Deposit confirmed", source: "application" },
      { kind: "field", key: "depositDate", label: "Deposit date", source: "application" },
      { kind: "field", key: "acceptanceStatus", label: "Acceptance status", source: "application" },
    ],
    requiredCompletedTypes: ["POST_OFFER_SUPPORT"],
    allowedNext: ["ENROLLED"],
  },

  ENROLLED: {
    requiredFields: [
      { kind: "field", key: "enrolmentDate", label: "Enrolment date" },
      { kind: "field", key: "institutionId", label: "Institution" },
      { kind: "field", key: "interestedProgram", label: "Programme" },
      { kind: "field", key: "intakeYear", label: "Intake" },
    ],
    requiredCompletedTypes: ["ENROLMENT_CONFIRMATION"],
    // Final stage — nothing further to schedule.
    requireFutureActivity: false,
    allowedNext: [],
    // Terminal, so these are entry conditions rather than exit conditions.
    validateOnEntry: true,
  },

  // Closed outcomes are entered through the close endpoint, which enforces its
  // own mandatory fields. Nothing progresses out of them except a deferred
  // reopen, which restores the prior stage directly.
  LOST: { requiredFields: [], requiredCompletedTypes: [], allowedNext: [], requireCompletedActivity: false, requireFutureActivity: false },
  DEFERRED: { requiredFields: [], requiredCompletedTypes: [], allowedNext: [], requireCompletedActivity: false, requireFutureActivity: false },
  APPLICATION_REJECTED: { requiredFields: [], requiredCompletedTypes: [], allowedNext: [], requireCompletedActivity: false, requireFutureActivity: false },
};

/** Human-readable names for the typed Required Tasks. */
export const ENGAGEMENT_LABELS: Record<LeadEngagementType, string> = {
  COUNSELLING: "Initial counselling",
  ELIGIBILITY_REVIEW: "Eligibility confirmation",
  OFFER_REVIEW: "Offer review with student",
  ENROLMENT_CONFIRMATION: "Enrolment confirmation",
  POST_OFFER_SUPPORT: "Post-offer support",
  CALL: "Call",
  MEETING: "Meeting",
  EMAIL: "Email",
  WHATSAPP: "WhatsApp",
  FOLLOW_UP: "Follow-up",
  OTHER: "Other",
};

/** Roles permitted to force a transition past its blockers. */
export const OVERRIDE_ROLES = ["REGIONAL_MANAGER", "SUPER_ADMIN"] as const;

export function canOverrideGate(role: string): boolean {
  return (OVERRIDE_ROLES as readonly string[]).includes(role);
}

// ─── Evaluation ──────────────────────────────────────────────────────────────

/**
 * Present means present. Existing columns are non-nullable strings that can
 * hold "", and a whitespace-only value is not an answer.
 */
function hasValue(v: unknown): boolean {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "boolean") return v === true;
  if (typeof v === "number") return !Number.isNaN(v);
  return true;
}

function pick(
  req: { source?: Source },
  lead: GateLead,
  application: GateApplication | null
): Record<string, unknown> {
  return (req.source === "application" ? application : lead) as Record<string, unknown>;
}

function toTime(v: Date | string | null | undefined): number | null {
  if (!v) return null;
  const d = typeof v === "string" ? new Date(v) : v;
  return Number.isNaN(d.getTime()) ? null : d.getTime();
}

/**
 * Evaluates whether `lead` may move to `targetStage`.
 *
 * `now` is injectable because the "future activity" test is time-dependent —
 * the same lead that could progress yesterday cannot today once its scheduled
 * follow-up falls into the past. That also means the result must never be
 * cached or persisted.
 */
export function evaluateStageGate(
  lead: GateLead,
  targetStage: LeadStage,
  activities: GateActivity[],
  options: {
    application?: GateApplication | null;
    checklist?: GateChecklistItem[];
    now?: Date;
  } = {}
): GateResult {
  const { application = null, checklist = [], now = new Date() } = options;
  const blockers: Blocker[] = [];
  const from = lead.stage;
  const config = STAGE_CONFIG[from];

  // ── Transition legality ────────────────────────────────────────────────
  const isClosing = (CLOSED_STAGES as readonly string[]).includes(targetStage);
  if (!isClosing) {
    if (!config.allowedNext.includes(targetStage)) {
      const allowed = config.allowedNext.length
        ? config.allowedNext.map((s) => STAGE_LABELS[s]).join(" or ")
        : "no further stage";
      blockers.push({
        kind: "TRANSITION",
        message: `${STAGE_LABELS[from]} can only move to ${allowed}.`,
      });
      // A disallowed transition makes the remaining checks meaningless.
      return { canProgress: false, blockers };
    }
    // Guard against skipping ahead even if config were ever mis-edited.
    const fi = stageIndex(from);
    const ti = stageIndex(targetStage);
    if (fi >= 0 && ti >= 0 && ti - fi > 1) {
      blockers.push({
        kind: "TRANSITION",
        message: "Stages must be completed in order — you cannot skip ahead.",
      });
      return { canProgress: false, blockers };
    }
  }

  // ── Required fields ────────────────────────────────────────────────────
  const checkFields = (reqs: FieldReq[]) => {
    for (const req of reqs) {
      if (req.kind === "field") {
        const src = pick(req, lead, application);
        if (!src || !hasValue(src[req.key])) {
          blockers.push({ kind: "FIELD", message: `${req.label} is required.`, field: req.key });
        }
      } else if (req.kind === "anyOf") {
        const src = pick(req, lead, application);
        if (!src || !req.keys.some((k) => hasValue(src[k]))) {
          blockers.push({ kind: "FIELD", message: `${req.label} is required.`, field: req.keys[0] });
        }
      } else {
        const src = pick(req, lead, application);
        const dismissed = req.naKey ? src?.[req.naKey] === true : false;
        if (!dismissed && (!src || !hasValue(src[req.key]))) {
          blockers.push({
            kind: "FIELD",
            message: req.naKey
              ? `${req.label} is required, or mark it not applicable.`
              : `${req.label} is required — record it, or note that it is not yet known.`,
            field: req.key,
          });
        }
      }
    }
  };

  checkFields(config.requiredFields);

  // A terminal stage's own requirements are checked on the way in, since there
  // is no way out for them to be checked on.
  const targetConfig = STAGE_CONFIG[targetStage];
  if (targetConfig?.validateOnEntry) checkFields(targetConfig.requiredFields);

  // ── Activities ─────────────────────────────────────────────────────────
  const stageEnteredAt = toTime(lead.stageEnteredAt) ?? 0;
  const nowMs = now.getTime();

  const live = activities.filter((a) => a.kind === "ENGAGEMENT" && !a.cancelledAt);

  /**
   * Only work done since the lead entered its current stage counts. Without
   * this, a lead that moved backwards, re-entered a stage, or was reopened
   * from Deferred would satisfy the gate instantly using historical activity.
   */
  const completedThisStage = live.filter((a) => {
    const c = toTime(a.completedAt);
    return c !== null && c >= stageEnteredAt && a.stageAtCompletion === from;
  });

  const futureScheduled = live.filter((a) => {
    const s = toTime(a.scheduledFor);
    return s !== null && s > nowMs && !a.completedAt;
  });

  const requireCompleted = config.requireCompletedActivity ?? true;
  const requireFuture = config.requireFutureActivity ?? true;

  // Typed Required Tasks — a specific kind of work, not merely any activity.
  // A terminal target's tasks are checked here too; the work is necessarily
  // done while the student is still in the preceding stage.
  const requiredTypes = [
    ...config.requiredCompletedTypes,
    ...(targetConfig?.validateOnEntry ? targetConfig.requiredCompletedTypes : []),
  ];
  for (const type of new Set(requiredTypes)) {
    if (!completedThisStage.some((a) => a.engagementType === type)) {
      blockers.push({
        kind: "ACTIVITY_COMPLETED",
        message: `${ENGAGEMENT_LABELS[type]} must be completed in this stage.`,
      });
    }
  }

  if (requireCompleted && config.requiredCompletedTypes.length === 0) {
    if (completedThisStage.length === 0) {
      blockers.push({
        kind: "ACTIVITY_COMPLETED",
        message: "At least one activity must be completed in this stage.",
      });
    }
  }

  if (requireFuture && futureScheduled.length === 0) {
    // Distinguish "nothing booked" from "booked but overdue" — the fix differs.
    const overdue = live.some((a) => {
      const s = toTime(a.scheduledFor);
      return s !== null && s <= nowMs && !a.completedAt;
    });
    blockers.push({
      kind: "ACTIVITY_SCHEDULED",
      message: overdue
        ? "A scheduled activity is overdue — complete it or move it to a future date."
        : "A future activity must be scheduled before moving on.",
    });
  }

  // ── Checklist ──────────────────────────────────────────────────────────
  if (config.requiresChecklist) {
    const has = checklist.some((c) => c.category === config.requiresChecklist);
    if (!has) {
      blockers.push({
        kind: "CHECKLIST",
        message: "The document checklist must be started before moving on.",
      });
    }
  }

  return { canProgress: blockers.length === 0, blockers };
}

/** The next stage in the funnel, or null at the end / for closed outcomes. */
export function nextStage(stage: LeadStage): LeadStage | null {
  const i = stageIndex(stage);
  if (i < 0 || i >= PIPELINE_STAGES.length - 1) return null;
  return PIPELINE_STAGES[i + 1];
}
