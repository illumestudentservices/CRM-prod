/**
 * The IT asset register's vocabulary, in one place.
 *
 * These lists come from the Reference Lists tab of the "Global IT Equipment
 * Inventory" workbook that the regional managers fill in — that sheet is the
 * source of truth for what the business calls things, and the CRM matching it
 * is what lets a manager recognise their own register on screen.
 *
 * No database import here on purpose: the Assets tab is a client component, and
 * a "use client" file that reaches a module importing `@/lib/db` drags `pg` into
 * the browser bundle and stops the WHOLE app compiling with "Can't resolve
 * 'dns'". The importer needs the same tables, so they live in a leaf module.
 */

// ─── Equipment type ─────────────────────────────────────────────────────────

/**
 * The register's list, in its order. `OTHER` is last and is where anything
 * unrecognised lands — a register that refuses an unusual device just means
 * the device goes unrecorded.
 */
export const ASSET_TYPES = [
  "LAPTOP",
  "DESKTOP",
  "MONITOR",
  "MOBILE_PHONE",
  "TABLET",
  "DOCKING_STATION",
  "PRINTER",
  "HEADSET",
  "OTHER",
] as const;
export type AssetType = (typeof ASSET_TYPES)[number];

export const ASSET_TYPE_LABELS: Record<AssetType, string> = {
  LAPTOP: "Laptop",
  DESKTOP: "Desktop",
  MONITOR: "Monitor",
  MOBILE_PHONE: "Mobile Phone",
  TABLET: "Tablet",
  DOCKING_STATION: "Docking Station",
  PRINTER: "Printer",
  HEADSET: "Headset",
  OTHER: "Other",
};

// ─── Status ─────────────────────────────────────────────────────────────────

/**
 * OPERATIONAL state, not custody. Whether a device is out with someone is
 * recorded by AssetAssignment; this says what the device is doing.
 *
 * The first five are the register's Reference Lists verbatim. TEMPORARY and
 * STOLEN are here because people typed them into the sheet — the list did not
 * cover a loaner or a theft, and neither is honestly representable by any of the
 * five. Mapping STOLEN onto LOST in particular would erase the difference
 * between mislaid and taken, which is a different conversation with insurance
 * and a different conversation with the person.
 */
export const ASSET_STATUSES = [
  "IN_USE",
  "SPARE",
  "TEMPORARY",
  "REPAIR",
  "LOST",
  "STOLEN",
  "RETIRED",
] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const ASSET_STATUS_LABELS: Record<AssetStatus, string> = {
  IN_USE: "In Use",
  SPARE: "Spare",
  TEMPORARY: "Temporary",
  REPAIR: "Repair",
  LOST: "Lost",
  STOLEN: "Stolen",
  RETIRED: "Retired",
};

export const ASSET_STATUS_BADGE: Record<
  AssetStatus,
  "success" | "secondary" | "warning" | "destructive"
> = {
  IN_USE: "success",
  SPARE: "secondary",
  TEMPORARY: "warning",
  REPAIR: "warning",
  LOST: "destructive",
  STOLEN: "destructive",
  RETIRED: "secondary",
};

/** Statuses that mean the device needs somebody to do something about it. */
export const ASSET_STATUSES_NEEDING_ATTENTION: AssetStatus[] = ["REPAIR", "LOST", "STOLEN"];

// ─── Condition ──────────────────────────────────────────────────────────────

export const ASSET_CONDITIONS = ["EXCELLENT", "GOOD", "FAIR", "POOR", "DAMAGED"] as const;
export type AssetCondition = (typeof ASSET_CONDITIONS)[number];

export const ASSET_CONDITION_LABELS: Record<AssetCondition, string> = {
  EXCELLENT: "Excellent",
  GOOD: "Good",
  FAIR: "Fair",
  POOR: "Poor",
  DAMAGED: "Damaged",
};

export const ASSET_CONDITION_CLASS: Record<AssetCondition, string> = {
  EXCELLENT: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  GOOD: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300",
  FAIR: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  POOR: "bg-orange-100 text-orange-800 dark:bg-orange-500/15 dark:text-orange-300",
  DAMAGED: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300",
};

// ─── Purchase-date precision ────────────────────────────────────────────────

export const PURCHASE_PRECISIONS = ["DAY", "MONTH", "YEAR"] as const;
export type PurchasePrecision = (typeof PURCHASE_PRECISIONS)[number];

/**
 * Renders a purchase date to exactly the precision that is known.
 *
 * Fixed to UTC. The dates are stored as UTC midnight, and formatting them in the
 * viewer's zone moves a June purchase into May for anybody west of Greenwich —
 * the same timezone bug that produced hydration errors on the dashboard.
 */
export function formatPurchase(
  purchasedAt: string | Date | null | undefined,
  precision?: string | null
): string | null {
  if (!purchasedAt) return null;
  const d = new Date(purchasedAt);
  if (Number.isNaN(d.getTime())) return null;
  if (precision === "YEAR") return String(d.getUTCFullYear());
  if (precision === "MONTH") {
    return d.toLocaleDateString("en-CA", { year: "numeric", month: "long", timeZone: "UTC" });
  }
  return d.toLocaleDateString("en-CA", {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
  });
}
