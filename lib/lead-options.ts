/**
 * The dropdown options shared by the online lead form and the offline capture
 * screen.
 *
 * Shared rather than duplicated because both forms post to endpoints validating
 * against the same Prisma enums. Two copies would drift the moment an enum
 * gains a value, and the failure is quiet: a mismatched value is rejected by zod
 * and reads to the user as the field simply not saving.
 *
 * Values must match the BudgetRange, EnglishStatus and StudyLevel enums exactly.
 */

import type {
  CounsellingOutcome,
  EligibilityOutcome,
  EnrolmentStatus,
} from "@prisma/client";

export const BUDGET_RANGES = [
  { value: "UNDER_10K", label: "Under $10,000" },
  { value: "FROM_10K_TO_20K", label: "$10,000 - $20,000" },
  { value: "FROM_20K_TO_35K", label: "$20,000 - $35,000" },
  { value: "FROM_35K_TO_50K", label: "$35,000 - $50,000" },
  { value: "OVER_50K", label: "Over $50,000" },
  { value: "UNDECIDED", label: "Undecided" },
] as const;

export const ENGLISH_STATUSES = [
  { value: "IELTS", label: "IELTS" },
  { value: "TOEFL", label: "TOEFL" },
  { value: "PTE", label: "PTE" },
  { value: "DUOLINGO", label: "Duolingo" },
  { value: "MOI", label: "Medium of Instruction letter" },
  { value: "NATIVE_SPEAKER", label: "Native speaker" },
  { value: "NOT_TAKEN", label: "Not taken yet" },
  { value: "EXEMPT", label: "Exempt" },
] as const;

export const STUDY_LEVELS = [
  { value: "UNDERGRADUATE", label: "Undergraduate" },
  { value: "POSTGRADUATE", label: "Postgraduate" },
  { value: "PATHWAY", label: "Pathway" },
  { value: "FOUNDATION", label: "Foundation" },
] as const;

/**
 * The lists below use an exhaustive `Record<PrismaEnum, string>` rather than the
 * hand-written `as const` arrays above. Adding a member to the enum without a
 * label FAILS THE BUILD and names the member, which the arrays cannot do — and
 * a silently missing option reads to the user as a field that will not save.
 *
 * Type-only imports on purpose: these are consumed by client components, and
 * importing `@prisma/client` for its runtime enum objects would pull the Prisma
 * runtime into the browser bundle.
 */

function optionsOf<T extends string>(labels: Record<T, string>): { value: T; label: string }[] {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}

// ─── Counselling outcome (spec §5) ───────────────────────────────────────────

export const COUNSELLING_OUTCOME_LABELS: Record<CounsellingOutcome, string> = {
  PROCEED_TO_ELIGIBILITY: "Proceed to eligibility assessment",
  FURTHER_COUNSELLING_REQUIRED: "Further counselling required",
  NOT_READY_YET: "Not ready yet",
  UNABLE_TO_CONTACT: "Unable to contact",
  NOT_SUITABLE: "Not suitable",
  LOST: "Lost",
  DEFERRED: "Deferred",
};

export const COUNSELLING_OUTCOMES = optionsOf(COUNSELLING_OUTCOME_LABELS);

/**
 * Counselling outcomes that permit moving on to Qualified.
 *
 * Spec §5 requires that "counselling outcome supports progression". Reading the
 * seven options, exactly one does: each of the others describes a reason to stay
 * where you are, or to close the journey. Anything looser would make the rule
 * decorative — which is what it was, since the gate checked the free-text field
 * for non-emptiness and this enum was never read anywhere at all.
 */
export const PROGRESSING_COUNSELLING_OUTCOMES: CounsellingOutcome[] = [
  "PROCEED_TO_ELIGIBILITY",
];

// ─── Eligibility outcome (spec §6) ───────────────────────────────────────────

export const ELIGIBILITY_OUTCOME_LABELS: Record<EligibilityOutcome, string> = {
  ELIGIBLE: "Eligible",
  PROVISIONALLY_ELIGIBLE: "Provisionally eligible",
  FURTHER_INFO_REQUIRED: "Further information required",
  NOT_ELIGIBLE: "Not eligible",
};

export const ELIGIBILITY_OUTCOMES = optionsOf(ELIGIBILITY_OUTCOME_LABELS);

/** Spec §6: "Eligibility outcome is Eligible or Provisionally Eligible". */
export const PROGRESSING_ELIGIBILITY_OUTCOMES: EligibilityOutcome[] = [
  "ELIGIBLE",
  "PROVISIONALLY_ELIGIBLE",
];

/**
 * Best to worst, for deriving a student-level answer from several journeys.
 *
 * The Student Profile mirrors the most advanced open interest, so its
 * eligibility has to come from somewhere too: a student counts as eligible if
 * any live journey says so. The ordering is explicit rather than the enum's
 * declaration order, because that order is not a ranking and relying on it
 * would silently change meaning if a member were ever inserted.
 */
export const ELIGIBILITY_RANK: EligibilityOutcome[] = [
  "ELIGIBLE",
  "PROVISIONALLY_ELIGIBLE",
  "FURTHER_INFO_REQUIRED",
  "NOT_ELIGIBLE",
];

// ─── Enrolment status (spec §11) ─────────────────────────────────────────────

export const ENROLMENT_STATUS_LABELS: Record<EnrolmentStatus, string> = {
  ENROLLED: "Enrolled",
  REGISTERED: "Registered",
  STARTED_STUDIES: "Started studies",
  DID_NOT_ARRIVE: "Did not arrive",
  WITHDREW_BEFORE_START: "Withdrew before start",
  DEFERRED_AFTER_DEPOSIT: "Deferred after deposit",
};

export const ENROLMENT_STATUSES = optionsOf(ENROLMENT_STATUS_LABELS);

export const MONTHS = [
  { value: 1, label: "January" },
  { value: 2, label: "February" },
  { value: 3, label: "March" },
  { value: 4, label: "April" },
  { value: 5, label: "May" },
  { value: 6, label: "June" },
  { value: 7, label: "July" },
  { value: 8, label: "August" },
  { value: 9, label: "September" },
  { value: 10, label: "October" },
  { value: 11, label: "November" },
  { value: 12, label: "December" },
];
