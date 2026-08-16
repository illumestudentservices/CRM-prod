import { db } from "./db";
import { resolveCountryCode } from "@/lib/country";

/// Spec §21 — reporting must distinguish three counts that get conflated
/// under the old single-lead model:
///
///   uniqueStudents      — one row per person, regardless of institutions
///   institutionInterests — one row per (person × institution) recruitment journey
///   applications        — one row per submitted LeadApplication
///
/// Every dashboard, monthly report and market intelligence summary should
/// pull from these helpers. Building group-by queries ad-hoc inside route
/// handlers is how the old code drifted into counting the same student three
/// times for three institutions.
///
/// All helpers accept an optional scope so a Regional Manager only sees
/// their region, an ICR only sees their students, etc.

export interface ReportScope {
  regionId?: string | null;
  assignedICRId?: string | null;
  institutionId?: string | null;
  /**
   * Stored country values to scope students by, e.g. ["India"].
   *
   * Replaces a `marketId` key that existed on this interface but was read by
   * NOTHING — passing it scoped nothing and reported no error, so a market
   * report silently returned business-wide totals. Use `marketCountryValues()`
   * to turn a market into this list; there is no direct Market→Lead relation to
   * join on, so country is the only available linkage.
   *
   * An EMPTY array means "no matching country", and the where-builders honour
   * that by matching nothing. That is deliberate: a market that cannot be
   * linked must report zero, not everything.
   */
  countryIn?: string[] | null;
  from?: Date;
  to?: Date;
}

function studentWhere(scope: ReportScope) {
  const where: Record<string, unknown> = { deletedAt: null };
  if (scope.regionId) where.regionId = scope.regionId;
  if (scope.assignedICRId) where.assignedICRId = scope.assignedICRId;
  // `!= null` rather than truthy: an empty array is a meaningful scope meaning
  // "nothing matched this market", and must not fall through to unscoped.
  if (scope.countryIn != null) where.countryOfResidence = { in: scope.countryIn };
  if (scope.from || scope.to) {
    where.createdAt = {
      ...(scope.from ? { gte: scope.from } : {}),
      ...(scope.to ? { lte: scope.to } : {}),
    };
  }
  return where;
}

function interestWhere(scope: ReportScope) {
  const where: Record<string, unknown> = {
    lead: {
      deletedAt: null,
      // Same empty-array reasoning as studentWhere.
      ...(scope.countryIn != null ? { countryOfResidence: { in: scope.countryIn } } : {}),
    },
  };
  if (scope.institutionId) where.institutionId = scope.institutionId;
  if (scope.assignedICRId) where.assignedICRId = scope.assignedICRId;
  if (scope.from || scope.to) {
    where.createdAt = {
      ...(scope.from ? { gte: scope.from } : {}),
      ...(scope.to ? { lte: scope.to } : {}),
    };
  }
  return where;
}

export async function countUniqueStudents(scope: ReportScope = {}): Promise<number> {
  return db.lead.count({ where: studentWhere(scope) });
}

export async function countInstitutionInterests(
  scope: ReportScope = {},
): Promise<number> {
  return db.institutionInterest.count({ where: interestWhere(scope) });
}

export async function countApplications(scope: ReportScope = {}): Promise<number> {
  const where: Record<string, unknown> = {};
  if (scope.institutionId) where.institutionId = scope.institutionId;
  if (scope.from || scope.to) {
    where.createdAt = {
      ...(scope.from ? { gte: scope.from } : {}),
      ...(scope.to ? { lte: scope.to } : {}),
    };
  }
  return db.leadApplication.count({ where });
}

/// The three-count report line used across dashboards. Returned in one shape
/// so callers can render the "1 student, 3 institution conversations, 2
/// applications" pattern the spec explicitly names (§8, Campaign Metrics).
export async function threeCountLine(scope: ReportScope = {}) {
  const [uniqueStudents, institutionInterests, applications] = await Promise.all([
    countUniqueStudents(scope),
    countInstitutionInterests(scope),
    countApplications(scope),
  ]);
  return { uniqueStudents, institutionInterests, applications };
}

/// Institution-interest pipeline by stage — used by Client Overview, Market
/// Intelligence, and the Reports module. Distinct from `Lead.stage` group-by
/// because a student who is Qualified at UofT and Offer Received at
/// Manchester counts once in each stage, not once at their "latest" stage.
export async function pipelineByStage(scope: ReportScope = {}) {
  const grouped = await db.institutionInterest.groupBy({
    by: ["stage"],
    where: interestWhere(scope),
    _count: { _all: true },
  });
  return grouped.reduce<Record<string, number>>((acc, row) => {
    acc[row.stage] = row._count._all;
    return acc;
  }, {});
}

/**
 * The stored country strings that belong to a market.
 *
 * There is no Market→Lead relation, so the only available linkage is country —
 * and the two sides are stored differently. `markets.countryCode` holds ISO
 * alpha-2 ("IN"), while `leads.countryOfResidence`, `activities.country` and
 * `events.country` hold names ("India"). Comparing them directly, which the
 * quarterly report used to do, matches nothing and reports a permanent zero.
 *
 * Rather than hardcode a reverse code→name table that would drift, this reads
 * the distinct values actually present in the column and keeps the ones that
 * resolve to the market's code through lib/country.ts — the single resolver
 * that already understands names, demonyms, alpha-2 and alpha-3. That is how
 * "UAE" and "United Arab Emirates" both reach the AE market.
 *
 * Returns null when the market has no resolvable country. Callers MUST treat
 * that as "cannot scope" and refuse to report, rather than falling back to an
 * unscoped query — showing the whole business under one market's name is the
 * exact bug this replaces.
 */
export async function marketCountryValues(
  marketId: string
): Promise<{ code: string; leads: string[]; activities: string[]; events: string[] } | null> {
  const market = await db.market.findUnique({
    where: { id: marketId },
    select: { countryCode: true, name: true },
  });
  if (!market) return null;

  // Prefer the code. The NAME is not a reliable fallback — "UAE & Gulf" is a
  // real market name and resolves to nothing.
  const code = resolveCountryCode(market.countryCode) ?? resolveCountryCode(market.name);
  if (!code) return null;

  const [leadRows, activityRows, eventRows] = await Promise.all([
    db.lead.findMany({
      where: { deletedAt: null },
      select: { countryOfResidence: true },
      distinct: ["countryOfResidence"],
    }),
    db.activity.findMany({
      where: { country: { not: null } },
      select: { country: true },
      distinct: ["country"],
    }),
    db.event.findMany({
      where: { deletedAt: null },
      select: { country: true },
      distinct: ["country"],
    }),
  ]);

  const keep = (v: string | null) => !!v && resolveCountryCode(v) === code;
  return {
    code,
    leads: leadRows.map((r) => r.countryOfResidence).filter(keep) as string[],
    activities: activityRows.map((r) => r.country).filter(keep) as string[],
    events: eventRows.map((r) => r.country).filter(keep) as string[],
  };
}
