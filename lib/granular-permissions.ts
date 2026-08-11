import { cache } from "react";
import { db } from "@/lib/db";
import type { Role, Resource, Action } from "@/lib/permissions";
import { effectiveHasPermission } from "@/lib/effective-permissions";

/**
 * Capability- and field-level permissions.
 *
 * Three tiers, evaluated outermost-in. A tier can only narrow what the tier
 * above it granted:
 *
 *   1. NAV_PERMISSIONS        can the role open the module at all
 *   2. resource × action      can it read / write / delete / approve / export
 *   3. capability and field   which specific operations, and which columns
 *
 * Tier 3 is what this file adds. It is deliberately subtractive: a capability
 * check first requires its underlying action, so granting `leads.merge` to a
 * role without `leads:write` still denies. That means an administrator can
 * never widen access by accident from the granular screen — the coarse matrix
 * remains the ceiling.
 *
 * Only deviations from the defaults below are persisted, so an empty
 * granular_permissions table reproduces the pre-Phase-10 behaviour exactly.
 */

// ─── Capabilities ──────────────────────────────────────────────────────────

export interface CapabilityDef {
  /** Stable key, "<resource>.<verb>". Persisted, so don't rename casually. */
  key: string;
  resource: Resource;
  label: string;
  description: string;
  /**
   * The coarse action this capability lives inside. The capability can never
   * grant more than this action already allows.
   */
  requires: Action;
  /**
   * Roles that hold it out of the box. Anything not listed is denied unless a
   * granular row grants it — and even then, only if `requires` passes.
   */
  defaultRoles: Role[];
}

const ADMIN: Role[] = ["SUPER_ADMIN"];
const ADMIN_HQ: Role[] = ["SUPER_ADMIN", "HQ_EXECUTIVE"];
const ADMIN_HQ_RM: Role[] = ["SUPER_ADMIN", "HQ_EXECUTIVE", "REGIONAL_MANAGER"];
const ADMIN_HQ_RM_ICR: Role[] = ["SUPER_ADMIN", "HQ_EXECUTIVE", "REGIONAL_MANAGER", "ICR"];

/**
 * Operations that are meaningfully riskier than the action containing them —
 * the ones worth being able to withhold from someone who otherwise has write.
 */
export const CAPABILITIES: CapabilityDef[] = [
  // ── Students ──
  {
    key: "leads.merge", resource: "leads", requires: "delete",
    label: "Merge duplicate students",
    description: "Irreversibly folds one student record into another.",
    defaultRoles: ADMIN,
  },
  {
    key: "leads.export_pii", resource: "leads", requires: "export",
    label: "Export personal data",
    description: "Include email, phone, DOB and passport in exports.",
    defaultRoles: ADMIN_HQ,
  },
  {
    key: "leads.bulk_reassign", resource: "leads", requires: "write",
    label: "Bulk reassign students",
    description: "Change the owning ICR on many records at once.",
    defaultRoles: ADMIN_HQ_RM,
  },
  {
    key: "leads.override_stage_gate", resource: "leads", requires: "write",
    label: "Override pipeline stage gates",
    description: "Advance a student past a stage whose entry criteria are unmet.",
    defaultRoles: ADMIN_HQ_RM,
  },
  // ── Clients ──
  {
    key: "institutions.view_commercials", resource: "institutions", requires: "read",
    label: "View contract value and renewal",
    description: "See commercial terms on the client record.",
    defaultRoles: ADMIN_HQ_RM,
  },
  {
    key: "institutions.edit_commercials", resource: "institutions", requires: "write",
    label: "Edit contract value and renewal",
    description: "Change commercial terms.",
    defaultRoles: ADMIN_HQ,
  },
  {
    key: "institutions.set_health", resource: "institutions", requires: "write",
    label: "Set account health",
    description: "Change the red/amber/green account health rating.",
    defaultRoles: ADMIN_HQ_RM,
  },
  // ── Reports ──
  {
    key: "reports.approve_final", resource: "reports", requires: "approve",
    label: "Give final report approval",
    description: "Move a monthly report to its approved state.",
    defaultRoles: ADMIN_HQ_RM,
  },
  {
    key: "reports.email_external", resource: "reports", requires: "export",
    label: "Email reports externally",
    description: "Send a report to an address outside the organisation.",
    defaultRoles: ADMIN_HQ_RM,
  },
  // ── Planning ──
  {
    key: "recruitment_planning.approve_plan", resource: "recruitment_planning", requires: "approve",
    label: "Approve a recruitment plan",
    description: "Give the approval that activates a plan and commits budget.",
    defaultRoles: ADMIN_HQ,
  },
  {
    key: "recruitment_planning.approve_variation", resource: "recruitment_planning", requires: "approve",
    label: "Approve a variation request",
    description: "Approve a change to an already-locked plan.",
    defaultRoles: ADMIN_HQ,
  },
  // ── Network ──
  {
    key: "recruitment_network.force_create_duplicate", resource: "recruitment_network", requires: "write",
    label: "Bypass duplicate detection",
    description: "Create a partner, event or campaign that matched an existing one.",
    defaultRoles: ADMIN,
  },
  // ── Admin ──
  {
    key: "users.reset_mfa", resource: "users", requires: "write",
    label: "Reset another user's MFA",
    description: "Force a user to re-enrol two-factor authentication.",
    defaultRoles: ADMIN,
  },
  {
    key: "users.change_role", resource: "users", requires: "write",
    label: "Change a user's role",
    description: "Grant or remove a role, including privileged ones.",
    defaultRoles: ADMIN,
  },
  {
    key: "settings.purge_recycle_bin", resource: "settings", requires: "delete",
    label: "Permanently delete from the recycle bin",
    description: "Destroy a record before its retention window expires.",
    defaultRoles: ADMIN,
  },
];

export const CAPABILITY_BY_KEY: Record<string, CapabilityDef> =
  Object.fromEntries(CAPABILITIES.map((c) => [c.key, c]));

// ─── Fields ────────────────────────────────────────────────────────────────

export interface FieldDef {
  name: string;
  label: string;
  /** Shown in the admin UI so the person toggling knows what they're exposing. */
  sensitivity: "normal" | "personal" | "commercial";
  /** Roles that may read it by default. */
  readRoles: Role[];
  /** Roles that may write it by default. Must be a subset of readRoles in practice. */
  writeRoles: Role[];
}

const ALL_STAFF: Role[] = [
  "SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER",
  "ICR", "ACCOUNT_MANAGER", "ADMISSIONS_SUPPORT", "VP_GLOBAL_SALES",
];

/**
 * Field-level control is opt-in per resource. Listing every column would make
 * the admin screen unusable and most columns carry no independent risk — these
 * are the ones where "can see the record" and "can see this column" genuinely
 * differ.
 */
export const FIELD_CATALOG: Record<string, { label: string; fields: FieldDef[] }> = {
  leads: {
    label: "Students",
    fields: [
      {
        name: "email", label: "Email", sensitivity: "personal",
        readRoles: ALL_STAFF,
        writeRoles: ["SUPER_ADMIN", "HQ_EXECUTIVE", "REGIONAL_MANAGER", "ICR", "ADMISSIONS_SUPPORT"],
      },
      {
        name: "phone", label: "Phone", sensitivity: "personal",
        readRoles: ALL_STAFF,
        writeRoles: ["SUPER_ADMIN", "HQ_EXECUTIVE", "REGIONAL_MANAGER", "ICR", "ADMISSIONS_SUPPORT"],
      },
      {
        name: "dateOfBirth", label: "Date of birth", sensitivity: "personal",
        readRoles: ["SUPER_ADMIN", "HQ_EXECUTIVE", "REGIONAL_MANAGER", "ICR", "ADMISSIONS_SUPPORT"],
        writeRoles: ["SUPER_ADMIN", "REGIONAL_MANAGER", "ICR", "ADMISSIONS_SUPPORT"],
      },
      {
        name: "passportNumber", label: "Passport number", sensitivity: "personal",
        readRoles: ["SUPER_ADMIN", "REGIONAL_MANAGER", "ICR", "ADMISSIONS_SUPPORT"],
        writeRoles: ["SUPER_ADMIN", "ICR", "ADMISSIONS_SUPPORT"],
      },
      {
        name: "budgetRange", label: "Budget range", sensitivity: "personal",
        readRoles: ALL_STAFF,
        writeRoles: ["SUPER_ADMIN", "HQ_EXECUTIVE", "REGIONAL_MANAGER", "ICR"],
      },
      {
        name: "notes", label: "Internal notes", sensitivity: "normal",
        readRoles: ALL_STAFF,
        writeRoles: ALL_STAFF,
      },
      {
        name: "marketingConsent", label: "Marketing consent", sensitivity: "personal",
        readRoles: ALL_STAFF,
        writeRoles: ["SUPER_ADMIN", "REGIONAL_MANAGER", "ICR"],
      },
    ],
  },
  institutions: {
    label: "Clients",
    fields: [
      {
        name: "contractValue", label: "Contract value", sensitivity: "commercial",
        readRoles: ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ACCOUNT_MANAGER", "VP_GLOBAL_SALES"],
        writeRoles: ["SUPER_ADMIN", "HQ_EXECUTIVE", "ACCOUNT_MANAGER"],
      },
      {
        name: "renewalDate", label: "Renewal date", sensitivity: "commercial",
        readRoles: ["SUPER_ADMIN", "HQ_EXECUTIVE", "HQ_ANALYTICS", "REGIONAL_MANAGER", "ACCOUNT_MANAGER", "VP_GLOBAL_SALES"],
        writeRoles: ["SUPER_ADMIN", "HQ_EXECUTIVE", "ACCOUNT_MANAGER"],
      },
      {
        name: "accountHealth", label: "Account health", sensitivity: "commercial",
        readRoles: ALL_STAFF,
        writeRoles: ["SUPER_ADMIN", "HQ_EXECUTIVE", "REGIONAL_MANAGER", "ACCOUNT_MANAGER"],
      },
      {
        name: "strategicObjectives", label: "Strategic objectives", sensitivity: "commercial",
        readRoles: ALL_STAFF,
        writeRoles: ["SUPER_ADMIN", "HQ_EXECUTIVE", "ACCOUNT_MANAGER"],
      },
      {
        name: "notes", label: "Internal notes", sensitivity: "normal",
        readRoles: ALL_STAFF,
        writeRoles: ALL_STAFF,
      },
    ],
  },
};

export const FIELD_RESOURCES = Object.keys(FIELD_CATALOG);

function fieldDef(resource: string, field: string): FieldDef | undefined {
  return FIELD_CATALOG[resource]?.fields.find((f) => f.name === field);
}

// ─── Resolver ──────────────────────────────────────────────────────────────

export interface GranularOverride {
  scope: "CAPABILITY" | "FIELD";
  resource: string;
  target: string;
  access: string | null;
  granted: boolean;
}

/**
 * All stored deviations for a role, keyed for O(1) lookup. Cached per request
 * so a page rendering a hundred rows issues one query, not a hundred.
 */
const overridesForRole = cache(async (role: Role): Promise<Map<string, boolean>> => {
  const map = new Map<string, boolean>();
  try {
    const rows = await db.granularPermission.findMany({ where: { role } });
    for (const r of rows) {
      map.set(`${r.scope}:${r.resource}:${r.target}:${r.access ?? ""}`, r.granted);
    }
  } catch {
    // Table missing or DB down — fall through to registry defaults. Failing
    // open to *defaults* (not to "allow") keeps behaviour predictable during
    // a migration window.
  }
  return map;
});

/**
 * Can this role perform a named capability?
 *
 * Checks the containing action first, so this can never grant more than the
 * coarse matrix already allows.
 */
export async function hasCapability(role: Role, key: string): Promise<boolean> {
  const def = CAPABILITY_BY_KEY[key];
  if (!def) {
    // Unknown key is a programming error; deny rather than silently allow.
    console.warn(`[granular-permissions] unknown capability "${key}"`);
    return false;
  }
  if (!(await effectiveHasPermission(role, def.resource, def.requires))) return false;

  const overrides = await overridesForRole(role);
  const stored = overrides.get(`CAPABILITY:${def.resource}:${key}:`);
  return stored ?? def.defaultRoles.includes(role);
}

/** Can this role read a specific column? Unlisted columns are always readable. */
export async function canReadField(role: Role, resource: string, field: string): Promise<boolean> {
  const def = fieldDef(resource, field);
  if (!def) return true;
  const overrides = await overridesForRole(role);
  const stored = overrides.get(`FIELD:${resource}:${field}:read`);
  return stored ?? def.readRoles.includes(role);
}

/** Can this role write a specific column? Unlisted columns are always writable. */
export async function canWriteField(role: Role, resource: string, field: string): Promise<boolean> {
  const def = fieldDef(resource, field);
  if (!def) return true;
  const overrides = await overridesForRole(role);
  const stored = overrides.get(`FIELD:${resource}:${field}:write`);
  const granted = stored ?? def.writeRoles.includes(role);
  // Writing implies reading. Allowing write without read produces a field the
  // user can overwrite but not see, which is worse than either.
  if (!granted) return false;
  return canReadField(role, resource, field);
}

/** Every controlled field of a resource this role may not read. */
export async function unreadableFields(role: Role, resource: string): Promise<string[]> {
  const cat = FIELD_CATALOG[resource];
  if (!cat) return [];
  const out: string[] = [];
  for (const f of cat.fields) {
    if (!(await canReadField(role, resource, f.name))) out.push(f.name);
  }
  return out;
}

/**
 * Strip columns the role may not read from an object or array of objects.
 *
 * Redacts by deletion rather than nulling: a null reads as "no passport on
 * file", which is a different and misleading claim.
 */
export async function redactFields<T>(role: Role, resource: string, data: T): Promise<T> {
  const hidden = await unreadableFields(role, resource);
  if (hidden.length === 0) return data;

  const strip = (row: unknown): unknown => {
    if (Array.isArray(row)) return row.map(strip);
    if (!row || typeof row !== "object") return row;
    const copy: Record<string, unknown> = { ...(row as Record<string, unknown>) };
    for (const f of hidden) delete copy[f];
    return copy;
  };
  return strip(data) as T;
}

export interface FieldWriteCheck {
  ok: boolean;
  /** Fields present in the payload that this role may not write. */
  rejected: string[];
}

/**
 * Which of the submitted fields may this role not write?
 *
 * Returns the offenders rather than throwing so the caller can decide between
 * rejecting the whole request (safer, and what the API routes do) and dropping
 * the offending keys.
 */
export async function checkFieldWrites(
  role: Role,
  resource: string,
  payload: Record<string, unknown>
): Promise<FieldWriteCheck> {
  const cat = FIELD_CATALOG[resource];
  if (!cat) return { ok: true, rejected: [] };
  const rejected: string[] = [];
  for (const f of cat.fields) {
    if (!(f.name in payload)) continue;
    if (payload[f.name] === undefined) continue;
    if (!(await canWriteField(role, resource, f.name))) rejected.push(f.name);
  }
  return { ok: rejected.length === 0, rejected };
}

// ─── Admin surface helpers ─────────────────────────────────────────────────

/** Full resolved picture for the Security screen. */
export async function granularMatrixForRole(role: Role) {
  const overrides = await overridesForRole(role);

  const capabilities = await Promise.all(
    CAPABILITIES.map(async (c) => {
      const stored = overrides.get(`CAPABILITY:${c.resource}:${c.key}:`);
      const def = c.defaultRoles.includes(role);
      return {
        key: c.key, resource: c.resource, label: c.label,
        description: c.description, requires: c.requires,
        default: def,
        granted: stored ?? def,
        overridden: stored !== undefined && stored !== def,
        // Surfaced so the UI can explain a capability that is on but inert.
        blockedByAction: !(await effectiveHasPermission(role, c.resource, c.requires)),
      };
    })
  );

  const fields = Object.entries(FIELD_CATALOG).map(([resource, cat]) => ({
    resource,
    label: cat.label,
    fields: cat.fields.map((f) => {
      const rStored = overrides.get(`FIELD:${resource}:${f.name}:read`);
      const wStored = overrides.get(`FIELD:${resource}:${f.name}:write`);
      const rDef = f.readRoles.includes(role);
      const wDef = f.writeRoles.includes(role);
      return {
        name: f.name, label: f.label, sensitivity: f.sensitivity,
        read: { default: rDef, granted: rStored ?? rDef, overridden: rStored !== undefined && rStored !== rDef },
        write: { default: wDef, granted: wStored ?? wDef, overridden: wStored !== undefined && wStored !== wDef },
      };
    }),
  }));

  return { capabilities, fields };
}

/** True when the value matches the registry default, i.e. the row can be deleted. */
export function isDefault(
  role: Role,
  scope: "CAPABILITY" | "FIELD",
  resource: string,
  target: string,
  access: string | null,
  granted: boolean
): boolean {
  if (scope === "CAPABILITY") {
    return CAPABILITY_BY_KEY[target]?.defaultRoles.includes(role) === granted;
  }
  const def = fieldDef(resource, target);
  if (!def) return true;
  const roles = access === "write" ? def.writeRoles : def.readRoles;
  return roles.includes(role) === granted;
}
