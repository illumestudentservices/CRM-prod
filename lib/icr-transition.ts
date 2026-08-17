import type { TransitionStatus, TransitionSectionKey, TransitionType, Role } from "@prisma/client";

/**
 * ICR Transition & Handover — workflow rules, section registry and gates.
 *
 * Everything that decides "can this move / is this complete / who may act" lives
 * here rather than in the route handlers. The module has four write endpoints
 * that all need the same answers, and the last time that logic was copied per
 * route in this codebase (lead stage changes) one copy ended up with no
 * validation at all.
 */

// ─── Statuses ────────────────────────────────────────────────────────────────

/** Spec §5, in workflow order. */
export const TRANSITION_STATUSES = [
  "ASSIGNED",
  "IN_PROGRESS",
  "SUBMITTED_TO_RM",
  "AMENDMENTS_REQUIRED",
  "RESUBMITTED",
  "ACCEPTED_BY_RM",
  "FINAL",
  "ARCHIVED",
] as const satisfies readonly TransitionStatus[];

/**
 * `satisfies readonly X[]` checks that every entry is a valid status; it does
 * NOT check that every status appears. This guard does that half — remove a
 * status from the list above and compilation fails with the missing name.
 */
type UncoveredStatus = Exclude<TransitionStatus, (typeof TRANSITION_STATUSES)[number]>;
const _statusCoverage: [UncoveredStatus] extends [never]
  ? true
  : { ERROR: "TransitionStatus missing from TRANSITION_STATUSES"; missing: UncoveredStatus } = true;
void _statusCoverage;

/** Terminal states. A report here is history and must not be edited. */
export const CLOSED_TRANSITION_STATUSES: readonly TransitionStatus[] = ["FINAL", "ARCHIVED"];

/**
 * Legal moves. Not linear: AMENDMENTS_REQUIRED sends the report back to the
 * ICR, who RESUBMITs, which re-enters review — so RESUBMITTED and
 * SUBMITTED_TO_RM both lead to the same two outcomes.
 *
 * ARCHIVED is reachable only from FINAL. A report cannot be archived to escape
 * review; that would let an unfinished handover be filed away as if it were
 * done.
 */
export const TRANSITION_FLOW: Record<TransitionStatus, readonly TransitionStatus[]> = {
  ASSIGNED: ["IN_PROGRESS"],
  IN_PROGRESS: ["SUBMITTED_TO_RM"],
  SUBMITTED_TO_RM: ["AMENDMENTS_REQUIRED", "ACCEPTED_BY_RM"],
  AMENDMENTS_REQUIRED: ["RESUBMITTED"],
  RESUBMITTED: ["AMENDMENTS_REQUIRED", "ACCEPTED_BY_RM"],
  ACCEPTED_BY_RM: ["FINAL"],
  FINAL: ["ARCHIVED"],
  ARCHIVED: [],
};

export function canMove(from: TransitionStatus, to: TransitionStatus): boolean {
  return TRANSITION_FLOW[from].includes(to);
}

/** True once the report is frozen (spec §32: "Cannot modify Final Report"). */
export function isLocked(status: TransitionStatus): boolean {
  return CLOSED_TRANSITION_STATUSES.includes(status);
}

/** The ICR may edit content only while the report is theirs to work on. */
export function isIcrEditable(status: TransitionStatus): boolean {
  return status === "ASSIGNED" || status === "IN_PROGRESS" || status === "AMENDMENTS_REQUIRED";
}

// ─── Sections ────────────────────────────────────────────────────────────────

export interface SectionDef {
  key: TransitionSectionKey;
  /** Spec section number, so a reader can trace a field back to the document. */
  spec: number;
  title: string;
  /**
   * Whether the report can be submitted without it. Spec §33 names the
   * Executive Summary and Strategic Recommendations explicitly; the remaining
   * narrative sections are required because the report's whole purpose is the
   * outgoing ICR's commentary. Sections that are mostly CRM read-outs are
   * optional so an ICR is not forced to retype what the system already shows.
   */
  requiredForSubmission: boolean;
}

/** Spec §8–§23, in presentation order. */
export const TRANSITION_SECTIONS = [
  { key: "EXECUTIVE_HANDOVER_SUMMARY",       spec: 8,  title: "Executive Handover Summary",            requiredForSubmission: true },
  { key: "MARKET_OVERVIEW",                  spec: 9,  title: "Market Overview",                       requiredForSubmission: true },
  { key: "RECRUITMENT_EVENTS_ACTIVITIES",    spec: 10, title: "Recruitment Events & Activities",       requiredForSubmission: false },
  { key: "PRIORITY_AGENT_HANDOVER",          spec: 11, title: "Active / Priority Agent Handover",      requiredForSubmission: true },
  { key: "NEW_HIGH_POTENTIAL_AGENTS",        spec: 12, title: "New / High-Potential Agents",           requiredForSubmission: false },
  { key: "SCHOOL_INSTITUTION_RELATIONSHIPS", spec: 13, title: "School / Institution Relationships",    requiredForSubmission: true },
  { key: "OTHER_KEY_RELATIONSHIPS",          spec: 14, title: "Other Key Relationships",               requiredForSubmission: false },
  { key: "ACTIVE_STUDENT_PIPELINE",          spec: 15, title: "Active Student Pipeline",               requiredForSubmission: true },
  { key: "OUTSTANDING_TASKS_COMMITMENTS",    spec: 17, title: "Outstanding Tasks & Commitments",       requiredForSubmission: true },
  { key: "RECRUITMENT_PLAN_TRAVEL_BUDGET",   spec: 18, title: "Recruitment Plan, Travel & Budget",     requiredForSubmission: false },
  { key: "CURRENT_FORECAST",                 spec: 19, title: "Current Forecast",                      requiredForSubmission: false },
  { key: "CLIENT_OPERATIONAL_KNOWLEDGE",     spec: 20, title: "Client / Institution Operational Knowledge", requiredForSubmission: true },
  { key: "OUTSTANDING_ISSUES_RISKS",         spec: 21, title: "Outstanding Issues & Risks",            requiredForSubmission: true },
  { key: "KEY_DOCUMENTS_RESOURCES",          spec: 22, title: "Key Documents & Resources",             requiredForSubmission: false },
  { key: "FINAL_STRATEGIC_RECOMMENDATIONS",  spec: 23, title: "Final Strategic Recommendations",       requiredForSubmission: true },
] as const satisfies readonly SectionDef[];

/** Same guard as above: a new section key must be described here. */
type UncoveredSection = Exclude<TransitionSectionKey, (typeof TRANSITION_SECTIONS)[number]["key"]>;
const _sectionCoverage: [UncoveredSection] extends [never]
  ? true
  : { ERROR: "TransitionSectionKey missing from TRANSITION_SECTIONS"; missing: UncoveredSection } = true;
void _sectionCoverage;

export const REQUIRED_SECTIONS: readonly TransitionSectionKey[] =
  TRANSITION_SECTIONS.filter((s) => s.requiredForSubmission).map((s) => s.key);

export function sectionTitle(key: TransitionSectionKey): string {
  return TRANSITION_SECTIONS.find((s) => s.key === key)?.title ?? key;
}

// ─── Transition types ────────────────────────────────────────────────────────

/** Spec §6 dropdown, with the labels the business uses. */
export const TRANSITION_TYPE_LABELS: Record<TransitionType, string> = {
  LEAVING_ILLUME: "Leaving Illume",
  INSTITUTION_REASSIGNMENT: "Institution Reassignment",
  MARKET_REASSIGNMENT: "Market Reassignment",
  INTERNAL_ROLE_CHANGE: "Internal Role Change",
  TEMPORARY_COVERAGE: "Temporary Coverage",
  EXTENDED_LEAVE: "Extended Leave",
  OTHER: "Other",
};

/** Only these end the ICR's employment, so a final working day is meaningful. */
export const TYPES_WITH_FINAL_WORKING_DAY: readonly TransitionType[] = [
  "LEAVING_ILLUME",
  "EXTENDED_LEAVE",
];

// ─── Who may do what ─────────────────────────────────────────────────────────

/**
 * Spec §32. Deliberately separate from PERMISSION_MATRIX: the matrix answers
 * "may this role touch transitions at all", these answer "may this person act
 * on THIS report". Both are needed — a Regional Manager holds approve, but
 * must not accept a report from another manager's region.
 */
export interface ReportActors {
  outgoingIcrId: string;
  regionalManagerId: string;
}

/** The outgoing ICR owns the content, and only while it is editable. */
export function canEditContent(
  report: ReportActors & { status: TransitionStatus },
  userId: string,
  role: Role
): boolean {
  if (isLocked(report.status)) return false;
  if (role === "SUPER_ADMIN") return true;
  return report.outgoingIcrId === userId && isIcrEditable(report.status);
}

/**
 * Review is the assigned RM's, never the author's.
 *
 * Spec §32 states the ICR "cannot approve own report". The explicit
 * self-review check matters because a Regional Manager can also be the
 * outgoing ICR of their own transition — someone leaving an RM post — and role
 * alone would let them accept it.
 */
export function canReview(
  report: ReportActors & { status: TransitionStatus },
  userId: string,
  role: Role
): boolean {
  if (isLocked(report.status)) return false;
  if (report.outgoingIcrId === userId) return false;
  if (role === "SUPER_ADMIN") return true;
  return role === "REGIONAL_MANAGER" && report.regionalManagerId === userId;
}

// ─── Submission and finalisation gates ───────────────────────────────────────

export interface SectionState {
  section: TransitionSectionKey;
  narrative: string | null;
  completedAt: Date | null;
}

export interface GateResult {
  ok: boolean;
  /** Blocking reasons. Empty when ok. */
  errors: string[];
  /** Spec §33 allows warnings for non-critical incomplete items. */
  warnings: string[];
}

/**
 * Spec §33 — a report cannot be submitted to the RM unless the required
 * narrative sections are complete and the ICR declaration is confirmed.
 *
 * "Complete" means the ICR marked it complete AND wrote something. Either alone
 * is gameable: a completedAt with an empty narrative is a tick-box, and prose
 * without the tick means they were still drafting.
 */
export function canSubmit(
  sections: readonly SectionState[],
  declarationConfirmedAt: Date | null
): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const byKey = new Map(sections.map((s) => [s.section, s]));
  for (const key of REQUIRED_SECTIONS) {
    const s = byKey.get(key);
    const written = (s?.narrative ?? "").trim().length > 0;
    if (!s || !s.completedAt || !written) {
      errors.push(`${sectionTitle(key)} is not complete.`);
    }
  }

  if (!declarationConfirmedAt) {
    errors.push("The ICR declaration has not been confirmed.");
  }

  for (const def of TRANSITION_SECTIONS) {
    if (def.requiredForSubmission) continue;
    const s = byKey.get(def.key);
    if (!s?.completedAt) warnings.push(`${def.title} has not been completed.`);
  }

  return { ok: errors.length === 0, errors, warnings };
}

/**
 * Spec §33 — a report cannot become Final until the operational loose ends have
 * an owner. This is the clause that gives the module its point: the handover is
 * not done when the prose is written, it is done when nothing is left
 * unowned.
 *
 * The counts are supplied by the caller, which queries the owning modules —
 * this file must not import the database, both to stay testable and because
 * §36 is explicit that Transition does not own that data.
 */
export interface FinalisationFacts {
  /** Active institution interests still pointing at the outgoing ICR. */
  unownedInterests: number;
  /** Incomplete high-priority tasks still assigned to the outgoing ICR. */
  unownedCriticalTasks: number;
  /** Open high/critical risks still owned by the outgoing ICR. */
  unownedCriticalRisks: number;
  /** True when forecast responsibility for the assignment is still theirs. */
  forecastResponsibilityUnresolved: boolean;
}

export function canFinalise(
  status: TransitionStatus,
  sections: readonly SectionState[],
  declarationConfirmedAt: Date | null,
  facts: FinalisationFacts
): GateResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (status !== "ACCEPTED_BY_RM") {
    errors.push("The Regional Manager has not accepted this report yet.");
  }

  const content = canSubmit(sections, declarationConfirmedAt);
  errors.push(...content.errors);
  warnings.push(...content.warnings);

  if (facts.unownedInterests > 0) {
    errors.push(
      `${facts.unownedInterests} active student interest(s) are still assigned to the outgoing ICR.`
    );
  }
  if (facts.unownedCriticalTasks > 0) {
    errors.push(
      `${facts.unownedCriticalTasks} outstanding high-priority task(s) have no future owner.`
    );
  }
  if (facts.unownedCriticalRisks > 0) {
    errors.push(
      `${facts.unownedCriticalRisks} critical risk(s) are still owned by the outgoing ICR.`
    );
  }
  if (facts.forecastResponsibilityUnresolved) {
    errors.push("Forecast responsibility for this assignment has not been reassigned.");
  }

  return { ok: errors.length === 0, errors, warnings };
}
