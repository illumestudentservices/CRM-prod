-- Mark logins that are not people.
--
-- Additive and defaulted false, so every existing account keeps its current
-- meaning and nothing needs back-filling.

BEGIN;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "isServiceAccount" BOOLEAN NOT NULL DEFAULT false;

COMMIT;
