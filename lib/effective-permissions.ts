import { cache } from "react";
import { db } from "@/lib/db";
import { PERMISSION_MATRIX, ALL_RESOURCES, ALL_ACTIONS } from "@/lib/permissions";
import type { Role, Resource, Action } from "@/lib/permissions";

// ALL_RESOURCES and ALL_ACTIONS are imported here, not redeclared.
//
// This file used to keep its own hardcoded copy of the resource list, and
// getEffectivePermissions() builds its result by iterating that list. Any
// resource missing from the copy was therefore never given an entry, and
// effectiveHasPermission() returned false for every action on it — so a
// resource could be granted to a role in PERMISSION_MATRIX and still be denied
// at every route, with nothing in either file to indicate why.
//
// That is precisely what happened when icr_transition was added: the matrix
// said REGIONAL_MANAGER holds write, and the API answered 403.
//
// The exported ALL_RESOURCES is derived from PERMISSION_MATRIX.SUPER_ADMIN, so
// it cannot fall behind the matrix the way a second hand-maintained list can.

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
  recruitment_network:  { resource: "recruitment_network",  action: "read" },
  recruitment_planning: { resource: "recruitment_planning", action: "read" },
  icr_transition:       { resource: "icr_transition",       action: "read" },
  forecasting:          { resource: "forecasting",          action: "read" },
  market_intelligence:  { resource: "market_intelligence",  action: "read" },
  field_operations:     { resource: "field_operations",     action: "read" },
  tasks:               { resource: "tasks",               action: "read" },
  travel:              { resource: "travel",              action: "read" },
  risk_compliance:     { resource: "risk_compliance",     action: "read" },
  knowledge:           { resource: "knowledge",           action: "read" },
  whatsapp:            { resource: "whatsapp",            action: "read" },
  settings:            { resource: "settings",            action: "read" },
  activity_log:        "super_admin_only",
  // Must stay in sync with NAV_PERMISSIONS in lib/permissions.ts. A key absent
  // here is dropped from getEffectiveNavKeys(), which hides it for every role —
  // recycle_bin was listed in NAV_PERMISSIONS but missing here, so the sidebar
  // link never rendered even for SUPER_ADMIN.
  recycle_bin:         "super_admin_only",
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
