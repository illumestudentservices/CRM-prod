import { formatCurrency } from "@/lib/utils";
/**
 * Formatting for `MonthlyReport.kpiSummary`.
 *
 * That column is JSONB, so its shape is whatever was written when the report
 * was generated. Reports predating the current KPI set hold only
 * `{totalLeads, conversionRate, avgTimeToOffer}`; three rows in production hold
 * `null` outright. Every read site had cast it to the full record, which made
 * TypeScript vouch for fields that were not there — `${kpi.contactRate}%`
 * produced the literal string "undefined%", on screen and in the report email
 * sent to partner institutions.
 *
 * An em dash is the honest rendering for a metric that was never recorded.
 * Defaulting to 0 would assert a measurement that was never taken — "0%
 * contact rate" reads as a performance failure rather than missing data.
 */

export interface KpiSummary {
  totalLeads: number;
  enrolled: number;
  conversionRate: number;
  contactRate: number;
  eventsCount: number;
  totalEventCost: number;
}

/** What a read of the column can actually be relied on to contain. */
export type PartialKpi = Partial<KpiSummary> | null | undefined;

export const KPI_ABSENT = "—";

/** A count, or an em dash when the metric predates this report. */
export function kpiNum(kpi: PartialKpi, key: keyof KpiSummary): string {
  const v = kpi?.[key];
  return typeof v === "number" ? String(v) : KPI_ABSENT;
}

/** A percentage, or an em dash. */
export function kpiPct(kpi: PartialKpi, key: keyof KpiSummary): string {
  const v = kpi?.[key];
  return typeof v === "number" ? `${v}%` : KPI_ABSENT;
}

/** A currency amount. Zero cost is real information, but renders as a dash too
 *  because "$0" in a cost box reads as a data-entry error to partners. */
export function kpiMoney(kpi: PartialKpi, key: keyof KpiSummary): string {
  const v = kpi?.[key];
  if (typeof v !== "number" || v <= 0) return KPI_ABSENT;
  // Locale-pinned via formatCurrency. A bare Number.toLocaleString() formats
  // against whatever default locale the runtime has, and the server's is not
  // guaranteed to match the browser's — React then reports a hydration
  // mismatch (#418, seen on production) and re-renders past it. Same class of
  // bug as the toLocaleDateString() calls already replaced on this page.
  return formatCurrency(v);
}
