import { db } from "./db";

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
  marketId?: string | null;
  from?: Date;
  to?: Date;
}

function studentWhere(scope: ReportScope) {
  const where: Record<string, unknown> = { deletedAt: null };
  if (scope.regionId) where.regionId = scope.regionId;
  if (scope.assignedICRId) where.assignedICRId = scope.assignedICRId;
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
    lead: { deletedAt: null },
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
