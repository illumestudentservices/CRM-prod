-- 039 — Count failed second-factor attempts, and stop accepting them forever.
--
-- `/api/auth/2fa/verify` had NO attempt limiting of any kind. Migration 038 put
-- a ceiling on the EMAILED code only; an authenticator code and a backup code
-- could both still be guessed without limit by anyone holding the password.
-- A six-digit TOTP is a million possibilities and a backup code is eleven
-- characters, and neither is much protection against a script that may try as
-- often as it likes.
--
-- Two columns, both additive, both defaulting to today's behaviour: every
-- existing account starts at zero attempts and unlocked.
--
-- DELIBERATELY SEPARATE FROM `loginAttempts` / `lockedUntil`, which guard the
-- password. The thresholds have to differ — a TOTP code rotates every 30
-- seconds, so a few misses is ordinary for a drifting phone clock, and the
-- password's 5-strikes/30-minute rule would lock out honest people. Keeping
-- them apart also leaves "wrong password" and "wrong code" separately countable.
--
-- RUN AS THE APP ROLE, NOT postgres:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f 039-mfa-attempt-limit.sql
--
-- ⚠ camelCase identifiers MUST STAY QUOTED. Postgres folds unquoted identifiers
-- to lower case; "mfaAttempts" unquoted becomes mfaattempts, which migrates and
-- indexes cleanly and then fails every query with "The column `(not available)`
-- does not exist", naming neither the column nor the table.
--
-- Idempotent: safe to re-run.

\set ON_ERROR_STOP on

BEGIN;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "mfaAttempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "mfaLockedUntil" TIMESTAMP(3);

COMMIT;

-- ─── Post-conditions ───────────────────────────────────────────────────────

DO $$
DECLARE
  missing TEXT;
  locked INT;
BEGIN
  SELECT string_agg(c, ', ') INTO missing
  FROM unnest(ARRAY['mfaAttempts', 'mfaLockedUntil']) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = c
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '039 failed: missing column(s): %', missing;
  END IF;

  -- Nobody may be locked out by the act of adding the column. This is a schema
  -- change; the first lock must come from a real failed attempt.
  SELECT count(*) INTO locked FROM users WHERE "mfaLockedUntil" IS NOT NULL;
  IF locked > 0 THEN
    RAISE EXCEPTION '039 failed: % account(s) came out of the migration locked', locked;
  END IF;

  RAISE NOTICE '039 OK — both columns present, 0 accounts locked';
END
$$;
