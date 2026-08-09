/// Env-var-driven feature flags.
///
/// Two rules:
///   1. A flag guards new UI/API paths WHILE old paths are still shipping. It
///      is not a permanent config switch — after cutover, the flag AND the old
///      path both get deleted in the same PR. A flag that lives forever has
///      become a config bug factory.
///   2. Default is always the SAFE side (usually OFF = existing behaviour).
///      Turning a flag ON in a specific environment is a deliberate act; a
///      missing env var must never enable something that could rewrite data.
///
/// Reads happen inside functions so tests can override `process.env` before
/// the check runs, and so an initial-load misconfig can be inspected in a
/// hot-reloaded dev session.

/// Presence of the new Student Profile + Institution Interest split.
///
/// While the flag is OFF:
///   - The students UI continues to render one stage per lead.
///   - The API keeps writing to `leads.stage` and `leads.institutionId`.
///   - Migration 012 still populates `institution_interests` — the flag guards
///     READERS, not the underlying data.
///
/// While the flag is ON:
///   - The student detail page renders the InstitutionInterest list.
///   - The lead-create flow offers "select existing student → add new interest"
///     before defaulting to "new student."
///   - Reader queries prefer `institution_interests.stage`; writers dual-write.
///
/// Set `FEATURE_MULTI_INSTITUTION_INTEREST=true` to enable in an environment.
/// Any other value (including unset, "false", "0", "") is treated as OFF.
export function isMultiInstitutionInterestEnabled(): boolean {
  return process.env.FEATURE_MULTI_INSTITUTION_INTEREST === "true";
}

/// Phase 2 — Recruitment Network. Enables the consolidated
/// /recruitment-network route tree, the PartnerContact editor and the
/// EventParticipation-driven event pages. While OFF, /sources,
/// /stakeholders, and /events keep working unchanged.
export function isRecruitmentNetworkEnabled(): boolean {
  return process.env.FEATURE_RECRUITMENT_NETWORK === "true";
}

/// Phase 3 — Field Operations rename. Renders the /field-operations route
/// and redirects /activities. Underlying data is the same `activities` table.
export function isFieldOperationsEnabled(): boolean {
  return process.env.FEATURE_FIELD_OPERATIONS === "true";
}

/// Phase 4 — Recruitment Planning module. Enables the quarterly-plan drafting
/// UI, approval workflow, and variation-request flow. Existing /travel keeps
/// working while OFF.
export function isRecruitmentPlanningEnabled(): boolean {
  return process.env.FEATURE_RECRUITMENT_PLANNING === "true";
}

/// Phase 5 — Market Intelligence redesign. Shows priority/potential fields
/// and the ICR→RM suggestion inbox. Hides the deprecated healthScore field.
export function isMarketIntelligenceEnabled(): boolean {
  return process.env.FEATURE_MARKET_INTELLIGENCE === "true";
}

/// Phase 6 — Tasks workflow engine. Enforces parent-record link on task
/// creation, exposes TaskTemplates, and drives auto-generation from entity
/// lifecycle events.
export function isTasksWorkflowEnabled(): boolean {
  return process.env.FEATURE_TASKS_WORKFLOW === "true";
}

/// Phase 7 — Auto-populated reporting. Switches the monthly-report editor to
/// the narrative-only view with CRM-generated numbers.
export function isAutoReportingEnabled(): boolean {
  return process.env.FEATURE_AUTO_REPORTING === "true";
}
