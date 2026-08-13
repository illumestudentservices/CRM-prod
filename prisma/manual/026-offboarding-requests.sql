-- Offboarding requests (2026-08-13).
--
-- The mirror of account_requests: a manager raises a departure, a Super Admin
-- reviews it, and IT revokes access by hand. Approval deliberately changes no
-- access — the business chose to keep revocation a manual act — so completedAt
-- is what records that the login has actually been disabled. Without it an
-- approved departure looks finished while the leaver can still sign in.
--
-- Purely additive: one table and two enums, no existing column touched, so
-- unlike 009 and 025 there is no backfill-then-drop ordering to get right and
-- nothing here can lose data. Safe to run before the code deploy.
--
-- Note the employee is a real FK, unlike account_requests' loose name fields —
-- there the joiner has no record yet, whereas a leaver does, so pointing at it
-- means the queue cannot drift from the staff record.
--
-- ── RUN THIS AS THE APPLICATION ROLE, NOT AS postgres ───────────────────────
--
--   psql -U illume_user -d illume_crm -v ON_ERROR_STOP=1 -f 026-...sql
--
-- Every one of the 84 existing tables is owned by the app role (illume_user in
-- production, illume_test in the mirror). CREATE TABLE assigns ownership to
-- whoever runs it, and a new role gets no privileges on another role's table —
-- so running this via `sudo -u postgres psql` produces a table the application
-- cannot read, failing at runtime with "permission denied for table
-- offboarding_requests". Worse, the table stays INVISIBLE in
-- information_schema for the app role, so a "does it exist?" check run as the
-- app answers no while the same check as postgres answers yes.
--
-- This actually happened on the mirror while writing this migration. The
-- post-conditions below now assert the ownership matches account_requests, so
-- getting it wrong aborts here instead of after deploy.

BEGIN;

-- ── 1. Enums ─────────────────────────────────────────────────────────────────

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OffboardingRequestStatus') THEN
    CREATE TYPE "OffboardingRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OffboardingReason') THEN
    CREATE TYPE "OffboardingReason" AS ENUM (
      'RESIGNATION', 'END_OF_CONTRACT', 'TERMINATION',
      'RETIREMENT', 'REDUNDANCY', 'OTHER');
  END IF;
END $$;

-- ── 2. Table ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS "offboarding_requests" (
  "id"              TEXT NOT NULL,
  "status"          "OffboardingRequestStatus" NOT NULL DEFAULT 'PENDING',
  "employeeId"      TEXT NOT NULL,
  "reason"          "OffboardingReason" NOT NULL,
  -- Their last day working, which is not necessarily when access should stop:
  -- garden leave ends it earlier, a handover can need it slightly longer.
  "lastWorkingDay"  TIMESTAMP(3) NOT NULL,
  -- Personal address for final payslips and references. Their work mailbox is
  -- about to stop existing, so anything sent there afterwards is lost.
  "forwardingEmail" TEXT,
  "notes"           TEXT NOT NULL,
  "requestedById"   TEXT NOT NULL,
  "reviewedById"    TEXT,
  "reviewedAt"      TIMESTAMP(3),
  "reviewNotes"     TEXT,
  -- Set once IT has actually revoked access. See the header.
  "completedAt"     TIMESTAMP(3),
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "offboarding_requests_pkey" PRIMARY KEY ("id")
);

-- ── 3. Foreign keys ──────────────────────────────────────────────────────────
--
-- CASCADE on employee and requester, SET NULL on reviewer, matching
-- account_requests exactly. All three are a formality in practice: employees and
-- users are soft-deleted (deletedAt) and then anonymised, never removed, because
-- nine other FKs point at users with ON DELETE RESTRICT.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'offboarding_requests_employeeId_fkey') THEN
    ALTER TABLE "offboarding_requests"
      ADD CONSTRAINT "offboarding_requests_employeeId_fkey"
      FOREIGN KEY ("employeeId") REFERENCES "employees"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'offboarding_requests_requestedById_fkey') THEN
    ALTER TABLE "offboarding_requests"
      ADD CONSTRAINT "offboarding_requests_requestedById_fkey"
      FOREIGN KEY ("requestedById") REFERENCES "users"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conname = 'offboarding_requests_reviewedById_fkey') THEN
    ALTER TABLE "offboarding_requests"
      ADD CONSTRAINT "offboarding_requests_reviewedById_fkey"
      FOREIGN KEY ("reviewedById") REFERENCES "users"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- ── 4. Indexes ───────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS "offboarding_requests_status_createdAt_idx"
  ON "offboarding_requests"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "offboarding_requests_requestedById_idx"
  ON "offboarding_requests"("requestedById");
-- Backs the "already a pending departure for this person" guard and the
-- candidate picker's `offboardingRequests: { none: ... }` filter.
CREATE INDEX IF NOT EXISTS "offboarding_requests_employeeId_idx"
  ON "offboarding_requests"("employeeId");

-- ── 5. Post-conditions ───────────────────────────────────────────────────────

DO $$
DECLARE n INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.tables
                  WHERE table_name = 'offboarding_requests') THEN
    RAISE EXCEPTION 'ABORT: offboarding_requests was not created';
  END IF;

  -- Every column the Prisma model declares must exist, or the first query after
  -- deploy fails at runtime instead of here.
  SELECT COUNT(*) INTO n FROM information_schema.columns
   WHERE table_name = 'offboarding_requests'
     AND column_name IN ('id','status','employeeId','reason','lastWorkingDay',
                         'forwardingEmail','notes','requestedById','reviewedById',
                         'reviewedAt','reviewNotes','completedAt','createdAt','updatedAt');
  IF n <> 14 THEN
    RAISE EXCEPTION 'ABORT: expected 14 columns on offboarding_requests, found %', n;
  END IF;

  SELECT COUNT(*) INTO n FROM pg_enum
   WHERE enumtypid = '"OffboardingReason"'::regtype;
  IF n <> 6 THEN RAISE EXCEPTION 'ABORT: expected 6 OffboardingReason values, found %', n; END IF;

  SELECT COUNT(*) INTO n FROM pg_constraint
   WHERE conrelid = '"offboarding_requests"'::regclass AND contype = 'f';
  IF n <> 3 THEN RAISE EXCEPTION 'ABORT: expected 3 foreign keys, found %', n; END IF;
END $$;

-- Ownership must match the rest of the schema, or the app cannot read the table.
-- See the header. account_requests is the reference because it is the closest
-- sibling and is present in every environment.
DO $$
DECLARE want TEXT; got TEXT; badenum TEXT;
BEGIN
  SELECT tableowner INTO want FROM pg_tables WHERE tablename = 'account_requests';
  SELECT tableowner INTO got   FROM pg_tables WHERE tablename = 'offboarding_requests';

  IF want IS NULL THEN
    RAISE EXCEPTION 'ABORT: account_requests missing — run migration 025 first';
  END IF;

  IF got <> want THEN
    RAISE EXCEPTION
      'ABORT: offboarding_requests is owned by "%" but every other table is owned by "%". You ran this as the wrong role — re-run it as "%". To repair in place: ALTER TABLE "offboarding_requests" OWNER TO "%"; and the same for both enum types.',
      got, want, want, want;
  END IF;

  SELECT string_agg(t.typname, ', ') INTO badenum
    FROM pg_type t
   WHERE t.typname IN ('OffboardingRequestStatus', 'OffboardingReason')
     AND pg_get_userbyid(t.typowner) <> want;
  IF badenum IS NOT NULL THEN
    RAISE EXCEPTION
      'ABORT: enum type(s) % are not owned by "%" — ALTER TYPE ... OWNER TO "%";',
      badenum, want, want;
  END IF;
END $$;

SELECT 'offboarding_requests' AS check, COUNT(*)::text AS value FROM "offboarding_requests"
UNION ALL
SELECT 'account_requests', COUNT(*)::text FROM "account_requests";

COMMIT;
