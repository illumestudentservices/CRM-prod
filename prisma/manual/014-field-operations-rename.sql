-- Phase 3 — Field Operations rename.
--
-- Pure Prisma-model rename: `Activity` → `FieldOperation` in code, DB table
-- stays `activities` via @@map. That means no DDL is required in this SQL
-- file — it exists only as a marker so the manual-migration sequence stays
-- contiguous (a missing 014 would look like a gap when auditing).
--
-- The actual work of Phase 3 lives in:
--   * schema.prisma — the model comment noting the deferred rename
--   * a codebase-wide symbol replacement (Activity → FieldOperation) that
--     ships as its own PR once every consumer has been reviewed
--   * the route rename from `/activities` to `/field-operations`, with a
--     Next.js redirect on the old URL for 30 days
--
-- If you're reading this and expecting DDL, there isn't any. Skipping straight
-- to migration 015 is safe.

BEGIN;

INSERT INTO "audit_logs" ("id", "userId", "action", "entity", "entityId", "changes", "createdAt")
VALUES (
  gen_random_uuid(),
  NULL,
  'FIELD_OPERATIONS_RENAME_MARKER',
  'System',
  '014-field-operations-rename',
  '{"note": "no-op DDL; rename ships in a code-only PR"}'::jsonb,
  NOW()
);

COMMIT;
