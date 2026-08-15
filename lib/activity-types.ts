import type { ActivityType } from "@prisma/client";

/**
 * Field Operations activity types — the single source of truth.
 *
 * This file exists because the list was duplicated: the form offered all
 * fourteen current types while three API routes validated against a hardcoded
 * five. Choosing any of the other eleven produced a 422 that the form logged to
 * the console and never showed, so the activity was silently discarded and the
 * user had no idea. Eleven of the fourteen categories of field work could not
 * be recorded at all.
 *
 * Both the form and the routes now import from here. Do not re-type either list
 * at a call site.
 */

/**
 * The types a user may choose today.
 *
 * `STUDENT_EVENT` and `FAIR` are deliberately absent — see LEGACY below.
 */
export const ACTIVITY_TYPES = [
  "SCHOOL_VISIT",
  "SCHOOL_PRESENTATION",
  "AGENT_MEETING",
  "AGENT_TRAINING",
  "CLIENT_MEETING",
  "PARTNER_MEETING",
  "MARKET_RESEARCH",
  "STUDENT_FOLLOW_UP_SESSION",
  "EVENT_PREPARATION",
  "EVENT_FOLLOW_UP",
  "REPORT_SUBMISSION",
  "DELEGATION_SUPPORT",
  "INTERNAL_REVIEW",
  "OTHER",
] as const satisfies readonly ActivityType[];

/**
 * Retired values, kept in the enum only so existing rows still read.
 *
 * Migration 019 remaps STUDENT_EVENT → EVENT_FOLLOW_UP and FAIR →
 * EVENT_PREPARATION. The old write validation accepted both, so until now the
 * API would happily create NEW rows using values the migration had just retired
 * — which is why they must not be in the writable list above.
 */
export const LEGACY_ACTIVITY_TYPES = ["STUDENT_EVENT", "FAIR"] as const satisfies readonly ActivityType[];

/** Everything that can appear on a stored row, for reading and filtering. */
export const ALL_ACTIVITY_TYPES = [
  ...ACTIVITY_TYPES,
  ...LEGACY_ACTIVITY_TYPES,
] as const satisfies readonly ActivityType[];

/**
 * Compile-time proof that the two lists together cover the whole enum.
 *
 * The original bug was precisely that a list drifted from the enum with nothing
 * to catch it. Adding a value to ActivityType without deciding whether it is
 * writable or legacy now fails the build and names it. `[T] extends [never]`
 * rather than `T extends never` so the check does not distribute and vacuously
 * pass. Same guard as ALL_STAGES in lib/lead-pipeline.ts.
 */
type UncoveredActivityType = Exclude<ActivityType, (typeof ALL_ACTIVITY_TYPES)[number]>;
const _activityTypeCoverage: [UncoveredActivityType] extends [never]
  ? true
  : { ERROR: "ActivityType missing from ACTIVITY_TYPES or LEGACY_ACTIVITY_TYPES"; missing: UncoveredActivityType } =
  true;
void _activityTypeCoverage;

export const ACTIVITY_TYPE_LABELS: Record<string, string> = {
  SCHOOL_VISIT: "School Visit",
  SCHOOL_PRESENTATION: "School Presentation",
  AGENT_MEETING: "Agent Meeting",
  AGENT_TRAINING: "Agent Training",
  CLIENT_MEETING: "Client Meeting",
  PARTNER_MEETING: "Partner Meeting",
  MARKET_RESEARCH: "Market Research",
  STUDENT_FOLLOW_UP_SESSION: "Student Follow-up Session",
  EVENT_PREPARATION: "Event Preparation",
  EVENT_FOLLOW_UP: "Event Follow-up",
  REPORT_SUBMISSION: "Report Submission",
  DELEGATION_SUPPORT: "Delegation Support",
  INTERNAL_REVIEW: "Internal Review",
  OTHER: "Other",
  // Legacy, so an old row still renders a name rather than a raw enum value.
  STUDENT_EVENT: "Student Event (legacy)",
  FAIR: "Fair (legacy)",
};

export function activityTypeLabel(t: string): string {
  return ACTIVITY_TYPE_LABELS[t] ?? t.replace(/_/g, " ").toLowerCase();
}

/** Options for a picker, in the order the business reads them. */
export const ACTIVITY_TYPE_OPTIONS = ACTIVITY_TYPES.map((value) => ({
  value,
  label: ACTIVITY_TYPE_LABELS[value],
}));
