-- Split person names into firstName + lastName, for leads and users only.
--
-- Run this INSTEAD OF `prisma db push` for this change, not after it. Push
-- would see `fullName` gone from the schema and drop the column before
-- anything had been read out of it, taking all 52 names with it.
--
-- Scope is deliberate: `account_requests.fullName`, `institutions.primaryContact`,
-- `sources.contactPerson`, `employees.emergencyContact`, `institution_contacts.name`,
-- `counsellors.name` and `activity_attendees.name` all keep their single field.
-- They are not the people this system tracks as people.
--
-- ── The split is a guess, and known to be wrong in places ───────────────────
--
-- Names are divided on the FIRST SPACE. About a third of the existing lead
-- names are not two words, and for several the guess records the wrong part as
-- the family name:
--
--   "Chen Xiao Ming"             Chinese  — Chen is the family name, and leads
--   "Tran Thi Mai"               Vietnamese — Tran likewise
--   "Nur Aisyah Binti Zulkifli"  Malay — "Binti" means "daughter of"
--   "Omar Bin Rashid"            Arabic patronymic
--   "Dr. Mei Ling"               carries a title
--
-- This was chosen knowingly over a review queue. What makes it recoverable is
-- step 1: every original string is written to an audit row BEFORE any of it is
-- overwritten, so a name corrected later is corrected against the record rather
-- than someone's memory. Do not reorder the steps.

BEGIN;

-- ── 1. Record the originals, before anything is destroyed ──────────────────
-- One row holding every lead's id and original name. Written first so that a
-- failure anywhere below still leaves the source of truth captured, and so a
-- misfiled name can be traced back years from now.
INSERT INTO "audit_logs" ("id", "userId", "action", "entity", "entityId", "changes", "createdAt")
SELECT
  gen_random_uuid(),
  NULL,                          -- a migration, not a person
  'LEAD_NAMES_PRE_SPLIT_SNAPSHOT',
  'Lead',
  'ALL',
  jsonb_build_object(
    'note', 'Original fullName values captured before the first-space split. Authoritative source for correcting a name the split got wrong.',
    'count', (SELECT COUNT(*) FROM "leads"),
    'names', (SELECT jsonb_agg(jsonb_build_object('id', l."id", 'fullName', l."fullName") ORDER BY l."createdAt")
              FROM "leads" l)
  ),
  NOW()
WHERE EXISTS (SELECT 1 FROM "leads");

-- ── 2. Add the columns, nullable for now ───────────────────────────────────
-- The schema declares leads.firstName/lastName NOT NULL. They cannot be added
-- that way against a non-empty table, so the constraint goes on in step 4 once
-- every row has a value.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "firstName" TEXT;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "lastName"  TEXT;

-- Nullable on users by design, matching the schema: NextAuth can create an
-- account through a provider that supplies no name at all.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "firstName" TEXT;
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "lastName"  TEXT;

-- ── 3. Backfill ────────────────────────────────────────────────────────────
-- Whitespace is collapsed first so that a double space or a stray tab does not
-- produce an empty firstName and shift the whole name into lastName.
UPDATE "leads"
SET "firstName" = SPLIT_PART(BTRIM(REGEXP_REPLACE("fullName", '\s+', ' ', 'g')), ' ', 1),
    "lastName"  = BTRIM(SUBSTRING(
                    BTRIM(REGEXP_REPLACE("fullName", '\s+', ' ', 'g'))
                    FROM POSITION(' ' IN BTRIM(REGEXP_REPLACE("fullName", '\s+', ' ', 'g')) || ' ') + 1
                  ))
WHERE "firstName" IS NULL;

-- A one-word name yields an empty lastName rather than a null: the column is
-- NOT NULL, and "unknown family name" and "no family name given" are not worth
-- distinguishing here.
UPDATE "leads" SET "firstName" = '' WHERE "firstName" IS NULL;
UPDATE "leads" SET "lastName"  = '' WHERE "lastName"  IS NULL;

-- Users are split the same way. `name` stays as it is — it is the derived
-- display value NextAuth's adapter contract requires, and it already holds
-- exactly what first + last recombine to.
UPDATE "users"
SET "firstName" = SPLIT_PART(BTRIM(REGEXP_REPLACE("name", '\s+', ' ', 'g')), ' ', 1),
    "lastName"  = NULLIF(BTRIM(SUBSTRING(
                    BTRIM(REGEXP_REPLACE("name", '\s+', ' ', 'g'))
                    FROM POSITION(' ' IN BTRIM(REGEXP_REPLACE("name", '\s+', ' ', 'g')) || ' ') + 1
                  )), '')
WHERE "name" IS NOT NULL
  AND BTRIM("name") <> ''
  AND "firstName" IS NULL;

-- Purged accounts are tombstones. Leaving them split as First="Deleted",
-- Last="user" would have the purge look like it had anonymised someone named
-- Deleted User rather than cleared the field.
UPDATE "users"
SET "firstName" = NULL, "lastName" = NULL
WHERE "purgedAt" IS NOT NULL;

-- ── 4. Verify, then enforce ────────────────────────────────────────────────
-- Aborts the whole transaction if any lead came out of the backfill without a
-- name. Better to fail here than to reach step 5 and drop the only copy.
DO $$
DECLARE
  unfilled INT;
  blank    INT;
BEGIN
  SELECT COUNT(*) INTO unfilled FROM "leads" WHERE "firstName" IS NULL OR "lastName" IS NULL;
  IF unfilled > 0 THEN
    RAISE EXCEPTION 'Backfill incomplete: % lead(s) still have a null name part. Nothing dropped.', unfilled;
  END IF;

  SELECT COUNT(*) INTO blank FROM "leads" WHERE BTRIM("firstName") = '' AND BTRIM("lastName") = '';
  IF blank > 0 THEN
    RAISE EXCEPTION 'Backfill produced % lead(s) with no name at all. Nothing dropped.', blank;
  END IF;
END $$;

ALTER TABLE "leads" ALTER COLUMN "firstName" SET NOT NULL;
ALTER TABLE "leads" ALTER COLUMN "lastName"  SET NOT NULL;

-- The list view sorts family name then given name; without this that is a sort
-- of the whole table on every page of results.
CREATE INDEX IF NOT EXISTS "leads_lastName_firstName_idx"
  ON "leads" ("lastName", "firstName");

-- ── 5. Drop the old column ─────────────────────────────────────────────────
-- Reached only if step 4 raised nothing. The originals remain readable in the
-- audit row from step 1.
ALTER TABLE "leads" DROP COLUMN IF EXISTS "fullName";

COMMIT;
