import type { Role } from "@prisma/client";

type Resource =
  | "leads"
  | "sources"
  | "institutions"
  | "events"
  | "reports"
  | "analytics"
  | "erp"
  | "erp_hr"
  | "users"
  | "settings"
  | "announcements"
  | "knowledge_base";

type Action = "read" | "write" | "delete" | "approve" | "export";

export const PERMISSION_MATRIX: Record<Role, Record<Resource, Action[]>> = {
  SUPER_ADMIN: {
    leads: ["read", "write", "delete", "approve", "export"],
    sources: ["read", "write", "delete", "approve", "export"],
    institutions: ["read", "write", "delete", "approve", "export"],
    events: ["read", "write", "delete", "approve", "export"],
    reports: ["read", "write", "delete", "approve", "export"],
    analytics: ["read", "write", "delete", "approve", "export"],
    erp: ["read", "write", "delete", "approve", "export"],
    erp_hr: ["read", "write", "delete", "approve", "export"],
    users: ["read", "write", "delete", "approve", "export"],
    settings: ["read", "write", "delete", "approve", "export"],
    announcements: ["read", "write", "delete", "approve", "export"],
    knowledge_base: ["read", "write", "delete", "approve", "export"],
  },
  HQ_EXECUTIVE: {
    leads: ["read", "export"],
    sources: ["read", "export"],
    institutions: ["read", "export"],
    events: ["read", "export"],
    reports: ["read", "approve", "export"],
    analytics: ["read", "export"],
    erp: ["read"],
    erp_hr: ["read"],
    users: ["read"],
    settings: [],
    announcements: ["read", "write"],
    knowledge_base: ["read"],
  },
  HQ_ANALYTICS: {
    leads: ["read", "export"],
    sources: ["read", "export"],
    institutions: ["read", "export"],
    events: ["read", "export"],
    reports: ["read", "approve", "export"],
    analytics: ["read", "write", "export"],
    erp: [],
    erp_hr: [],
    users: ["read"],
    settings: [],
    announcements: ["read"],
    knowledge_base: ["read"],
  },
  REGIONAL_MANAGER: {
    leads: ["read", "write", "export"],
    sources: ["read", "write", "export"],
    institutions: ["read", "write", "export"],
    events: ["read", "write", "export"],
    reports: ["read", "approve", "export"],
    analytics: ["read", "export"],
    erp: ["read"],
    erp_hr: [],
    users: ["read"],
    settings: [],
    announcements: ["read"],
    knowledge_base: ["read"],
  },
  ICR: {
    leads: ["read", "write", "export"],
    sources: ["read", "write"],
    institutions: ["read"],
    events: ["read", "write"],
    reports: ["read", "write"],
    analytics: ["read"],
    erp: ["read"],
    erp_hr: [],
    users: [],
    settings: [],
    announcements: ["read"],
    knowledge_base: ["read"],
  },
  INSTITUTION_CLIENT: {
    leads: ["read"],
    sources: [],
    institutions: ["read"],
    events: ["read"],
    reports: ["read"],
    analytics: ["read"],
    erp: [],
    erp_hr: [],
    users: [],
    settings: [],
    announcements: ["read"],
    knowledge_base: [],
  },
  HR_MANAGER: {
    leads: [],
    sources: [],
    institutions: [],
    events: [],
    reports: [],
    analytics: [],
    erp: ["read", "write", "delete", "approve", "export"],
    erp_hr: ["read", "write", "delete", "approve", "export"],
    users: ["read"],
    settings: [],
    announcements: ["read", "write"],
    knowledge_base: ["read", "write"],
  },
  EMPLOYEE: {
    leads: [],
    sources: [],
    institutions: [],
    events: [],
    reports: [],
    analytics: [],
    erp: ["read", "write"],
    erp_hr: [],
    users: [],
    settings: [],
    announcements: ["read"],
    knowledge_base: ["read"],
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
  settings:     ["SUPER_ADMIN"],
  activity_log: ["SUPER_ADMIN"],
};

export type { Role, Resource, Action };
