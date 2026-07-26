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
  | "tasks";

type Action = "read" | "write" | "delete" | "approve" | "export";

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
};

export type { Role, Resource, Action };
