-- Spec §9 (Recruitment Events) — measurable objectives per event.
--
-- Purely additive. Idempotent. No data touch.

ALTER TABLE "events"
  ADD COLUMN IF NOT EXISTS "objectives" JSONB;

INSERT INTO "audit_logs" ("id", "userId", "action", "entity", "entityId", "changes", "createdAt")
VALUES (
  gen_random_uuid(),
  NULL,
  'MIGRATION_020_EVENT_OBJECTIVES',
  'SCHEMA',
  '020',
  jsonb_build_object('columnAdded', 'events.objectives (JSONB)'),
  CURRENT_TIMESTAMP
);
