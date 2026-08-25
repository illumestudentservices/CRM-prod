-- 036 — email addresses stop being case-sensitive
--
-- `lib/auth.ts` looked a user up with `findUnique({ where: { email } })` on the
-- string exactly as typed. Postgres compares `text` case-sensitively, so an
-- account stored as "Ashley-Jane@illumestudentservices.ca" could only be logged
-- into by typing that capitalisation. Anyone typing their own address in
-- lowercase — which is how every mail client displays it, and how anyone would
-- naturally type it — got "Invalid email or password".
--
-- It presented as two unrelated faults, which is why it survived: the password
-- appeared to be wrong, and two-factor setup appeared to be missing. Both were
-- the same thing. The lookup failed before the password was ever compared, so
-- `loginAttempts` stayed at 0 — no lockout, no audit row, nothing to find. And
-- MFA enrolment lives behind a successful password check, so it never appeared.
-- Proven on production against a disposable mixed-case account: exact case
-- reached /setup-2fa, lowercase was refused.
--
-- Four live accounts were affected: ALan@, Yetunde@, Mike@ and Ashley-Jane@.
--
-- WHY A UNIQUE INDEX AND NOT JUST A CODE CHANGE. Making the lookup
-- case-insensitive without this would be a security regression, not a fix: if
-- "Mike@example.com" and "mike@example.com" both existed, a case-insensitive
-- `findFirst` would authenticate against whichever row Postgres happened to
-- return. The index makes two case-variants impossible, so the lookup is
-- unambiguous by construction rather than by luck.
--
-- Verified before writing: 0 groups of addresses differing only by case, so the
-- backfill cannot collide. The index is created AFTER the backfill for the same
-- reason.
--
-- Run AS THE APP ROLE (illume_user), never as postgres.
--
--   psql "$DATABASE_URL" -f prisma/manual/036-email-case-insensitive.sql
--
-- Idempotent: the backfill is a no-op once addresses are lowercase, and the
-- index is IF NOT EXISTS.

BEGIN;

-- ── Guard ───────────────────────────────────────────────────────────────────
--
-- Abort rather than half-apply if two accounts differ only by case. Lowercasing
-- one would violate the existing unique constraint on `email` and, worse, doing
-- it in some other order would silently merge two identities.
DO $$
DECLARE
  clash TEXT;
BEGIN
  SELECT string_agg(DISTINCT lower(email), ', ') INTO clash
  FROM users
  GROUP BY lower(email)
  HAVING count(*) > 1;

  IF clash IS NOT NULL THEN
    RAISE EXCEPTION
      '036 aborted: these addresses exist in more than one capitalisation and must be resolved by hand first: %',
      clash;
  END IF;
END $$;

-- ── Backfill ────────────────────────────────────────────────────────────────
--
-- Addresses become lowercase so that what is stored matches what people type.
-- The local part of an address is technically case-sensitive per RFC 5321, but
-- no mail provider in practice treats it that way, and a login form that does is
-- indistinguishable from a broken password.
UPDATE users SET email = lower(email) WHERE email <> lower(email);

-- Everywhere else an address is stored, for the same reason. Both are compared
-- against `users.email` when checking for duplicates.
UPDATE account_requests SET "personalEmail" = lower("personalEmail")
  WHERE "personalEmail" <> lower("personalEmail");

-- ── Constraint ──────────────────────────────────────────────────────────────
--
-- The functional unique index that makes case-insensitive lookup safe. The
-- existing `users_email_key` stays: it costs nothing and still catches an exact
-- duplicate slightly earlier.
CREATE UNIQUE INDEX IF NOT EXISTS users_email_lower_key ON users (lower(email));

-- ── Post-conditions ─────────────────────────────────────────────────────────
DO $$
DECLARE
  remaining INT;
  wrong_owner TEXT;
BEGIN
  SELECT count(*) INTO remaining FROM users WHERE email <> lower(email);
  IF remaining > 0 THEN
    RAISE EXCEPTION '036 left % user address(es) in mixed case', remaining;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'users' AND indexname = 'users_email_lower_key'
  ) THEN
    RAISE EXCEPTION '036 did not create users_email_lower_key';
  END IF;

  -- An object created by the wrong role is invisible to the app in
  -- information_schema, which gives two contradictory answers to "does this
  -- exist" depending on who asks.
  SELECT tableowner INTO wrong_owner
  FROM pg_tables WHERE tablename = 'users' AND tableowner <> current_user;
  IF wrong_owner IS NOT NULL THEN
    RAISE EXCEPTION 'users is owned by % but this ran as % — run migrations as the app role',
      wrong_owner, current_user;
  END IF;
END $$;

COMMIT;
