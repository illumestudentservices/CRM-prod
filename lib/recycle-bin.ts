/**
 * Recycle bin — every DELETE in the app routes through here.
 *
 * Two strategies live under a single facade:
 *   Soft-delete entities (already carry deletedAt):
 *     • trashRecord sets deletedAt/deletedById on the row and writes an index
 *       row to deleted_records.
 *     • restore clears deletedAt/deletedById.
 *     • purgeExpired does the actual db.delete when the 60-day window elapses.
 *
 *   Hard-delete entities (no deletedAt column):
 *     • trashRecord snapshots the full row into deleted_records.data and
 *       executes the underlying db.delete now.
 *     • restore re-INSERTs the row from the snapshot.
 *     • purgeExpired just marks the deleted_records entry as purged.
 *
 * The registry below is the single source of truth for what's deleteable
 * and how to render/restore it. New entities are added by extending REGISTRY.
 */

import { db } from "@/lib/db";
import { displayName } from "@/lib/person-name";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRow = any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PrismaDelegate = any;

/** How long the item stays recoverable before the purge cron removes it. */
export const RETENTION_DAYS = 60;

interface EntityDef {
  /** Prisma delegate name — the key on db. */
  delegate: string;
  /** true if the underlying row has a deletedAt column (soft-delete path). */
  softDelete: boolean;
  /** Human display for an item in the bin. */
  label: (row: AnyRow) => string;
  /** Optional parent context, resolved from the row. */
  parent?: (row: AnyRow) => Promise<ParentContext | null> | ParentContext | null;
}

interface ParentContext {
  type: string;
  id: string;
  label: string;
}

// ── Registry ──────────────────────────────────────────────────────────────
//
// Every DELETE endpoint in app/api routes through trashRecord() with one of
// these entity keys. Adding a new deleteable entity is: (a) register it
// here, (b) call trashRecord in the DELETE handler.

const dispName = (row: AnyRow) =>
  displayName(row) || row?.name || row?.email || row?.title || row?.id || "(unnamed)";

export const REGISTRY: Record<string, EntityDef> = {
  // ── Soft-delete entities ─────────────────────────────────────────────
  Lead: {
    delegate: "lead",
    softDelete: true,
    label: (r) => `${displayName(r) || r?.email || "Lead"} — ${r?.stage ?? ""}`.trim(),
    parent: async (r) =>
      r?.institutionId
        ? {
            type: "Institution",
            id: r.institutionId,
            label:
              (await db.institution.findUnique({ where: { id: r.institutionId }, select: { name: true } }))
                ?.name ?? "Institution",
          }
        : null,
  },
  Institution: { delegate: "institution", softDelete: true, label: (r) => r.name },
  Event: { delegate: "event", softDelete: true, label: (r) => r.name ?? "Event" },
  Activity: { delegate: "activity", softDelete: true, label: (r) => r.title ?? "Activity" },
  MonthlyReport: {
    delegate: "monthlyReport",
    softDelete: true,
    label: (r) => `Report ${r?.reportingMonth ?? "?"}/${r?.reportingYear ?? "?"}`,
  },
  Market: { delegate: "market", softDelete: true, label: (r) => r.name },
  RecruitmentPartner: { delegate: "recruitmentPartner", softDelete: true, label: (r) => r.name },
  Task: { delegate: "task", softDelete: true, label: (r) => r.title },
  // HR tasks are rows in the ordinary Task table — there is no HRTask model,
  // and `db.hRTask` was undefined, so delegate() threw and DELETE
  // /api/hr/tasks/[id] returned 500 without deleting anything. Kept as its own
  // entity type so the bin can say which surface the task was deleted from.
  HRTask: { delegate: "task", softDelete: true, label: (r) => r.title },
  User: { delegate: "user", softDelete: true, label: (r) => `${dispName(r)} (${r?.email})` },
  School: { delegate: "school", softDelete: true, label: (r) => r.name },
  Campaign: { delegate: "campaign", softDelete: true, label: (r) => r.name },
  KnowledgeBase: { delegate: "knowledgeBase", softDelete: true, label: (r) => r.title },
  // Attachment is soft-delete after migration 023 (deletedAt column added).
  Attachment: {
    delegate: "attachment",
    softDelete: true,
    label: (r) => r.name ?? "Attachment",
    parent: (r) => ({ type: r.parentType, id: r.parentId, label: r.parentType }),
  },

  // ── Hard-delete entities (row snapshotted into data JSON) ────────────
  RiskRegister: { delegate: "riskRegister", softDelete: false, label: (r) => r.title },
  ComplianceItem: { delegate: "complianceItem", softDelete: false, label: (r) => r.title },
  ClientKPI: { delegate: "clientKPI", softDelete: false, label: (r) => r.name },
  Deliverable: { delegate: "deliverable", softDelete: false, label: (r) => r.title ?? "Deliverable" },
  ClientIssue: { delegate: "clientIssue", softDelete: false, label: (r) => r.title },
  InstitutionInterest: {
    delegate: "institutionInterest",
    softDelete: false,
    label: (r) => `Interest · ${r?.program ?? "programme?"}`,
  },
  Region: { delegate: "region", softDelete: false, label: (r) => r.name },
  TravelRequest: { delegate: "travelRequest", softDelete: false, label: (r) => r.purpose ?? "Travel" },
  // The label is what identifies an entry in the bin, so a field name that
  // doesn't exist renders "undefined · ABC123" and makes the deletion
  // effectively unfindable. ITAsset has `type`, not `assetType`.
  ITAsset: {
    delegate: "iTAsset",
    softDelete: false,
    label: (r) => `${r.name} · ${r.type}${r.serialNumber ? ` · ${r.serialNumber}` : ""}`,
  },
  Announcement: { delegate: "announcement", softDelete: false, label: (r) => r.title },
  Holiday: { delegate: "holiday", softDelete: false, label: (r) => r.name },
  AccountRequest: {
    delegate: "accountRequest",
    softDelete: false,
    label: (r) => `${r?.email ?? "Request"} · ${r?.requestedRole ?? ""}`.trim(),
  },
  ContractAttachment: {
    delegate: "contractAttachment",
    softDelete: false,
    label: (r) => r.name ?? "Contract attachment",
  },
  KnowledgeBaseAttachment: {
    delegate: "knowledgeBaseAttachment",
    softDelete: false,
    label: (r) => r.name ?? "KB attachment",
  },
  Counsellor: { delegate: "counsellor", softDelete: false, label: (r) => r.name },
  AgentProfile: {
    delegate: "agentProfile",
    softDelete: false,
    label: (r) => `Agent profile · tier ${r?.tier ?? "?"}`,
  },
  PartnerContact: { delegate: "partnerContact", softDelete: false, label: (r) => r.fullName },
  // `label`, not `title` — see the ITAsset note above.
  LeadChecklistItem: { delegate: "leadChecklistItem", softDelete: false, label: (r) => r.label },
  QuarterlyBusinessReview: {
    delegate: "quarterlyBusinessReview",
    softDelete: false,
    label: (r) => `QBR Q${r?.quarter ?? "?"} ${r?.year ?? "?"}`,
  },
  PerformanceReview: {
    delegate: "performanceReview",
    softDelete: false,
    label: (r) => `Performance review · ${r?.period ?? ""}`.trim(),
  },
  SuccessionPlan: {
    delegate: "successionPlan",
    softDelete: false,
    label: (r) => `Succession plan · ${r?.backupPersonnel ?? r?.readinessLevel ?? ""}`.trim(),
  },
};

export type EntityKind = keyof typeof REGISTRY;

// ── Helpers ────────────────────────────────────────────────────────────────

function delegate(kind: string): PrismaDelegate {
  const def = REGISTRY[kind];
  if (!def) throw new Error(`Recycle bin: unknown entity type "${kind}"`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const d = (db as any)[def.delegate];
  if (!d) throw new Error(`Recycle bin: no Prisma delegate for "${kind}" (${def.delegate})`);
  return d;
}

function expiresAt(now = new Date()): Date {
  return new Date(now.getTime() + RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/** Serialise Prisma types that don't survive JSON.stringify. */
function snapshotForJson(row: AnyRow): AnyRow {
  return JSON.parse(
    JSON.stringify(row, (_k, v) => {
      if (typeof v === "bigint") return v.toString();
      if (Buffer.isBuffer?.(v) || v instanceof Uint8Array) {
        return { __type: "Buffer", base64: Buffer.from(v).toString("base64") };
      }
      return v;
    })
  );
}

/** Reverse of snapshotForJson — turn markers back into their real types. */
function hydrateFromJson<T = AnyRow>(row: AnyRow): T {
  if (row && typeof row === "object") {
    for (const [k, v] of Object.entries(row)) {
      if (v && typeof v === "object" && (v as Record<string, unknown>).__type === "Buffer") {
        (row as Record<string, unknown>)[k] = Buffer.from(
          (v as { base64: string }).base64,
          "base64"
        );
      } else if (v && typeof v === "object") {
        row[k] = hydrateFromJson(v);
      }
    }
  }
  return row as T;
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface TrashOpts {
  entityType: EntityKind;
  entityId: string;
  userId: string;
}

/**
 * Send a row to the recycle bin. Returns the deleted_records row id.
 * Throws if the row doesn't exist or the entity type isn't registered.
 */
export async function trashRecord({ entityType, entityId, userId }: TrashOpts): Promise<string> {
  const def = REGISTRY[entityType];
  if (!def) throw new Error(`Recycle bin: unknown entity type "${entityType}"`);
  const d = delegate(entityType);
  const existing = await d.findUnique({ where: { id: entityId } });
  if (!existing) throw new Error(`${entityType} ${entityId} not found`);

  const label = def.label(existing);
  const parentCtx = def.parent ? await def.parent(existing) : null;

  const record = await db.deletedRecord.create({
    data: {
      entityType,
      entityId,
      entityLabel: label,
      parentType: parentCtx?.type,
      parentId: parentCtx?.id,
      parentLabel: parentCtx?.label,
      hardDeleted: !def.softDelete,
      data: def.softDelete ? null : snapshotForJson(existing),
      deletedById: userId,
      expiresAt: expiresAt(),
    },
    select: { id: true },
  });

  if (def.softDelete) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = { deletedAt: new Date() };
    // Only Attachment has deletedById in its own table; other soft-delete
    // models track "who deleted" via the deleted_records row.
    if (entityType === "Attachment") updateData.deletedById = userId;
    await d.update({ where: { id: entityId }, data: updateData });
  } else {
    // Hard-delete: the row snapshot lives in data JSON.
    await d.delete({ where: { id: entityId } });
  }

  return record.id;
}

/**
 * Bring a deleted item back. Throws if the record is already restored/purged,
 * if the entity is unknown, or if a hard-delete restore hits a conflict
 * (e.g. the target ID collision — very unlikely with uuid PKs).
 */
export async function restoreRecord(recycleId: string, userId: string): Promise<void> {
  const record = await db.deletedRecord.findUnique({ where: { id: recycleId } });
  if (!record) throw new Error("Recycle bin entry not found");
  if (record.restoredAt) throw new Error("Already restored");
  if (record.purgedAt) throw new Error("Already permanently deleted");

  const def = REGISTRY[record.entityType];
  if (!def) throw new Error(`Unknown entity type "${record.entityType}"`);
  const d = delegate(record.entityType);

  if (def.softDelete) {
    // Row is still in the DB, just marked deletedAt.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateData: any = { deletedAt: null };
    if (record.entityType === "Attachment") updateData.deletedById = null;
    await d.update({ where: { id: record.entityId }, data: updateData });
  } else {
    // Re-insert from the JSON snapshot.
    if (!record.data) throw new Error("Snapshot missing — cannot restore");
    const row = hydrateFromJson(record.data);
    // Prisma's create doesn't accept the raw row (has computed fields).
    // Strip the ones that create would reject. This is the pragmatic bit —
    // most models have `createdAt`/`updatedAt` and no other computed fields.
    // Any richer restore logic belongs on the entity's own restore hook.
    delete row.updatedAt;
    await d.create({ data: row });
  }

  await db.deletedRecord.update({
    where: { id: recycleId },
    data: { restoredAt: new Date(), restoredById: userId },
  });
}

/**
 * Immediately hard-delete an item from the bin, skipping the 60-day wait.
 * SUPER_ADMIN only in the API layer; this function assumes authorisation
 * happened upstream.
 */
export async function purgeRecord(recycleId: string): Promise<void> {
  const record = await db.deletedRecord.findUnique({ where: { id: recycleId } });
  if (!record) throw new Error("Recycle bin entry not found");
  if (record.purgedAt) return; // idempotent

  const def = REGISTRY[record.entityType];
  if (!def) throw new Error(`Unknown entity type "${record.entityType}"`);

  // Only soft-delete entities still have a row to actually delete; hard-delete
  // entities were already removed at trash time.
  if (def.softDelete && !record.restoredAt) {
    const d = delegate(record.entityType);
    await d.delete({ where: { id: record.entityId } }).catch(() => {
      // Row may already be gone (unique index, cascade, etc.) — swallow.
    });
  }

  await db.deletedRecord.update({
    where: { id: recycleId },
    data: { purgedAt: new Date() },
  });
}

/**
 * The nightly cron entry point. Walks every record past expiresAt and calls
 * purgeRecord. Returns the count for logging.
 */
export async function purgeExpired(now: Date = new Date()): Promise<number> {
  const rows = await db.deletedRecord.findMany({
    where: {
      expiresAt: { lte: now },
      restoredAt: null,
      purgedAt: null,
    },
    select: { id: true },
  });
  for (const r of rows) {
    try {
      await purgeRecord(r.id);
    } catch (err) {
      console.error(`[recycle-bin purge] ${r.id}`, err);
    }
  }
  return rows.length;
}
