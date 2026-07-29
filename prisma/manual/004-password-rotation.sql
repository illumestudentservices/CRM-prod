-- 90-day password rotation with reuse prevention.
--
-- The backfill is the part that matters. Two ways to get this wrong:
--
--   Leaving passwordChangedAt null and treating null as expired would force
--   every existing user into a password change the moment this ships.
--
--   Backfilling from createdAt would do the same thing to anyone whose account
--   is already older than 90 days, which is all of them.
--
-- Stamping NOW() gives everyone a full cycle from the day the policy starts,
-- which is what "rotate every 90 days" should mean on day one.

BEGIN;

ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordChangedAt" TIMESTAMP(3);

CREATE TABLE IF NOT EXISTS "password_history" (
  "id"        TEXT NOT NULL,
  "userId"    TEXT NOT NULL,
  "hash"      TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "password_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "password_history_userId_createdAt_idx"
  ON "password_history" ("userId", "createdAt");

ALTER TABLE "password_history"
  DROP CONSTRAINT IF EXISTS "password_history_userId_fkey";
ALTER TABLE "password_history"
  ADD CONSTRAINT "password_history_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- Everyone starts their first cycle today rather than already overdue.
UPDATE "users"
   SET "passwordChangedAt" = NOW()
 WHERE "passwordChangedAt" IS NULL
   AND "password" IS NOT NULL;

-- Seed each user's current password into their own history, so "you cannot
-- reuse your last 5" refuses the password they are changing away from. Without
-- this, the first rotation could legally set the same password straight back.
INSERT INTO "password_history" ("id", "userId", "hash", "createdAt")
SELECT gen_random_uuid(), u."id", u."password", COALESCE(u."passwordChangedAt", NOW())
  FROM "users" u
 WHERE u."password" IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM "password_history" h
      WHERE h."userId" = u."id" AND h."hash" = u."password"
   );

COMMIT;
