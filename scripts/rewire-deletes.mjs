#!/usr/bin/env node
/**
 * Rewire every DELETE endpoint to route through lib/recycle-bin.trashRecord.
 * Runs once during the phase-9 rollout; safe to re-run (idempotent).
 *
 * For each mapping:
 *   • adds the import if missing,
 *   • replaces the direct .delete({...}) or .update({data:{deletedAt: new Date()}})
 *     call with await trashRecord({entityType, entityId, userId}),
 *   • leaves audit_log calls in place (harmless overlap; the bin's own index
 *     row is what the UI reads).
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

// One entry per DELETE endpoint.
// entityId = how the endpoint names the id it deletes (usually "id",
// sometimes "kpiId", "issueId", etc.)
const MAP = [
  { file: "app/api/institutions/[id]/route.ts",           entity: "Institution",           entityId: "id" },
  { file: "app/api/leads/[id]/route.ts",                  entity: "Lead",                  entityId: "id" },
  { file: "app/api/events/[id]/route.ts",                 entity: "Event",                 entityId: "id" },
  { file: "app/api/sources/[id]/route.ts",                entity: "RecruitmentPartner",    entityId: "id" },
  { file: "app/api/tasks/[id]/route.ts",                  entity: "Task",                  entityId: "id" },
  { file: "app/api/reports/[id]/route.ts",                entity: "MonthlyReport",         entityId: "id" },
  { file: "app/api/markets/[id]/route.ts",                entity: "Market",                entityId: "id" },
  { file: "app/api/activities/[id]/route.ts",             entity: "Activity",              entityId: "id" },
  { file: "app/api/stakeholders/schools/[id]/route.ts",   entity: "School",                entityId: "id" },
  { file: "app/api/hr/tasks/[id]/route.ts",               entity: "HRTask",                entityId: "id" },
  { file: "app/api/settings/users/[id]/route.ts",         entity: "User",                  entityId: "id" },
  { file: "app/api/attachments/[id]/route.ts",            entity: "Attachment",            entityId: "id" },
  { file: "app/api/risks/[id]/route.ts",                  entity: "RiskRegister",          entityId: "id" },
  { file: "app/api/compliance/[id]/route.ts",             entity: "ComplianceItem",        entityId: "id" },
  { file: "app/api/hr/account-requests/[id]/route.ts",    entity: "AccountRequest",        entityId: "id" },
  { file: "app/api/hr/assets/[id]/route.ts",              entity: "ITAsset",               entityId: "id" },
  { file: "app/api/hr/holidays/[id]/route.ts",            entity: "Holiday",               entityId: "id" },
  { file: "app/api/hr/performance-reviews/[id]/route.ts", entity: "PerformanceReview",     entityId: "id" },
  { file: "app/api/hr/succession-plans/[id]/route.ts",    entity: "SuccessionPlan",        entityId: "id" },
  { file: "app/api/hr/knowledge-base/attachments/[attachmentId]/route.ts", entity: "KnowledgeBaseAttachment", entityId: "attachmentId" },
  { file: "app/api/institution-interests/[id]/route.ts",  entity: "InstitutionInterest",   entityId: "id" },
  { file: "app/api/institutions/[id]/contracts/[contractId]/attachments/[attachmentId]/route.ts", entity: "ContractAttachment", entityId: "attachmentId" },
  { file: "app/api/institutions/[id]/deliverables/[deliverableId]/route.ts", entity: "Deliverable", entityId: "deliverableId" },
  { file: "app/api/institutions/[id]/issues/[issueId]/route.ts", entity: "ClientIssue",    entityId: "issueId" },
  { file: "app/api/institutions/[id]/kpis/[kpiId]/route.ts", entity: "ClientKPI",           entityId: "kpiId" },
  { file: "app/api/reports/qbr/[id]/route.ts",            entity: "QuarterlyBusinessReview", entityId: "id" },
  { file: "app/api/stakeholders/agents/[id]/route.ts",    entity: "AgentProfile",          entityId: "id" },
  { file: "app/api/stakeholders/counsellors/[id]/route.ts", entity: "Counsellor",           entityId: "id" },
  { file: "app/api/travel/[id]/route.ts",                 entity: "TravelRequest",         entityId: "id" },
  { file: "app/api/partner-contacts/[id]/route.ts",       entity: "PartnerContact",        entityId: "id" },
];

const IMPORT = 'import { trashRecord } from "@/lib/recycle-bin";';

function processFile({ file, entity, entityId }) {
  const full = path.join(ROOT, file);
  if (!fs.existsSync(full)) {
    return { file, status: "SKIP (missing)" };
  }
  let src = fs.readFileSync(full, "utf8");
  const before = src;

  // Idempotency: if this file already routes to trashRecord for this entity,
  // don't touch it. Prevents double-wiring on re-runs.
  const alreadyWired = new RegExp(`trashRecord\\(\\s*\\{[^}]*entityType:\\s*["']${entity}["']`).test(src);
  if (alreadyWired) {
    return { file, status: "SKIP (already wired)" };
  }

  // 1. Add the import if not already present.
  if (!src.includes("lib/recycle-bin")) {
    // Insert after the last import block. Find the last `^import` line.
    const importLines = [...src.matchAll(/^import .*;$/gm)];
    if (importLines.length === 0) {
      return { file, status: "SKIP (no imports found)" };
    }
    const lastImport = importLines[importLines.length - 1];
    const insertAt = lastImport.index + lastImport[0].length;
    src = src.slice(0, insertAt) + "\n" + IMPORT + src.slice(insertAt);
  }

  // 2. Replace the destructive call inside the DELETE handler with trashRecord.
  //    Match either:
  //      await db.<model>.delete({ where: { id: <entityId> } });    // hard delete
  //      await db.<model>.update({...deletedAt: new Date()...});    // soft delete
  //
  //    Only the FIRST such call inside the file is replaced (the DELETE
  //    handler runs once); we don't want to touch unrelated delete calls
  //    that may live in PATCH/POST handlers.

  const idKey = entityId;
  const idRef = "id"; // The local variable used in the handler — always aliased to `id` in the handlers we surveyed.
  // Some routes destructure as `const { id, kpiId } = await params;` so the
  // local name is the entityId itself. Use whichever appears.
  const localIdCandidates = new Set([idRef, entityId]);

  // Build the replacement.
  const replacement = (localName) =>
    `await trashRecord({ entityType: "${entity}", entityId: ${localName}, userId: session.user.id });`;

  // Try hard-delete pattern first.
  // Match either `where: { id }` (shorthand) or `where: { id: id }` (explicit).
  // Also match `where: { id: entityId }` for endpoints that destructure to a
  // custom variable name.
  const idAlternation = [...localIdCandidates].join("|");
  const whereSpec = `\\{\\s*(?:(?:${idAlternation})|(?:[A-Za-z]+:\\s*(?:${idAlternation})))\\s*(?:,[^}]*)?\\}`;

  const hardDeletePattern = new RegExp(
    "await db\\.[A-Za-z]+\\.delete\\(\\s*\\{\\s*where:\\s*" +
      whereSpec +
      "\\s*\\}\\s*\\)\\s*;",
    "m"
  );

  const hardMatch = src.match(hardDeletePattern);
  if (hardMatch) {
    // Figure out which local name to pass — pick whichever candidate appears
    // in the destructuring for this file.
    const candidate = [...localIdCandidates].find((c) => new RegExp(`\\b${c}\\b`).test(src)) ?? "id";
    src = src.replace(hardDeletePattern, replacement(candidate));
  } else {
    // Try soft-delete pattern: db.<model>.update({ where: {...}, data: { deletedAt: new Date() } });
    const softDeletePattern = new RegExp(
      "await db\\.[A-Za-z]+\\.update\\(\\s*\\{\\s*where:\\s*" +
        whereSpec +
        "\\s*,\\s*data:\\s*\\{[^}]*deletedAt:\\s*new Date\\(\\)[^}]*\\}\\s*,?\\s*\\}\\s*\\)\\s*;",
      "m"
    );
    const softMatch = src.match(softDeletePattern);
    if (softMatch) {
      const candidate = [...localIdCandidates].find((c) => new RegExp(`\\b${c}\\b`).test(src)) ?? "id";
      src = src.replace(softDeletePattern, replacement(candidate));
    } else {
      return { file, status: "MISS (no delete/update matched)" };
    }
  }

  if (src === before) return { file, status: "SKIP (no change)" };
  fs.writeFileSync(full, src);
  return { file, status: "OK" };
}

const results = MAP.map(processFile);
for (const r of results) {
  console.log(`${r.status.padEnd(30)} ${r.file}`);
}
const ok = results.filter((r) => r.status === "OK").length;
const miss = results.filter((r) => r.status.startsWith("MISS")).length;
const skip = results.filter((r) => r.status.startsWith("SKIP")).length;
console.log(`\n${ok} rewired · ${miss} missed · ${skip} skipped`);
process.exit(miss > 0 ? 1 : 0);
