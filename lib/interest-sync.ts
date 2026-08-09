import { db } from "./db";
import type { LeadStage } from "@prisma/client";

/// Dual-write cutover helper.
///
/// While the split is rolling out, every write to `InstitutionInterest` also
/// updates the parent `Lead` so legacy readers (analytics group-bys, the old
/// students UI, offline sync) keep seeing a coherent snapshot.
///
/// Rules — applied every time an interest is created, its stage changes, or
/// it is closed/reopened:
///
///   * If the student has ONE open interest → Lead.stage mirrors it,
///     Lead.institutionId points to that institution.
///   * If the student has MULTIPLE open interests → Lead.stage is the most
///     advanced stage (max by pipeline order), Lead.institutionId points to
///     the earliest-created interest (stable "primary" pointer).
///   * If the student has ZERO open interests → the current Lead.stage is
///     preserved (may be a closed outcome from before the split, or from the
///     last-closed interest).
///
/// The stage ordering is the pipeline order from schema.prisma's LeadStage
/// enum: closed outcomes come last so a LOST interest never wins over an
/// active AWAITING_DECISION one.
const STAGE_ORDER: LeadStage[] = [
  "NEW_LEAD",
  "CONTACTED",
  "QUALIFIED",
  "APPLICATION_SUBMITTED",
  "AWAITING_DECISION",
  "OFFER_RECEIVED",
  "DEPOSIT_PAID",
  "ENROLLED",
  "LOST",
  "DEFERRED",
  "APPLICATION_REJECTED",
];

function isMoreAdvanced(a: LeadStage, b: LeadStage): boolean {
  return STAGE_ORDER.indexOf(a) > STAGE_ORDER.indexOf(b);
}

export async function syncLeadFromInterests(leadId: string): Promise<void> {
  const openInterests = await db.institutionInterest.findMany({
    where: { leadId, closedAt: null },
    orderBy: { createdAt: "asc" },
    select: { stage: true, institutionId: true, lastContactedAt: true, lastProgressedAt: true },
  });

  if (openInterests.length === 0) {
    // No open interests — leave Lead.stage as-is (likely a closed outcome).
    return;
  }

  let mostAdvanced: LeadStage = openInterests[0].stage;
  let lastContactedAt: Date | null = openInterests[0].lastContactedAt;
  let lastProgressedAt: Date | null = openInterests[0].lastProgressedAt;
  for (const oi of openInterests) {
    if (isMoreAdvanced(oi.stage, mostAdvanced)) mostAdvanced = oi.stage;
    if (oi.lastContactedAt && (!lastContactedAt || oi.lastContactedAt > lastContactedAt)) {
      lastContactedAt = oi.lastContactedAt;
    }
    if (oi.lastProgressedAt && (!lastProgressedAt || oi.lastProgressedAt > lastProgressedAt)) {
      lastProgressedAt = oi.lastProgressedAt;
    }
  }

  await db.lead.update({
    where: { id: leadId },
    data: {
      stage: mostAdvanced,
      institutionId: openInterests[0].institutionId,
      lastContactedAt: lastContactedAt ?? undefined,
      lastProgressedAt: lastProgressedAt ?? undefined,
    },
  });
}
