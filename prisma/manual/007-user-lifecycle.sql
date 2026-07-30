-- Immediate session revocation and a 30-day recovery window for deleted users.
--
-- Purely additive: two nullable columns. Nothing to back-fill.
--
-- sessionsRevokedAt is left NULL for everyone, which the session check reads as
-- "nothing revoked" — so no existing session is disturbed by this deploy.

BEGIN;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "sessionsRevokedAt" TIMESTAMP(3);
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "purgedAt" TIMESTAMP(3);

-- The purge job scans for expired soft-deletes on a schedule; without this it
-- is a sequential scan of the whole users table on every run.
CREATE INDEX IF NOT EXISTS "users_deletedAt_purgedAt_idx"
  ON "users" ("deletedAt", "purgedAt");

COMMIT;
