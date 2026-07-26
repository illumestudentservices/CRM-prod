import { cache } from "react";
import { db } from "@/lib/db";
import { PERMISSION_MATRIX } from "@/lib/permissions";
import type { Role, Resource, Action } from "@/lib/permissions";

const ALL_RESOURCES: Resource[] = [
  "leads", "sources", "institutions", "events", "reports", "analytics",
  "executive_dashboard",
  "erp", "erp_hr", "users", "settings", "announcements", "knowledge_base",
  "whatsapp", "markets", "stakeholders", "activities", "travel", "risk_compliance",
  "knowledge", "tasks",
];
const ALL_ACTIONS: Action[] = ["read", "write", "delete", "approve", "export"];

/**
 * Loads the effective permission matrix for a role, merging DB overrides on top
 * of the static PERMISSION_MATRIX. Cached per-request via React cache().
 */
export const getEffectivePermissions = cache(
  async (role: Role): Promise<Record<Resource, Record<Action, boolean>>> => {
    // Build base from static matrix
    const effective = {} as Record<Resource, Record<Action, boolean>>;
    for (const resource of ALL_RESOURCES) {
      effective[resource] = {} as Record<Action, boolean>;
      const allowed = (PERMISSION_MATRIX[role]?.[resource] ?? []) as string[];
      for (const action of ALL_ACTIONS) {
        effective[resource][action] = allowed.includes(action);
      }
    }

    // Apply DB overrides
    try {
      const overrides = await db.permissionOverride.findMany({ where: { role } });
      for (const o of overrides) {
        const res = o.resource as Resource;
        const act = o.action as Action;
        if (effective[res]) {
          effective[res][act] = o.granted;
        }
      }
    } catch {
      // DB unavailable — fall back to static matrix silently
    }

    return effective;
  }
);

/**
 * Async equivalent of hasPermission() that respects DB overrides.
 */
export async function effectiveHasPermission(
  role: Role,
  resource: Resource,
  action: Action
): Promise<boolean> {
  try {
    const perms = await getEffectivePermissions(role);
    return perms[resource]?.[action] ?? false;
  } catch {
    // Fallback to static matrix
    return PERMISSION_MATRIX[role]?.[resource]?.includes(action) ?? false;
  }
}

// Maps each sidebar nav key to the resource + action that gates it.
// null = always visible to any authenticated user.
const NAV_RESOURCE_MAP: Record<string, { resource: Resource; action: Action } | "super_admin_only" | null> = {
  dashboard:           null,
  students:            { resource: "leads",               action: "read" },
  sources:             { resource: "sources",             action: "read" },
  institutions:        { resource: "institutions",        action: "read" },
  analytics:           { resource: "analytics",           action: "read" },
  events:              { resource: "events",              action: "read" },
  reports:             { resource: "reports",             action: "read" },
  executive_dashboard: { resource: "executive_dashboard", action: "read" },
  hr:                  { resource: "erp",                 action: "read" },
  markets:             { resource: "markets",             action: "read" },
  stakeholders:        { resource: "stakeholders",        action: "read" },
  activities_field:    { resource: "activities",           action: "read" },
  tasks:               { resource: "tasks",               action: "read" },
  travel:              { resource: "travel",              action: "read" },
  risk_compliance:     { resource: "risk_compliance",     action: "read" },
  knowledge:           { resource: "knowledge",           action: "read" },
  whatsapp:            { resource: "whatsapp",            action: "read" },
  settings:            { resource: "settings",            action: "read" },
  activity_log:        "super_admin_only",
};

/**
 * Returns the set of nav keys visible to the given role, respecting DB overrides.
 */
export async function getEffectiveNavKeys(role: Role): Promise<string[]> {
  const perms = await getEffectivePermissions(role);
  const allowed: string[] = [];

  for (const [key, mapping] of Object.entries(NAV_RESOURCE_MAP)) {
    if (mapping === "super_admin_only") {
      if (role === "SUPER_ADMIN") allowed.push(key);
    } else if (mapping === null) {
      allowed.push(key);
    } else {
      if (perms[mapping.resource]?.[mapping.action]) {
        allowed.push(key);
      }
    }
  }

  return allowed;
}
