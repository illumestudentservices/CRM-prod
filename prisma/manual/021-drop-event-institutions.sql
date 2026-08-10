-- Drop the retired event_institutions flat join. EventParticipation is now
-- the sole authoritative join for institutions on events (per-institution
-- ICR / status / notes).
--
-- Preconditions verified in the deploy log before running this:
--   1. Every row of event_institutions has a matching row in event_participations
--      (same eventId + institutionId). Verified on prod: 12 in each, 0 missing.
--   2. No application code reads db.eventInstitution.* since PR #5 / #9.
--   3. The Event.institutions Prisma relation has been removed and the client
--      regenerated. That happens in the same deploy as this SQL.
--
-- Rollback: the pre-021 backup at /root/db-backups/illume_crm-pre-021-*.sql
-- restores the table with its FKs and unique constraint intact.

BEGIN;

-- Audit before dropping so the count is preserved.
INSERT INTO "audit_logs" ("id", "userId", "action", "entity", "entityId", "changes", "createdAt")
SELECT
  gen_random_uuid(),
  NULL,
  'MIGRATION_021_DROP_EVENT_INSTITUTIONS',
  'SCHEMA',
  '021',
  jsonb_build_object(
    'rowsDropped', (SELECT COUNT(*) FROM "event_institutions"),
    'participationsCount', (SELECT COUNT(*) FROM "event_participations"),
    'note', 'EventInstitution retired in favour of EventParticipation. See PR #5, #9.'
  ),
  CURRENT_TIMESTAMP;

DROP TABLE IF EXISTS "event_institutions";

COMMIT;
