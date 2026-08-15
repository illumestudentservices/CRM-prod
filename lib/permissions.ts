import type { Role } from "@prisma/client";

type Resource =
  | "leads"
  | "sources"
  | "institutions"
  | "events"
  | "reports"
  | "analytics"
  | "executive_dashboard"
  | "erp"
  | "erp_hr"
  | "users"
  | "settings"
  | "announcements"
  | "knowledge_base"
  | "whatsapp"
  | "markets"
  | "stakeholders"
  | "activities"
  | "travel"
  | "risk_compliance"
  | "knowledge"
  | "tasks"
  // ─── Redesign resources (Phases 2–7) ─────────────────────────────────────
  | "recruitment_network"
  | "recruitment_planning"
  | "market_intelligence"
  | "field_operations";

type Action = "read" | "write" | "delete" | "approve" | "export";

/**
 * Every role the matrix defines, derived from the matrix itself.
 *
 * Callers used to hardcode this list, and the copy in the Security tab's API
 * had drifted: ACCOUNT_MANAGER, ADMISSIONS_SUPPORT and VP_GLOBAL_SALES held
 * permissions that no administrator could see or change, because the screen
 * simply didn't render them. Deriving it removes the class of bug — a role
 * added to the matrix now appears in the UI automatically.
 *
 * Declared after the matrix (see the export at the bottom of this file) so it
 * can read the object's keys.
 */
export const PERMISSION_MATRIX: Record<Role, Record<Resource, Action[]>> = {
  SUPER_ADMIN: {
    leads: ["read", "write", "delete", "approve", "export"],
    sources: ["read", "write", "delete", "approve", "export"],
    institutions: ["read", "write", "delete", "approve", "export"],
    events: ["read", "write", "delete", "approve", "export"],
    reports: ["read", "write", "delete", "approve", "export"],
    analytics: ["read", "write", "delete", "approve", "export"],
    executive_dashboard: ["read", "write", "delete", "approve", "export"],
    erp: ["read", "write", "delete", "approve", "export"],
    erp_hr: ["read", "write", "delete", "approve", "export"],
    users: ["read", "write", "delete", "approve", "export"],
    settings: ["read", "write", "delete", "approve", "export"],
    announcements: ["read", "write", "delete", "approve", "export"],
    knowledge_base: ["read", "write", "delete", "approve", "export"],
    whatsapp: ["read", "write", "delete"],
    markets: ["read", "write", "delete", "approve", "export"],
    stakeholders: ["read", "write", "delete", "approve", "export"],
    activities: ["read", "write", "delete", "approve", "export"],
    travel: ["read", "write", "delete", "approve", "export"],
    risk_compliance: ["read", "write", "delete", "approve", "export"],
    knowledge: ["read", "write", "delete", "approve", "export"],
    tasks: ["read", "write", "delete", "approve", "export"],
    recruitment_network: ["read", "write", "delete", "approve", "export"],
    recruitment_planning: ["read", "write", "delete", "approve", "export"],
    market_intelligence: ["read", "write", "delete", "approve", "export"],
    field_operations: ["read", "write", "delete", "approve", "export"],
  },
  HQ_EXECUTIVE: {
    leads: ["read", "export"],
    sources: ["read", "export"],
    institutions: ["read", "export"],
    events: ["read", "export"],
    reports: ["read", "approve", "export"],
    analytics: ["read", "export"],
    executive_dashboard: ["read"],
    erp: ["read"],
    erp_hr: ["read"],
    users: ["read"],
    settings: [],
    announcements: ["read", "write"],
    knowledge_base: ["read"],
    whatsapp: ["read", "write"],
    markets: ["read", "export"],
    stakeholders: ["read", "export"],
    activities: ["read", "export"],
    travel: ["read"],
    risk_compliance: ["read", "export"],
    knowledge: ["read"],
    tasks: ["read"],
    recruitment_network: ["read", "export"],
    recruitment_planning: ["read", "approve", "export"],
    market_intelligence: ["read", "export"],
    field_operations: ["read", "export"],
  },
  HQ_ANALYTICS: {
    leads: ["read", "export"],
    sources: ["read", "export"],
    institutions: ["read", "export"],
    events: ["read", "export"],
    reports: ["read", "approve", "export"],
    analytics: ["read", "write", "export"],
    executive_dashboard: ["read"],
    erp: [],
    erp_hr: [],
    users: ["read"],
    settings: [],
    announcements: ["read"],
    knowledge_base: ["read"],
    whatsapp: [],
    markets: ["read", "export"],
    stakeholders: ["read", "export"],
    activities: ["read", "export"],
    travel: [],
    risk_compliance: ["read", "export"],
    knowledge: ["read"],
    tasks: ["read"],
    recruitment_network: ["read", "export"],
    recruitment_planning: ["read", "export"],
    market_intelligence: ["read", "export"],
    field_operations: ["read", "export"],
  },
  REGIONAL_MANAGER: {
    leads: ["read", "write", "export"],
    sources: ["read", "write", "export"],
    institutions: ["read", "write", "export"],
    events: ["read", "write", "export"],
    reports: ["read", "approve", "export"],
    analytics: ["read", "export"],
    executive_dashboard: ["read"],
    erp: ["read"],
    erp_hr: [],
    users: ["read"],
    settings: [],
    announcements: ["read"],
    knowledge_base: ["read"],
    whatsapp: ["read", "write"],
    markets: ["read", "write", "export"],
    stakeholders: ["read", "write", "export"],
    activities: ["read", "write", "export"],
    travel: ["read"],
    risk_compliance: ["read", "export"],
    knowledge: ["read", "write"],
    tasks: ["read", "write"],
    recruitment_network: ["read", "write", "export"],
    recruitment_planning: ["read", "write", "approve", "export"],
    market_intelligence: ["read", "write", "approve", "export"],
    field_operations: ["read", "write", "export"],
  },
  ICR: {
    leads: ["read", "write", "export"],
    sources: ["read", "write"],
    institutions: ["read"],
    events: ["read", "write"],
    reports: ["read", "write"],
    analytics: ["read"],
    executive_dashboard: [],
    erp: ["read"],
    erp_hr: [],
    users: [],
    settings: [],
    announcements: ["read"],
    knowledge_base: ["read"],
    whatsapp: ["read", "write"],
    markets: ["read"],
    stakeholders: ["read", "write"],
    activities: ["read", "write"],
    travel: ["read"],
    risk_compliance: ["read"],
    knowledge: ["read", "write"],
    tasks: ["read", "write"],
    recruitment_network: ["read", "write"],
    recruitment_planning: ["read", "write"],
    market_intelligence: ["read", "write"],
    field_operations: ["read", "write"],
  },
  INSTITUTION_CLIENT: {
    leads: ["read"],
    sources: [],
    institutions: ["read"],
    events: ["read"],
    reports: ["read"],
    analytics: ["read"],
    executive_dashboard: [],
    erp: [],
    erp_hr: [],
    users: [],
    settings: [],
    announcements: ["read"],
    knowledge_base: [],
    whatsapp: [],
    markets: [],
    stakeholders: [],
    activities: [],
    travel: [],
    risk_compliance: [],
    knowledge: [],
    tasks: [],
    recruitment_network: [],
    recruitment_planning: [],
    market_intelligence: [],
    field_operations: [],
  },
  HR_MANAGER: {
    leads: [],
    sources: [],
    institutions: [],
    events: [],
    reports: [],
    analytics: [],
    executive_dashboard: [],
    erp: ["read", "write", "delete", "approve", "export"],
    erp_hr: ["read", "write", "delete", "approve", "export"],
    users: ["read"],
    settings: [],
    announcements: ["read", "write"],
    knowledge_base: ["read", "write"],
    whatsapp: [],
    markets: [],
    stakeholders: [],
    activities: [],
    travel: ["read", "write", "delete", "approve", "export"],
    risk_compliance: [],
    knowledge: ["read", "write", "delete", "approve", "export"],
    tasks: ["read", "write"],
    recruitment_network: [],
    recruitment_planning: ["read", "write"],
    market_intelligence: [],
    field_operations: [],
  },
  EMPLOYEE: {
    leads: [],
    sources: [],
    institutions: [],
    events: [],
    reports: [],
    analytics: [],
    executive_dashboard: [],
    erp: ["read", "write"],
    erp_hr: [],
    users: [],
    settings: [],
    announcements: ["read"],
    knowledge_base: ["read"],
    whatsapp: [],
    markets: [],
    stakeholders: [],
    activities: [],
    travel: ["read", "write"],
    risk_compliance: [],
    knowledge: ["read"],
    tasks: ["read", "write"],
    recruitment_network: [],
    recruitment_planning: [],
    market_intelligence: [],
    field_operations: [],
  },
  // Spec Clients §4 / Recruitment Planning §3 — Account Manager owns
  // client-facing commercial relationships and approves plans before client
  // submission. Broad read on operational modules, write on the client-facing
  // ones, approve on plans and reports.
  ACCOUNT_MANAGER: {
    leads: ["read", "export"],
    sources: ["read", "export"],
    institutions: ["read", "write", "export"],
    events: ["read"],
    reports: ["read", "approve", "export"],
    analytics: ["read", "export"],
    executive_dashboard: ["read"],
    erp: ["read"],
    erp_hr: [],
    users: ["read"],
    settings: [],
    announcements: ["read"],
    knowledge_base: ["read"],
    whatsapp: ["read", "write"],
    markets: ["read", "export"],
    stakeholders: ["read"],
    activities: ["read"],
    travel: ["read"],
    risk_compliance: ["read"],
    knowledge: ["read"],
    tasks: ["read", "write"],
    recruitment_network: ["read"],
    recruitment_planning: ["read", "approve", "export"],
    market_intelligence: ["read", "export"],
    field_operations: ["read", "export"],
  },
  // Spec Student Pipeline §22 / Clients §4 — Admissions Support view/update
  // application info, upload documents, record institutional updates, progress
  // authorised application stages.
  ADMISSIONS_SUPPORT: {
    leads: ["read", "write"],
    sources: ["read"],
    institutions: ["read"],
    events: ["read"],
    reports: ["read"],
    analytics: ["read"],
    executive_dashboard: [],
    erp: [],
    erp_hr: [],
    users: [],
    settings: [],
    announcements: ["read"],
    knowledge_base: ["read"],
    whatsapp: ["read", "write"],
    markets: ["read"],
    stakeholders: ["read"],
    activities: ["read", "write"],
    travel: [],
    risk_compliance: ["read"],
    knowledge: ["read"],
    tasks: ["read", "write"],
    recruitment_network: ["read"],
    recruitment_planning: ["read"],
    market_intelligence: ["read"],
    field_operations: ["read", "write"],
  },
  // Spec Recruitment Planning §3 — VP Global Sales sits on the Internal Final
  // Review step of the plan approval chain; broad read + approve on plans.
  VP_GLOBAL_SALES: {
    leads: ["read", "export"],
    sources: ["read", "export"],
    institutions: ["read", "export"],
    events: ["read", "export"],
    reports: ["read", "approve", "export"],
    analytics: ["read", "export"],
    executive_dashboard: ["read"],
    erp: ["read"],
    erp_hr: [],
    users: ["read"],
    settings: [],
    announcements: ["read", "write"],
    knowledge_base: ["read"],
    whatsapp: ["read"],
    markets: ["read", "export"],
    stakeholders: ["read", "export"],
    activities: ["read", "export"],
    travel: ["read"],
    risk_compliance: ["read", "export"],
    knowledge: ["read"],
    tasks: ["read", "write"],
    recruitment_network: ["read", "export"],
    recruitment_planning: ["read", "approve", "export"],
    market_intelligence: ["read", "export"],
    field_operations: ["read", "export"],
  },
};

export function hasPermission(
  role: Role,
  resource: Resource,
  action: Action
): boolean {
  return PERMISSION_MATRIX[role]?.[resource]?.includes(action) ?? false;
}

export function canAccess(role: Role, resource: Resource): boolean {
  const actions = PERMISSION_MATRIX[role]?.[resource] ?? [];
  return actions.length > 0;
}

export const NAV_PERMISSIONS: Record<string, Role[]> = {
  dashboard: [
    "SUPER_ADMIN",
    "HQ_EXECUTIVE",
    "HQ_ANALYTICS",
    "REGIONAL_MANAGER",
    "ICR",
    "INSTITUTION_CLIENT",
    "HR_MANAGER",
    "EMPLOYEE",
  ],
  students: [
    "SUPER_ADMIN",
    "HQ_EXECUTIVE",
    "HQ_ANALYTICS",
    "REGIONAL_MANAGER",
    "ICR",
  ],
  sources: ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR"],
  institutions: [
    "SUPER_ADMIN",
    "HQ_EXECUTIVE",
    "HQ_ANALYTICS",
    "REGIONAL_MANAGER",
    "ICR",
    "INSTITUTION_CLIENT",
  ],
  analytics: [
    "SUPER_ADMIN",
    "HQ_EXECUTIVE",
    "HQ_ANALYTICS",
    "REGIONAL_MANAGER",
    "ICR",
  ],
  events: [
    "SUPER_ADMIN",
    "HQ_EXECUTIVE",
    "HQ_ANALYTICS",
    "REGIONAL_MANAGER",
    "ICR",
  ],
  reports: [
    "SUPER_ADMIN",
    "HQ_EXECUTIVE",
    "HQ_ANALYTICS",
    "REGIONAL_MANAGER",
    "ICR",
    "INSTITUTION_CLIENT",
  ],
  hr: ["SUPER_ADMIN", "HR_MANAGER", "EMPLOYEE", "REGIONAL_MANAGER", "ICR"],
  travel: ["SUPER_ADMIN", "HR_MANAGER", "EMPLOYEE", "REGIONAL_MANAGER", "ICR"],
  risk_compliance: ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR"],
  knowledge: ["SUPER_ADMIN", "HR_MANAGER", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR", "EMPLOYEE"],
  whatsapp: ["SUPER_ADMIN", "HQ_EXECUTIVE", "REGIONAL_MANAGER", "ICR"],
  markets: ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR"],
  stakeholders: ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR"],
  activities: ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR"],
  tasks: ["SUPER_ADMIN", "REGIONAL_MANAGER", "ICR", "HR_MANAGER", "EMPLOYEE"],
  settings:     ["SUPER_ADMIN"],
  activity_log: ["SUPER_ADMIN"],
  recycle_bin:  ["SUPER_ADMIN"],
  // ─── Redesign nav (Phases 2–7) ───────────────────────────────────────────
  recruitment_network:  ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR"],
  // ACCOUNT_MANAGER and VP_GLOBAL_SALES added 2026-08-15. Both hold
  // `recruitment_planning: ["read","approve","export"]` in PERMISSION_MATRIX and
  // both are NAMED STEPS in the plan approval chain — PR #62 routed
  // ACCOUNT_MANAGER_REVIEW to the Account Manager and INTERNAL_FINAL_REVIEW to
  // the VP. They were missing here, and proxy.ts uses THIS list as the live
  // route gate, so both were redirected to /dashboard on arrival: the approval
  // chain was unreachable through the UI for the two roles it exists for. The
  // transition API accepted them the whole time; only the door was shut.
  // Measured before the fix: ACCOUNT_MANAGER → 307 /dashboard.
  recruitment_planning: [
    "SUPER_ADMIN", "HQ_EXECUTIVE", "REGIONAL_MANAGER", "ICR",
    "ACCOUNT_MANAGER", "VP_GLOBAL_SALES",
  ],
  market_intelligence:  ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR"],
  field_operations:     ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ICR"],
};

export type { Role, Resource, Action };

/**
 * Canonical role list, derived from PERMISSION_MATRIX so it can never drift
 * from the roles that actually carry permissions. Use this instead of a local
 * array — see the note above PERMISSION_MATRIX for what drift cost last time.
 */
export const ALL_ROLES = Object.keys(PERMISSION_MATRIX) as Role[];

/** Canonical resource and action lists, likewise derived. */
export const ALL_RESOURCES = Object.keys(
  PERMISSION_MATRIX.SUPER_ADMIN
) as Resource[];
export const ALL_ACTIONS: Action[] = ["read", "write", "delete", "approve", "export"];
