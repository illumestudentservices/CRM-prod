import type { EventType, EventStatus } from "@prisma/client";

/**
 * Recruitment event vocabulary — the single source of truth.
 *
 * The form and the API had drifted apart in both directions. The form offered
 * six of the fourteen event types, so School Fair, School Visit, Open Day,
 * Student Seminar, Application Day, Conversion Event, Agent Workshop and Other
 * could not be chosen at all. It offered four of the six statuses, so In
 * Progress and Closed were unreachable — Regional Managers are permitted to
 * close an event and were given no way to do it.
 *
 * Worse in the other direction: the form offered AGENT_TRAINING, which
 * migration 019 retired in favour of AGENT_WORKSHOP, so new events were being
 * created with a value the schema calls legacy. Exactly the shape of the
 * activity-type bug in lib/activity-types.ts.
 *
 * The API validated neither — it cast `type as EventType` and let Prisma decide,
 * which turns a typo into a 500 rather than a 422.
 */

/** Types a user may choose today. AGENT_TRAINING is deliberately absent. */
export const EVENT_TYPES = [
  "EDUCATION_FAIR",
  "SCHOOL_FAIR",
  "SCHOOL_VISIT",
  "SCHOOL_PRESENTATION",
  "CAMPUS_VISIT",
  "OPEN_DAY",
  "WEBINAR",
  "AGENT_WORKSHOP",
  "STUDENT_SEMINAR",
  "EXHIBITION",
  "CONVERSION_EVENT",
  "APPLICATION_DAY",
  "OTHER",
] as const satisfies readonly EventType[];

/**
 * Retired, kept in the enum only so existing rows still read.
 * Migration 019 replaced AGENT_TRAINING with AGENT_WORKSHOP.
 */
export const LEGACY_EVENT_TYPES = ["AGENT_TRAINING"] as const satisfies readonly EventType[];

export const ALL_EVENT_TYPES = [
  ...EVENT_TYPES,
  ...LEGACY_EVENT_TYPES,
] as const satisfies readonly EventType[];

/**
 * Compile-time proof the lists cover the enum.
 *
 * Adding a value to EventType without classifying it as writable or legacy now
 * fails the build and names it. Same guard as ALL_STAGES and
 * ALL_ACTIVITY_TYPES; `[T] extends [never]` so the check does not distribute
 * over the union and vacuously pass.
 */
type UncoveredEventType = Exclude<EventType, (typeof ALL_EVENT_TYPES)[number]>;
const _eventTypeCoverage: [UncoveredEventType] extends [never]
  ? true
  : { ERROR: "EventType missing from EVENT_TYPES or LEGACY_EVENT_TYPES"; missing: UncoveredEventType } =
  true;
void _eventTypeCoverage;

/** Every status, in lifecycle order. All six are selectable. */
export const EVENT_STATUSES = [
  "PLANNED",
  "CONFIRMED",
  "IN_PROGRESS",
  "COMPLETED",
  "CLOSED",
  "CANCELLED",
] as const satisfies readonly EventStatus[];

type UncoveredEventStatus = Exclude<EventStatus, (typeof EVENT_STATUSES)[number]>;
const _eventStatusCoverage: [UncoveredEventStatus] extends [never]
  ? true
  : { ERROR: "EventStatus missing from EVENT_STATUSES"; missing: UncoveredEventStatus } = true;
void _eventStatusCoverage;

export const EVENT_TYPE_LABELS: Record<string, string> = {
  EDUCATION_FAIR: "Education Fair",
  SCHOOL_FAIR: "School Fair",
  SCHOOL_VISIT: "School Visit",
  SCHOOL_PRESENTATION: "School Presentation",
  CAMPUS_VISIT: "Campus Visit",
  OPEN_DAY: "Open Day",
  WEBINAR: "Webinar",
  AGENT_WORKSHOP: "Agent Workshop",
  STUDENT_SEMINAR: "Student Seminar",
  EXHIBITION: "Exhibition",
  CONVERSION_EVENT: "Conversion Event",
  APPLICATION_DAY: "Application Day",
  OTHER: "Other",
  // Legacy, so an old row renders a name rather than a raw enum value.
  AGENT_TRAINING: "Agent Training (legacy)",
};

export const EVENT_STATUS_LABELS: Record<string, string> = {
  PLANNED: "Planned",
  CONFIRMED: "Confirmed",
  IN_PROGRESS: "In Progress",
  COMPLETED: "Completed",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

export function eventTypeLabel(t: string): string {
  return EVENT_TYPE_LABELS[t] ?? t.replace(/_/g, " ").toLowerCase();
}

export function eventStatusLabel(s: string): string {
  return EVENT_STATUS_LABELS[s] ?? s.replace(/_/g, " ").toLowerCase();
}

/** Options for a picker, in the order the business reads them. */
export const EVENT_TYPE_OPTIONS = EVENT_TYPES.map((value) => ({
  value,
  label: EVENT_TYPE_LABELS[value],
}));

export const EVENT_STATUS_OPTIONS = EVENT_STATUSES.map((value) => ({
  value,
  label: EVENT_STATUS_LABELS[value],
}));
