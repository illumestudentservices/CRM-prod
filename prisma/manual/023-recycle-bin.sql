-- Recycle bin (Phase 9). Every deletion in the app now goes through
-- lib/recycle-bin.ts, which writes a row to deleted_records BEFORE either
-- soft-marking the original row (for models that already have deletedAt) or
-- snapshotting-and-hard-deleting it. A 60-day cron purges anything past
-- expiresAt.
--
-- Design decisions:
--   * Single index table so /recycle-bin can list everything from one query.
--   * data JSONB holds the full row snapshot for hard-delete entities so
--     restore can re-INSERT them. Soft-delete entities leave the row in place
--     and don't need data — the FK to the surviving row is entityId.
--   * expiresAt is materialised (deletedAt + interval '60 days') and indexed
--     so the purge cron is a single-index scan.
--   * restoredAt / purgedAt are set instead of deleting the record, so
--     admins can see the historical activity in the audit-log-like view.

BEGIN;

CREATE TABLE IF NOT EXISTS "deleted_records" (
  "id"           TEXT PRIMARY KEY,
  "entityType"   TEXT NOT NULL,
  "entityId"     TEXT NOT NULL,
  "entityLabel"  TEXT NOT NULL,
  "parentType"   TEXT,
  "parentId"     TEXT,
  "parentLabel"  TEXT,
  "hardDeleted"  BOOLEAN NOT NULL,
  "data"         JSONB,
  "deletedById"  TEXT,
  "deletedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"    TIMESTAMP(3) NOT NULL,
  "restoredAt"   TIMESTAMP(3),
  "restoredById" TEXT,
  "purgedAt"     TIMESTAMP(3)
);

DO $$ BEGIN
  ALTER TABLE "deleted_records"
    ADD CONSTRAINT "deleted_records_deletedById_fkey"
    FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "deleted_records"
    ADD CONSTRAINT "deleted_records_restoredById_fkey"
    FOREIGN KEY ("restoredById") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The purge cron scans deleted_records where the item is still pending
-- (not yet restored or purged) and past its expiresAt. Partial index
-- keeps it lean.
CREATE INDEX IF NOT EXISTS "deleted_records_pending_expiry_idx"
  ON "deleted_records" ("expiresAt")
  WHERE "restoredAt" IS NULL AND "purgedAt" IS NULL;

CREATE INDEX IF NOT EXISTS "deleted_records_entity_idx"
  ON "deleted_records" ("entityType", "entityId");

CREATE INDEX IF NOT EXISTS "deleted_records_deletedBy_idx"
  ON "deleted_records" ("deletedById");

CREATE INDEX IF NOT EXISTS "deleted_records_deletedAt_desc_idx"
  ON "deleted_records" ("deletedAt" DESC);

-- Attachments become soft-deletable. The BYTEA content stays in the row
-- until the 60-day purge. Existing rows have deletedAt NULL, so they're
-- treated as active.
ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "deletedAt" TIMESTAMP(3);
ALTER TABLE "attachments" ADD COLUMN IF NOT EXISTS "deletedById" TEXT;

DO $$ BEGIN
  ALTER TABLE "attachments"
    ADD CONSTRAINT "attachments_deletedById_fkey"
    FOREIGN KEY ("deletedById") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Partial index so listing active attachments stays fast.
CREATE INDEX IF NOT EXISTS "attachments_active_idx"
  ON "attachments" ("parentType", "parentId")
  WHERE "deletedAt" IS NULL;

INSERT INTO "audit_logs" ("id", "userId", "action", "entity", "entityId", "changes", "createdAt")
VALUES (
  gen_random_uuid(),
  NULL,
  'MIGRATION_023_RECYCLE_BIN',
  'SCHEMA',
  '023',
  jsonb_build_object(
    'tableAdded', 'deleted_records',
    'columnsAdded', jsonb_build_object(
      'attachments', ARRAY['deletedAt', 'deletedById']
    ),
    'retentionDays', 60,
    'note', 'Every DELETE endpoint now routes through lib/recycle-bin.trashRecord(). Purge cron runs daily at 03:00 UTC.'
  ),
  CURRENT_TIMESTAMP
);

COMMIT;
