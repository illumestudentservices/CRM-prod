-- 038 — Email OTP as a per-account second factor.
--
-- Adds `MfaMethod` and five columns on `users`. Everything is ADDITIVE and every
-- default preserves today's behaviour: `mfaMethod` defaults to TOTP, so every
-- one of the existing accounts is challenged exactly as it is now and nothing
-- changes until a SUPER_ADMIN deliberately switches one account over.
--
-- WHY THIS EXISTS, AND WHAT IT COSTS. Email OTP is WEAKER than TOTP. The
-- weakness is specific and worth stating where it cannot be missed: the
-- forgot-password flow emails a reset link to the same mailbox that will now
-- receive the code, so whoever holds that inbox can reset the password AND
-- collect the second factor — two factors collapsed into one. This was put to
-- the business on 2026-09-13 and ACCEPTED KNOWINGLY, on the basis that the
-- Microsoft 365 mailbox carries its own MFA. That premise is what makes it
-- safe; if it stops being true, this stops being safe.
--
-- RUN AS THE APP ROLE, NOT postgres:
--   PGPASSWORD=... psql -h 127.0.0.1 -U illume_user -d illume_crm \
--     -v ON_ERROR_STOP=1 -f 038-email-otp-mfa.sql
--
-- Objects belong to whoever creates them and a role gets no privileges on
-- another role's objects, so running this as postgres produces a type the
-- application cannot read — and it is INVISIBLE in information_schema to the
-- app role, so "does it exist?" answers no as the app and yes as postgres. The
-- post-condition at the bottom aborts unless the new enum's owner matches the
-- owner of `users`.
--
-- ⚠ ALL IDENTIFIERS ARE camelCase AND MUST STAY QUOTED. Postgres folds unquoted
-- identifiers to lower case, and this table predates any snake_case convention.
-- An unquoted "emailOtpHash" becomes emailotphash, which migrates and indexes
-- cleanly and then fails every query with "The column `(not available)` does not
-- exist" — naming neither the column nor the table.
--
-- Idempotent: safe to re-run.

\set ON_ERROR_STOP on

-- ─── The enum ──────────────────────────────────────────────────────────────
-- Postgres has no CREATE TYPE IF NOT EXISTS, hence the exception handler.
-- Deliberately OUTSIDE the transaction below: a value added by ALTER TYPE
-- cannot be USED in the same transaction that adds it, and the column default
-- below uses one. Keeping them apart means the column work stays atomic without
-- that restriction leaking into it.
DO $$
BEGIN
  CREATE TYPE "MfaMethod" AS ENUM ('TOTP', 'EMAIL');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END
$$;

BEGIN;

-- ─── Columns ───────────────────────────────────────────────────────────────

-- The method itself. NOT NULL with a TOTP default, so existing rows are
-- backfilled to exactly what they already do rather than to a null that every
-- reader would then have to interpret.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "mfaMethod" "MfaMethod" NOT NULL DEFAULT 'TOTP';

-- The live code, bcrypt-hashed. Never stored in the clear — it is a credential
-- for the length of its life, and the same rule applies to it as to a password
-- or a backup code.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "emailOtpHash" TEXT;

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "emailOtpExpiresAt" TIMESTAMP(3);

-- Wrong guesses against the CURRENT code. Six digits is a million
-- possibilities, which is nothing over HTTP, so the code is burned after a
-- small number of attempts rather than left open to be walked through. NOT NULL
-- because a null attempt count reads as "none yet" and would reset the ceiling
-- on every row that had never been challenged.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "emailOtpAttempts" INTEGER NOT NULL DEFAULT 0;

-- Drives the resend cooldown, so the send endpoint cannot be used to flood the
-- mailbox or the mail provider.
ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "emailOtpSentAt" TIMESTAMP(3);

COMMIT;

-- ─── Post-conditions ───────────────────────────────────────────────────────
-- Every check below fails the migration loudly rather than leaving a half-
-- applied state to be discovered later by a user who cannot log in.

DO $$
DECLARE
  missing TEXT;
  enum_owner TEXT;
  table_owner TEXT;
  member_count INT;
BEGIN
  -- 1. All five columns present.
  SELECT string_agg(c, ', ') INTO missing
  FROM unnest(ARRAY[
    'mfaMethod', 'emailOtpHash', 'emailOtpExpiresAt', 'emailOtpAttempts', 'emailOtpSentAt'
  ]) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'users' AND column_name = c
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '038 failed: missing column(s): %', missing;
  END IF;

  -- 2. Both enum members present. Naming the count makes a partial type
  --    obvious instead of surfacing later as a failed insert.
  SELECT count(*) INTO member_count
  FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
  WHERE t.typname = 'MfaMethod';
  IF member_count <> 2 THEN
    RAISE EXCEPTION '038 failed: MfaMethod has % member(s), expected 2', member_count;
  END IF;

  -- 3. THE IMPORTANT ONE — the enum must belong to the same role as `users`.
  --    Run as postgres this passes every other check and then the application
  --    cannot read the type at all.
  SELECT pg_get_userbyid(t.typowner) INTO enum_owner
  FROM pg_type t WHERE t.typname = 'MfaMethod';
  SELECT tableowner INTO table_owner
  FROM pg_tables WHERE tablename = 'users';
  IF enum_owner IS DISTINCT FROM table_owner THEN
    RAISE EXCEPTION
      '038 failed: MfaMethod is owned by % but users is owned by %. Re-run as the app role, or repair with: ALTER TYPE "MfaMethod" OWNER TO %;',
      enum_owner, table_owner, table_owner;
  END IF;

  -- 4. Nobody was switched over by the migration itself. This is a schema
  --    change, not a policy change; the first EMAIL account is set by a
  --    SUPER_ADMIN in the UI, and that is an audited act by a named person.
  IF EXISTS (SELECT 1 FROM users WHERE "mfaMethod" <> 'TOTP') THEN
    RAISE EXCEPTION '038 failed: some accounts are already non-TOTP — this migration must not change anyone''s method';
  END IF;

  RAISE NOTICE '038 OK — MfaMethod owned by %, all five columns present, every account still TOTP', enum_owner;
END
$$;
