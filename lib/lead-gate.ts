import type {
  LeadStage,
  LeadEngagementType,
  LeadActivityKind,
} from "@prisma/client";
import { PIPELINE_STAGES, CLOSED_STAGES, STAGE_LABELS, stageIndex } from "./lead-pipeline";
import {
  AWAITING_INSTITUTION_ACTION,
  INSTITUTION_APPLICATION_STATUSES,
  PROGRESSING_STUDENT_DECISIONS,
  SETTLED_DEPOSIT_STATUSES,
} from "./application-options";
import {
  ELIGIBILITY_RANK,
  PROGRESSING_COUNSELLING_OUTCOMES,
  PROGRESSING_ELIGIBILITY_OUTCOMES,
} from "./lead-options";
import { hasCapability } from "@/lib/granular-permissions";
import type { Role } from "@/lib/permissions";

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

/**
 * Where the user has to go to satisfy a requirement.
 *
 * The blocker list used to name a field and stop there — "Budget range is
 * required" with no indication that it lives on the edit form, while
 * "Eligibility outcome is required" meant a different record entirely and
 * "Initial counselling must be completed" meant a dialog three cards down the
 * page. Naming the destination here, next to the rule itself, is what lets the
 * UI turn each line into a button; computed in the UI instead it would be a
 * second copy of the rules, which is the two-map drift this codebase keeps
 * being bitten by.
 */
export type RequirementTarget =
  /** A column on the student — the edit form. */
  | { where: "lead"; field: string }
  /** A column on the active application — the Pipeline progress section. */
  | { where: "application"; field: string }
  /** A column on the institution interest (journey). */
  | { where: "interest"; field: string }
  /** No journey exists yet; one must be created. */
  | { where: "interestCreate" }
  /** A typed engagement that must be logged as done. */
  | { where: "activityLog"; engagementType: LeadEngagementType }
  /** Any engagement, booked in the future. */
  | { where: "activitySchedule" }
  | { where: "checklist" }
  /** Nothing to act on — an illegal transition. */
  | { where: "none" };

/**
 * One rule for leaving a stage, satisfied or not.
 *
 * `blockers` answers "why can't I move on"; this answers "what does this stage
 * want of me", which is the question people actually arrive with. Both are
 * produced by the same pass so they cannot disagree.
 */
export interface Requirement {
  /** Stable within a stage — safe as a React key. */
  id: string;
  /** Short noun phrase: "Budget range", "Initial counselling". */
  label: string;
  done: boolean;
  /** Present only when not done, and only when it adds to the label. */
  detail?: string;
  /** Present only when done, e.g. "done 12 Sep, at New Lead". */
  doneNote?: string;
  target: RequirementTarget;
}

export interface GateResult {
  canProgress: boolean;
  blockers: Blocker[];
  /** Every rule for this transition, in the order they are worth doing. */
  requirements: Requirement[];
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
  /** Spec §5 — the categorical outcome the Contacted gate now tests. */
  counsellingOutcomeEnum?: string | null;
  institutionId?: string | null;
  academicQualification?: string | null;
  englishStatus?: string | null;
  studyLevel?: string | null;
  enrolmentDate?: Date | string | null;
  /**
   * Spec §6. Owned by the Institution Interest; on the Student Profile path it
   * is derived from the student's open journeys by `bestEligibilityOutcome`.
   */
  eligibilityOutcome?: string | null;
  /**
   * Spec §5 — "at least one Institution Interest has been created". Supplied by
   * the caller, which is the only place that knows the student's journeys.
   */
  hasInstitutionInterest?: boolean | null;
}

/**
 * The most favourable eligibility outcome across a student's open journeys.
 *
 * The Student Profile has no eligibility column of its own — eligibility is
 * assessed per institution, which is the whole point of the split. But the
 * Profile's stage mirrors the most advanced open journey, so the gate on that
 * path needs an answer too. A student counts as eligible if any live journey
 * says they are; returns null when no journey has been assessed.
 */
export function bestEligibilityOutcome(
  interests: { eligibilityOutcome?: string | null }[]
): string | null {
  let best: string | null = null;
  let bestRank = Number.POSITIVE_INFINITY;
  for (const i of interests) {
    if (!i.eligibilityOutcome) continue;
    const rank = (ELIGIBILITY_RANK as readonly string[]).indexOf(i.eligibilityOutcome);
    if (rank >= 0 && rank < bestRank) {
      bestRank = rank;
      best = i.eligibilityOutcome;
    }
  }
  return best;
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
  /** Spec §10 — the categorical deposit lifecycle the boolean cannot express. */
  depositStatus?: string | null;
  /** Spec §9 "Offer date". */
  offerReceivedAt?: Date | string | null;
  /** Spec §10 — when the acceptance was recorded (migration 037). */
  acceptanceDate?: Date | string | null;
  /** Spec §8 Stage 5 required fields (migration 037). */
  status?: string | null;
  lastInstitutionUpdateAt?: Date | string | null;
  expectedDecisionDate?: Date | string | null;
  outstandingRequirement?: string | null;
  /** Spec §7 — the alternative to a reference number (migration 037). */
  submissionEvidence?: string | null;
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

/**
 * Restricts a requirement to the cases where it genuinely applies.
 *
 * Receives the same record the requirement reads from. Needed because some
 * fields are only meaningful given the value of another: a deposit date is
 * required when the deposit was paid and meaningless when it was waived.
 * Without this, "where applicable" could only be modelled as "always" or
 * "never", and both are wrong.
 */
type Applies = (source: Record<string, unknown>) => boolean;

type FieldReqBase = {
  label: string;
  source?: Source;
  when?: Applies;
  /**
   * Overrides the destination derived from `source`.
   *
   * Two requirements are read off the lead but are not editable there:
   * `hasInstitutionInterest` is satisfied by creating a journey, and
   * `eligibilityOutcome` is a column on one. Sending people to the edit form
   * for either would be sending them somewhere the field does not exist.
   */
  target?: RequirementTarget;
};

type FieldReq =
  /** A single value that must be present. */
  | ({ kind: "field"; key: string } & FieldReqBase)
  /**
   * At least one of several. The spec says "Email or Phone" — one requirement
   * satisfied two ways, not two requirements.
   */
  | ({ kind: "anyOf"; keys: string[] } & FieldReqBase)
  /**
   * Required unless explicitly marked not applicable. `naKey` names the boolean
   * that records that decision, so "deliberately N/A" stays distinguishable
   * from "nobody has filled this in".
   */
  | ({ kind: "conditional"; key: string; naKey?: string } & FieldReqBase)
  /**
   * Present AND one of a permitted set.
   *
   * The spec repeatedly makes progression conditional on a field's VALUE, not
   * merely on its presence — "eligibility outcome is Eligible or Provisionally
   * Eligible", "student decision supports progression", "deposit is Paid,
   * Waived or Not Required". Modelled as `kind: "field"`, all three were
   * satisfied by any value at all, so a student recorded as Declined could be
   * advanced and a waived deposit could not.
   */
  | ({ kind: "enumIn"; key: string; allowed: readonly string[] } & FieldReqBase);

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
      // Both, not either. Creation requires each of them and neither can be
      // cleared afterwards, so an "email or phone" gate would advertise a
      // looser rule than the one the system actually enforces.
      { kind: "field", key: "email", label: "Email" },
      { kind: "field", key: "phone", label: "Phone" },
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
      // Spec §5: the outcome must SUPPORT progression. This was previously a
      // presence check on the free-text `counsellingOutcome`, so any text at
      // all satisfied it, while `counsellingOutcomeEnum` — added for exactly
      // this rule — was read by nothing in the entire codebase.
      {
        kind: "enumIn",
        key: "counsellingOutcomeEnum",
        label: "Counselling outcome",
        allowed: PROGRESSING_COUNSELLING_OUTCOMES,
      },
      // Spec §5: "at least one Institution Interest has been created".
      // A boolean rather than a count, because `hasValue` treats 0 as present.
      {
        kind: "field",
        key: "hasInstitutionInterest",
        label: "At least one institution interest",
        target: { where: "interestCreate" },
      },
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
      { kind: "field", key: "studyLevel", label: "Study level" },
      { kind: "field", key: "intakeYear", label: "Intake" },
      // Spec §6: "Eligibility outcome is Eligible or Provisionally Eligible".
      // The column lives on the Institution Interest; on the Student Profile
      // path it is derived from the student's open journeys — see
      // `bestEligibilityOutcome`.
      {
        kind: "enumIn",
        key: "eligibilityOutcome",
        label: "Eligibility outcome",
        allowed: PROGRESSING_ELIGIBILITY_OUTCOMES,
        target: { where: "interest", field: "eligibilityOutcome" },
      },
    ],
    requiredCompletedTypes: ["ELIGIBILITY_REVIEW"],
    requiresChecklist: "DOCUMENT",
    allowedNext: ["APPLICATION_SUBMITTED"],
  },

  APPLICATION_SUBMITTED: {
    requiredFields: [
      // Spec §7: the reference is required "where available", with submission
      // confirmation or evidence as the alternative "where no reference number
      // exists". This was an unconditional requirement on the reference alone,
      // so an application submitted by email — or to an institution that issues
      // no reference — could never leave this stage. `submissionEvidence`
      // (migration 037) is the alternative the spec asks for.
      {
        kind: "anyOf",
        keys: ["applicationNumber", "submissionEvidence"],
        label: "Application reference, or evidence of submission",
        source: "application",
      },
      { kind: "field", key: "submissionDate", label: "Submission date", source: "application" },
      { kind: "field", key: "submissionMethod", label: "Submission method", source: "application" },
    ],
    requiredCompletedTypes: [],
    allowedNext: ["AWAITING_DECISION"],
  },

  AWAITING_DECISION: {
    // Spec §8's four required fields. This list was empty: three of the four
    // columns did not exist until migration 037, so nothing could be asked for.
    requiredFields: [
      // "Current application status" — and it must be one of the statuses the
      // spec defines for this stage, not merely present. A plain presence check
      // would be vacuous, since `status` defaults to SUBMITTED on every row.
      {
        kind: "enumIn",
        key: "status",
        label: "Application status",
        allowed: INSTITUTION_APPLICATION_STATUSES,
        source: "application",
      },
      {
        kind: "field",
        key: "lastInstitutionUpdateAt",
        label: "Last institutional update",
        source: "application",
      },
      // "where known"
      {
        kind: "conditional",
        key: "expectedDecisionDate",
        label: "Expected decision date",
        source: "application",
      },
      // "where applicable" — only when the institution has actually asked for
      // something. Demanding it otherwise would be asking the ICR to invent one.
      {
        kind: "field",
        key: "outstandingRequirement",
        label: "Outstanding requirement",
        source: "application",
        when: (a) =>
          (AWAITING_INSTITUTION_ACTION as readonly string[]).includes(String(a.status)),
      },
    ],
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
      // Spec §9 "Offer date".
      { kind: "field", key: "offerReceivedAt", label: "Offer date", source: "application" },
      // Spec §9: the decision must SUPPORT progression, not merely exist.
      // Declined and Undecided block; see PROGRESSING_STUDENT_DECISIONS.
      {
        kind: "enumIn",
        key: "studentDecision",
        label: "Student decision",
        allowed: PROGRESSING_STUDENT_DECISIONS,
        source: "application",
      },
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
      // Spec §10: "Deposit is Paid, Waived or Not Required". This replaced a
      // `depositPaid` boolean requirement, which could not express the last two
      // — so an institution that waived the deposit left the student stuck one
      // stage short of Enrolled with no field in which to say so.
      {
        kind: "enumIn",
        key: "depositStatus",
        label: "Deposit status",
        allowed: SETTLED_DEPOSIT_STATUSES,
        source: "application",
      },
      // Only meaningful when money actually moved. Spec: "where applicable".
      {
        kind: "field",
        key: "depositDate",
        label: "Deposit date",
        source: "application",
        when: (a) => a.depositStatus === "PAID" || a.depositStatus === "PARTIALLY_PAID",
      },
      { kind: "field", key: "acceptanceStatus", label: "Acceptance status", source: "application" },
      // Spec §10 "Acceptance date" (migration 037). The status recorded what was
      // decided with no record of when.
      { kind: "field", key: "acceptanceDate", label: "Acceptance date", source: "application" },
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
  // Spec §15 — WITHDRAWN is entered via the close endpoint; treated like LOST
  // for gate purposes.
  WITHDRAWN: { requiredFields: [], requiredCompletedTypes: [], allowedNext: [], requireCompletedActivity: false, requireFutureActivity: false },
  // Spec §15 — VISA_REFUSED is a specialised close outcome. Handled entirely
  // by the close endpoint's discriminated union.
  VISA_REFUSED: { requiredFields: [], requiredCompletedTypes: [], allowedNext: [], requireCompletedActivity: false, requireFutureActivity: false },
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

/**
 * Roles permitted to force a transition past its blockers, BY DEFAULT.
 *
 * Kept only as the registry default for `leads.override_stage_gate` — see
 * lib/granular-permissions.ts. It is no longer the gate itself: this list was
 * the real check while the Security screen showed an "Override pipeline stage
 * gates" toggle that read nothing, so switching that toggle off left the role
 * overriding exactly as before. An administrator was being shown a control that
 * did nothing.
 */
export const OVERRIDE_ROLES = ["REGIONAL_MANAGER", "SUPER_ADMIN"] as const;

/**
 * Async because the answer now depends on stored overrides, not just the role.
 * Every caller is already in an async context.
 */
export async function canOverrideGate(role: string): Promise<boolean> {
  return hasCapability(role as Role, "leads.override_stage_gate");
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

/** ENUM_VALUE -> "Enum value", for blocker messages users have to act on. */
function humanise(v: string): string {
  const words = v.replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Fills in `depositStatus` for rows written before that column was used.
 *
 * Deposit state was a boolean for most of this system's life, and the gate now
 * reads the categorical column. Without this, every application recorded before
 * the change would read "deposit status is required" despite showing a paid
 * deposit and a deposit date — a rule tightening that looks like data loss.
 */
function normaliseApplication(app: GateApplication | null): GateApplication | null {
  if (!app) return null;
  if (app.depositStatus) return app;
  return { ...app, depositStatus: app.depositPaid ? "PAID" : null };
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
    /**
     * When the student was last put back into the pipeline from a closed
     * outcome. Work finished before it belongs to the previous attempt and is
     * not allowed to satisfy this one — see `typedTaskDone`.
     */
    pipelineRestartedAt?: Date | string | null;
  } = {}
): GateResult {
  const {
    application: rawApplication = null,
    checklist = [],
    now = new Date(),
    pipelineRestartedAt = null,
  } = options;
  const application = normaliseApplication(rawApplication);
  const from = lead.stage;
  const config = STAGE_CONFIG[from];

  /** Carries what a Blocker needs alongside what a Requirement needs. */
  type Internal = Requirement & {
    blockerKind: BlockerKind;
    /** The long form, used when the rule is reported as a failure. */
    message: string;
    field?: string;
  };

  const requirements: Internal[] = [];
  const add = (r: Internal) => requirements.push(r);

  /** Blockers are the unmet requirements — derived, never accumulated twice. */
  const finish = (): GateResult => {
    const blockers: Blocker[] = requirements
      .filter((r) => !r.done)
      .map((r) => ({
        kind: r.blockerKind,
        message: r.message,
        ...(r.field ? { field: r.field } : {}),
      }));
    return {
      canProgress: blockers.length === 0,
      blockers,
      requirements: requirements.map(
        ({ blockerKind: _kind, message: _message, field: _field, ...rest }) => rest
      ),
    };
  };

  // ── Transition legality ────────────────────────────────────────────────
  const isClosing = (CLOSED_STAGES as readonly string[]).includes(targetStage);
  if (!isClosing) {
    if (!config.allowedNext.includes(targetStage)) {
      const allowed = config.allowedNext.length
        ? config.allowedNext.map((s) => STAGE_LABELS[s]).join(" or ")
        : "no further stage";
      add({
        id: "transition",
        label: "This move is not allowed",
        done: false,
        target: { where: "none" },
        blockerKind: "TRANSITION",
        message: `${STAGE_LABELS[from]} can only move to ${allowed}.`,
        detail: `${STAGE_LABELS[from]} can only move to ${allowed}.`,
      });
      // A disallowed transition makes the remaining checks meaningless.
      return finish();
    }
    // Guard against skipping ahead even if config were ever mis-edited.
    const fi = stageIndex(from);
    const ti = stageIndex(targetStage);
    if (fi >= 0 && ti >= 0 && ti - fi > 1) {
      add({
        id: "transition",
        label: "Stages must be done in order",
        done: false,
        target: { where: "none" },
        blockerKind: "TRANSITION",
        message: "Stages must be completed in order — you cannot skip ahead.",
        detail: "You cannot skip ahead.",
      });
      return finish();
    }
  }

  // ── Required fields ────────────────────────────────────────────────────
  /** Where the user must go to supply this field, absent an explicit target. */
  const targetFor = (req: FieldReq, key: string): RequirementTarget =>
    req.target ?? { where: req.source === "application" ? "application" : "lead", field: key };

  const checkFields = (reqs: FieldReq[]) => {
    for (const req of reqs) {
      // "Where applicable" — skip requirements whose precondition is unmet.
      if (req.when) {
        const src = pick(req, lead, application);
        if (!src || !req.when(src)) continue;
      }

      const src = pick(req, lead, application);
      const key = req.kind === "anyOf" ? req.keys[0] : req.key;
      const base = {
        id: `field:${key}`,
        label: req.label,
        target: targetFor(req, key),
        blockerKind: "FIELD" as const,
        field: key,
      };

      if (req.kind === "field") {
        const done = !!src && hasValue(src[req.key]);
        add({ ...base, done, message: `${req.label} is required.` });
      } else if (req.kind === "anyOf") {
        const done = !!src && req.keys.some((k) => hasValue(src[k]));
        add({ ...base, done, message: `${req.label} is required.` });
      } else if (req.kind === "enumIn") {
        const value = src?.[req.key];
        if (!hasValue(value)) {
          add({ ...base, done: false, message: `${req.label} is required.` });
        } else if (!req.allowed.includes(String(value))) {
          // Naming the offending value matters: "Student decision is required"
          // is baffling when a decision is plainly recorded on screen.
          const message = `${req.label} is "${humanise(String(value))}", which does not allow moving on.`;
          add({
            ...base,
            done: false,
            message,
            detail: `Currently "${humanise(String(value))}", which does not allow moving on.`,
          });
        } else {
          add({ ...base, done: true, message: `${req.label} is required.` });
        }
      } else {
        const dismissed = req.naKey ? src?.[req.naKey] === true : false;
        const done = dismissed || (!!src && hasValue(src[req.key]));
        add({
          ...base,
          done,
          message: req.naKey
            ? `${req.label} is required, or mark it not applicable.`
            : `${req.label} is required — record it, or note that it is not yet known.`,
          ...(done ? {} : { detail: req.naKey ? "Or mark it not applicable." : "Or note that it is not yet known." }),
        });
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
  const restartedAt = toTime(pipelineRestartedAt);
  const nowMs = now.getTime();

  const live = activities.filter((a) => a.kind === "ENGAGEMENT" && !a.cancelledAt);

  /**
   * Only work done since the lead entered its current stage counts. Without
   * this, a lead that moved backwards or re-entered a stage would satisfy the
   * gate instantly using historical activity.
   *
   * This still governs the GENERIC "at least one activity" rule. The typed
   * Required Tasks are deliberately looser — see `typedTaskDone`.
   */
  const completedThisStage = live.filter((a) => {
    const c = toTime(a.completedAt);
    return c !== null && c >= stageEnteredAt && a.stageAtCompletion === from;
  });

  /**
   * A typed Required Task counts when it was completed at this stage OR at an
   * earlier one, provided it belongs to the current run through the pipeline.
   *
   * ── WHY IT IS NOT STAGE-EXACT ───────────────────────────────────────────
   *
   * It used to be, and the result read as a contradiction on screen: an ICR
   * who did the initial counselling before marking the student Contacted saw
   * the activity sitting in the panel with a green tick and "Completed", and
   * the amber panel directly above it saying "Initial counselling must be
   * completed in this stage". Both were true — the work was done, but stamped
   * against New Lead — and the only way out was to log the same conversation a
   * second time, which puts a duplicate in the student's history to satisfy a
   * rule nobody could see. The stage a task was stamped against is an accident
   * of when someone pressed a button; the work either happened or it did not.
   *
   * ── WHAT STILL GUARDS IT ────────────────────────────────────────────────
   *
   * Two things, so this is a loosening and not a removal:
   *  - LATER stages do not count. Index order is enforced, so a task stamped
   *    against Qualified cannot reach back and satisfy Contacted.
   *  - Work from before a close-and-reopen does not count. Reopening restores
   *    the stage but the student has been through a full outcome since; letting
   *    a counselling from eight months ago clear the gate on the day they are
   *    reopened would make the restart meaningless. `pipelineRestartedAt` is
   *    the reopen marker.
   * Rows predating the `stageAtCompletion` column (null) are trusted, as they
   * were before — the alternative is calling old work undone.
   */
  const fromIndex = stageIndex(from);
  const typedMatches = (type: LeadEngagementType) =>
    live.filter((a) => {
      if (a.engagementType !== type) return false;
      const c = toTime(a.completedAt);
      if (c === null) return false;
      if (restartedAt !== null && c < restartedAt) return false;
      if (a.stageAtCompletion == null) return true;
      const si = stageIndex(a.stageAtCompletion);
      return si < 0 || fromIndex < 0 || si <= fromIndex;
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
    const matches = typedMatches(type);
    const hit = matches[0];
    add({
      id: `activity:${type}`,
      label: ENGAGEMENT_LABELS[type],
      done: matches.length > 0,
      target: { where: "activityLog", engagementType: type },
      blockerKind: "ACTIVITY_COMPLETED",
      message: `${ENGAGEMENT_LABELS[type]} must be completed.`,
      ...(hit ? { doneNote: describeCompletion(hit, from) } : { detail: "Log it once it has been done." }),
    });
  }

  if (requireCompleted && config.requiredCompletedTypes.length === 0) {
    add({
      id: "activity:any",
      label: "An activity completed in this stage",
      done: completedThisStage.length > 0,
      target: { where: "activityLog", engagementType: "FOLLOW_UP" },
      blockerKind: "ACTIVITY_COMPLETED",
      message: "At least one activity must be completed in this stage.",
      ...(completedThisStage.length > 0
        ? {}
        : { detail: "Log a call, meeting or email you have already had." }),
    });
  }

  if (requireFuture) {
    // Distinguish "nothing booked" from "booked but overdue" — the fix differs.
    const overdue = live.some((a) => {
      const s = toTime(a.scheduledFor);
      return s !== null && s <= nowMs && !a.completedAt;
    });
    const done = futureScheduled.length > 0;
    add({
      id: "activity:scheduled",
      label: "A next step booked",
      done,
      target: { where: "activitySchedule" },
      blockerKind: "ACTIVITY_SCHEDULED",
      message: overdue
        ? "A scheduled activity is overdue — complete it or move it to a future date."
        : "A future activity must be scheduled before moving on.",
      ...(done
        ? {}
        : {
            detail: overdue
              ? "One is booked but overdue — complete it, or move it to a future date."
              : "Schedule the next contact.",
          }),
    });
  }

  // ── Checklist ──────────────────────────────────────────────────────────
  if (config.requiresChecklist) {
    add({
      id: "checklist",
      label: "Document checklist started",
      done: checklist.some((c) => c.category === config.requiresChecklist),
      target: { where: "checklist" },
      blockerKind: "CHECKLIST",
      message: "The document checklist must be started before moving on.",
    });
  }

  return finish();
}

/** "done 12 Sep, at New Lead" — says which stage the credit came from. */
function describeCompletion(a: GateActivity, currentStage: LeadStage): string {
  const when = toTime(a.completedAt);
  const date = when
    ? new Date(when).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : null;
  const stamped = a.stageAtCompletion;
  const elsewhere = stamped && stamped !== currentStage ? STAGE_LABELS[stamped] : null;
  if (date && elsewhere) return `done ${date}, at ${elsewhere}`;
  if (date) return `done ${date}`;
  return "done";
}

/** The next stage in the funnel, or null at the end / for closed outcomes. */
export function nextStage(stage: LeadStage): LeadStage | null {
  const i = stageIndex(stage);
  if (i < 0 || i >= PIPELINE_STAGES.length - 1) return null;
  return PIPELINE_STAGES[i + 1];
}
