import { db } from "@/lib/db";
import {
  LEAVE_POLICIES,
  LEAVE_TYPES,
  type LeavePolicy,
  type LeaveTypeKey,
} from "@/lib/leave-policy";

/**
 * Resolves the leave policy for an employee's region. Server-only (DB access).
 *
 * The default policy in lib/leave-policy.ts is the baseline. A `leave_policies`
 * row for (region, leaveType) overrides only the editable NUMBERS — days
 * accrued, waiting period, and the max cap — leaving the accrual mode and every
 * other rule from the default. Because entitlement is computed on read, a change
 * here takes effect on the next balance computation (no job, "real time").
 */

export type ResolvedPolicies = Record<LeaveTypeKey, LeavePolicy>;

interface OverrideRow {
  leaveType: string;
  accrualDays: number;
  waitingPeriodValue: number;
  waitingPeriodUnit: string;
  maxBalance: number | null;
}

/** A readable summary built from the overridden numbers (the default's
 *  hand-written summary would otherwise state the old figures). */
function summarize(p: LeavePolicy): string {
  const wait = `${p.waitingPeriod.value} ${p.waitingPeriod.unit}`;
  const cap = p.maxBalance != null ? ` Caps at ${p.maxBalance} days.` : "";
  const reset = p.resetYearly ? " Resets on 31 December." : "";
  if (p.accrual.mode === "MONTHLY_ON_JOINING") {
    return `${p.accrual.days} day(s) earned for every complete month worked, available ${wait} after joining.${cap}${reset}`;
  }
  return `${p.accrual.days} day(s) per year, available ${wait} after joining.${cap}${reset}`;
}

function applyOverride(base: LeavePolicy, o: OverrideRow): LeavePolicy {
  const merged: LeavePolicy = {
    ...base,
    waitingPeriod: {
      value: o.waitingPeriodValue,
      unit: o.waitingPeriodUnit === "days" ? "days" : "months",
    },
    accrual: { ...base.accrual, days: o.accrualDays },
    maxBalance: o.maxBalance,
  };
  return { ...merged, summary: summarize(merged) };
}

function merge(regionRows: OverrideRow[]): ResolvedPolicies {
  const resolved: ResolvedPolicies = { ...LEAVE_POLICIES };
  for (const r of regionRows) {
    const base = LEAVE_POLICIES[r.leaveType as LeaveTypeKey];
    if (base) resolved[r.leaveType as LeaveTypeKey] = applyOverride(base, r);
  }
  return resolved;
}

/** Policies for one region (or the defaults when regionId is null/none set). */
export async function policiesForRegion(
  regionId: string | null | undefined
): Promise<ResolvedPolicies> {
  if (!regionId) return { ...LEAVE_POLICIES };
  const rows = await db.leavePolicy.findMany({ where: { regionId } });
  return merge(rows as OverrideRow[]);
}

/**
 * Loads EVERY region override once and returns a synchronous resolver — for
 * screens that compute balances for many employees (the HR team view) so they
 * don't hit the database per person.
 */
export async function buildRegionPolicyResolver(): Promise<
  (regionId: string | null | undefined) => ResolvedPolicies
> {
  const rows = (await db.leavePolicy.findMany()) as (OverrideRow & { regionId: string })[];
  const byRegion = new Map<string, OverrideRow[]>();
  for (const r of rows) {
    const list = byRegion.get(r.regionId) ?? [];
    list.push(r);
    byRegion.set(r.regionId, list);
  }
  return (regionId) =>
    regionId && byRegion.has(regionId) ? merge(byRegion.get(regionId)!) : { ...LEAVE_POLICIES };
}

// ─── Admin table (for the HR policy screen + its API) ────────────────────────

export interface LeavePolicyRow {
  leaveType: LeaveTypeKey;
  label: string;
  accrualMode: "MONTHLY_ON_JOINING" | "YEARLY_ON_DATE";
  isOverride: boolean;
  accrualDays: number;
  waitingPeriodValue: number;
  waitingPeriodUnit: string;
  maxBalance: number | null;
}
export interface LeavePolicyRegion {
  id: string;
  name: string;
  code: string;
  policies: Record<LeaveTypeKey, LeavePolicyRow>;
}
export interface LeavePolicyTable {
  regions: LeavePolicyRegion[];
  defaults: Record<LeaveTypeKey, LeavePolicyRow>;
}

export function defaultPolicyRow(leaveType: LeaveTypeKey): LeavePolicyRow {
  const p = LEAVE_POLICIES[leaveType];
  return {
    leaveType,
    label: p.label,
    accrualMode: p.accrual.mode,
    isOverride: false,
    accrualDays: p.accrual.days,
    waitingPeriodValue: p.waitingPeriod.value,
    waitingPeriodUnit: p.waitingPeriod.unit,
    maxBalance: p.maxBalance,
  };
}

/** The full edit table: every region's effective numbers + the defaults. */
export async function leavePolicyTable(): Promise<LeavePolicyTable> {
  const [regions, overrides] = await Promise.all([
    db.region.findMany({ select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
    db.leavePolicy.findMany(),
  ]);
  const byRegion = new Map<string, Map<string, (typeof overrides)[number]>>();
  for (const o of overrides) {
    const m = byRegion.get(o.regionId) ?? new Map();
    m.set(o.leaveType, o);
    byRegion.set(o.regionId, m);
  }
  const defaults = Object.fromEntries(
    LEAVE_TYPES.map((t) => [t, defaultPolicyRow(t)])
  ) as Record<LeaveTypeKey, LeavePolicyRow>;

  const regionData: LeavePolicyRegion[] = regions.map((r) => ({
    id: r.id,
    name: r.name,
    code: r.code,
    policies: Object.fromEntries(
      LEAVE_TYPES.map((t) => {
        const o = byRegion.get(r.id)?.get(t);
        const d = defaults[t];
        return [
          t,
          {
            ...d,
            isOverride: !!o,
            accrualDays: o?.accrualDays ?? d.accrualDays,
            waitingPeriodValue: o?.waitingPeriodValue ?? d.waitingPeriodValue,
            waitingPeriodUnit: o?.waitingPeriodUnit ?? d.waitingPeriodUnit,
            maxBalance: o ? o.maxBalance : d.maxBalance,
          },
        ];
      })
    ) as Record<LeaveTypeKey, LeavePolicyRow>,
  }));

  return { regions: regionData, defaults };
}
