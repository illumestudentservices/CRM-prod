import type {
  AcceptanceStatus,
  ApplicationStatus,
  ApplicationSubmissionMethod,
  DepositStatus,
  OfferType,
  StudentDecision,
} from "@prisma/client";

/**
 * The single home for every application dropdown.
 *
 * Three lists used to disagree about what an application could hold: the Prisma
 * enum, a hand-written `z.enum([...])` in the applications route, and a
 * hand-written options array in the application panel. The route's list was the
 * narrowest, so it decided the answer — `offerType` accepted 4 of 7 values and
 * `studentDecision` 3 of 7, which meant the spec's Alternative Programme,
 * Waitlist, Intends to Accept, Considering, Awaiting Other Offers and
 * Requesting Deferral could not be recorded at all, and a request carrying one
 * was rejected with a validation error. Nothing failed loudly; the options were
 * simply absent.
 *
 * The fix is structural rather than a one-off correction. Each list below is a
 * `Record<PrismaEnum, string>`, so adding a member to the enum without giving
 * it a label FAILS THE BUILD and names the member. The selectable arrays and
 * the route's zod schemas are both derived from these maps, so the three lists
 * can no longer drift.
 *
 * Type-only imports on purpose: this module is imported by a client component,
 * and importing `@prisma/client` for its runtime enum objects would pull the
 * Prisma runtime into the browser bundle.
 */

/** Derives the selectable list from a label map, preserving declaration order. */
function optionsOf<T extends string>(labels: Record<T, string>): { value: T; label: string }[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}

// ─── Submission method (spec §7) ─────────────────────────────────────────────

/**
 * All eight members need a label so historic rows render, but only the six the
 * spec names are offered for new entry. `ONLINE_PORTAL` and `AGENT` predate
 * `UNIVERSITY_PORTAL` and `AGENT_PORTAL` and mean the same thing; offering both
 * pairs would ask the user to choose between synonyms.
 */
export const SUBMISSION_METHOD_LABELS: Record<ApplicationSubmissionMethod, string> = {
  UNIVERSITY_PORTAL: "University portal",
  AGENT_PORTAL: "Agent portal",
  EMAIL: "Email",
  DIRECT: "Direct submission",
  INTERNAL: "Internal admissions support",
  OTHER: "Other",
  // Legacy synonyms, readable but not offered.
  ONLINE_PORTAL: "Online portal (legacy)",
  AGENT: "Via agent (legacy)",
};

const LEGACY_SUBMISSION_METHODS: ApplicationSubmissionMethod[] = ["ONLINE_PORTAL", "AGENT"];

export const SUBMISSION_METHOD_OPTIONS = optionsOf(SUBMISSION_METHOD_LABELS).filter(
  (o) => !LEGACY_SUBMISSION_METHODS.includes(o.value)
);

// ─── Offer type (spec §9) ────────────────────────────────────────────────────

/**
 * The spec names Conditional, Unconditional, Alternative Programme, Waitlist
 * and Other. `SCHOLARSHIP` and `REJECTED` are additions this business already
 * relies on — the application list renders a rejection banner off
 * `offerType === "REJECTED"` — so both stay selectable.
 */
export const OFFER_TYPE_LABELS: Record<OfferType, string> = {
  CONDITIONAL: "Conditional",
  UNCONDITIONAL: "Unconditional",
  ALTERNATIVE_PROGRAMME: "Alternative programme",
  WAITLIST: "Waitlist",
  SCHOLARSHIP: "Scholarship",
  REJECTED: "Rejected",
  OTHER: "Other",
};

export const OFFER_TYPE_OPTIONS = optionsOf(OFFER_TYPE_LABELS);

// ─── Student decision (spec §9) ──────────────────────────────────────────────

export const STUDENT_DECISION_LABELS: Record<StudentDecision, string> = {
  ACCEPTED: "Accepted",
  INTENDS_TO_ACCEPT: "Intends to accept",
  CONSIDERING: "Considering",
  AWAITING_OTHERS: "Awaiting other offers",
  DECLINED: "Declined",
  REQUESTING_DEFERRAL: "Requesting deferral",
  UNDECIDED: "Undecided",
};

export const STUDENT_DECISION_OPTIONS = optionsOf(STUDENT_DECISION_LABELS);

/**
 * Decisions that support moving on to Deposit Paid / Offer Accepted.
 *
 * Spec §9 makes this a condition of progression — "student decision supports
 * progression" — which the gate previously read as "a decision is present",
 * so a student recorded as Declined could be advanced.
 *
 * `DECLINED` is the one that must block: the student has said no, and the
 * journey should be closed rather than progressed. `UNDECIDED` blocks too — it
 * is the absence of a decision wearing the clothes of one. Everything else,
 * including Considering and Awaiting Other Offers, is a live opportunity, and
 * a deposit can legitimately arrive before the student formally accepts.
 */
export const PROGRESSING_STUDENT_DECISIONS: StudentDecision[] = [
  "ACCEPTED",
  "INTENDS_TO_ACCEPT",
  "CONSIDERING",
  "AWAITING_OTHERS",
  "REQUESTING_DEFERRAL",
];

// ─── Deposit status (spec §10) ───────────────────────────────────────────────

export const DEPOSIT_STATUS_LABELS: Record<DepositStatus, string> = {
  NOT_REQUIRED: "Not required",
  PENDING: "Pending",
  PAID: "Paid",
  PARTIALLY_PAID: "Partially paid",
  WAIVED: "Waived",
  REFUNDED: "Refunded",
};

export const DEPOSIT_STATUS_OPTIONS = optionsOf(DEPOSIT_STATUS_LABELS);

/**
 * Deposit states that satisfy the Enrolled gate.
 *
 * Spec §10: progression is allowed when the deposit is "Paid, Waived or Not
 * Required". The gate used to require a `depositPaid` boolean to be true, and
 * a boolean cannot express the other two — so an institution that waives the
 * deposit, or does not ask for one, left the student permanently one stage
 * short of Enrolled with no way to say why.
 */
export const SETTLED_DEPOSIT_STATUSES: DepositStatus[] = ["PAID", "WAIVED", "NOT_REQUIRED"];

// ─── Acceptance status (spec §10) ────────────────────────────────────────────

export const ACCEPTANCE_STATUS_LABELS: Record<AcceptanceStatus, string> = {
  ACCEPTED: "Accepted",
  DEFERRED: "Deferred",
  WITHDRAWN: "Withdrawn",
};

export const ACCEPTANCE_STATUS_OPTIONS = optionsOf(ACCEPTANCE_STATUS_LABELS);

// ─── Application status (spec §8) ────────────────────────────────────────────

/**
 * Spec §8's six institution-side statuses, added by migration 037, plus the six
 * pre-existing members that describe OUR position in the process.
 *
 * Both sets live in one enum because the specification treats "current
 * application status" as a single field and nothing in the codebase branches on
 * any of these values. The older members are labelled "(our status)" so the two
 * vocabularies are distinguishable on screen rather than silently mixed.
 *
 * `AWAITING_DECISION` is NOT relabelled "Under review" any more — that reading
 * is what hid the gap. It is a pipeline stage name; `UNDER_REVIEW` is the
 * institution actually reviewing the application, and they are different facts.
 */
export const APPLICATION_STATUS_LABELS: Record<ApplicationStatus, string> = {
  // Spec §8 — the institution's position. Offer these first; they are what an
  // ICR is recording when an institution comes back to them.
  UNDER_REVIEW: "Under review",
  ADDITIONAL_DOCUMENTS_REQUIRED: "Additional documents required",
  INTERVIEW_REQUIRED: "Interview required",
  ON_HOLD: "On hold",
  DECISION_DELAYED: "Decision delayed",
  DECISION_RECEIVED: "Decision received",
  // Pre-existing — our own position.
  SUBMITTED: "Submitted (our status)",
  AWAITING_DECISION: "Awaiting decision (our status)",
  OFFER_RECEIVED: "Offer received (our status)",
  ACCEPTED: "Accepted (our status)",
  REJECTED: "Rejected (our status)",
  WITHDRAWN: "Withdrawn (our status)",
};

export const APPLICATION_STATUS_OPTIONS = optionsOf(APPLICATION_STATUS_LABELS);

/**
 * The six statuses spec §8 defines for an application under institutional
 * review. The Awaiting Decision gate requires one of these rather than merely
 * requiring `status` to be present — it defaults to SUBMITTED on every row, so
 * a presence check would be satisfied by every application ever created.
 */
export const INSTITUTION_APPLICATION_STATUSES: ApplicationStatus[] = [
  "UNDER_REVIEW",
  "ADDITIONAL_DOCUMENTS_REQUIRED",
  "INTERVIEW_REQUIRED",
  "ON_HOLD",
  "DECISION_DELAYED",
  "DECISION_RECEIVED",
];

/**
 * Statuses that mean the institution has asked for something.
 *
 * Spec §8 requires a task to be created when additional documents are needed,
 * and lists the ICR's triggers for acting while an application is under review.
 */
export const AWAITING_INSTITUTION_ACTION: ApplicationStatus[] = [
  "ADDITIONAL_DOCUMENTS_REQUIRED",
  "INTERVIEW_REQUIRED",
];

/** Every member of a label map, as a tuple zod's `z.enum` will accept. */
export function enumValues<T extends string>(labels: Record<T, string>): [T, ...T[]] {
  const keys = Object.keys(labels) as T[];
  return keys as [T, ...T[]];
}
