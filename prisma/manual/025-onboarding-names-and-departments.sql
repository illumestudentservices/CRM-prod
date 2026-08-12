-- Employee onboarding corrections (2026-08-12).
--
-- Three changes to the account-request flow, all requested together:
--
--   1. fullName -> firstName / middleName / lastName. The form asked for one
--      free-text name, so "Nur Aisyah Binti Zulkifli" had no reliable surname
--      and IT had to guess when creating the login. firstName and lastName are
--      NOT NULL; middleName is nullable because plenty of people do not have one.
--
--   2. email -> personalEmail. The field was labelled "Work email" and even
--      placeheld an @illumestudentservices.ca address — but the work mailbox does
--      not exist yet: creating it is the whole point of the request. IT needs a
--      personal address to send the new credentials to. Renamed rather than
--      relabelled so nobody later reads `email` as the work address.
--
--   3. departments reduced to exactly Finance, Marketing, Student Recruitment
--      and Leadership, and flattened. "Headquarters" was the parent of the other
--      three; it is replaced by "Leadership", so the hierarchy is dropped rather
--      than left pointing at a deleted row.
--
-- Ordering follows 009-split-person-names: add, backfill, VERIFY, only then drop.
-- Never `prisma db push` this — push drops fullName before anything backfills it.

BEGIN;

-- ── 1. Name split ────────────────────────────────────────────────────────────

ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "firstName"  TEXT;
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "middleName" TEXT;
ALTER TABLE "account_requests" ADD COLUMN IF NOT EXISTS "lastName"   TEXT;

-- Split on whitespace: first token is the given name, last token the surname,
-- anything between becomes the middle name. Same first-space heuristic accepted
-- for leads in 009 — it misfiles surname-first names, but these rows are a
-- short-lived queue rather than a permanent record.
UPDATE "account_requests"
SET
  "firstName" = COALESCE(NULLIF(split_part(trim("fullName"), ' ', 1), ''), 'Unknown'),
  "lastName"  = CASE
                  WHEN array_length(regexp_split_to_array(trim("fullName"), '\s+'), 1) > 1
                    THEN (regexp_split_to_array(trim("fullName"), '\s+'))[
                           array_length(regexp_split_to_array(trim("fullName"), '\s+'), 1)]
                  ELSE 'Unknown'
                END,
  "middleName" = CASE
                   WHEN array_length(regexp_split_to_array(trim("fullName"), '\s+'), 1) > 2
                     THEN array_to_string(
                            (regexp_split_to_array(trim("fullName"), '\s+'))[
                              2 : array_length(regexp_split_to_array(trim("fullName"), '\s+'), 1) - 1],
                            ' ')
                   ELSE NULL
                 END
WHERE "fullName" IS NOT NULL
  AND ("firstName" IS NULL OR "lastName" IS NULL);

-- Preserve the originals before dropping the column. Same idea as the
-- LEAD_NAMES_PRE_SPLIT_SNAPSHOT row from 009: if a split misfiles a name, this
-- is the only way back.
INSERT INTO "audit_logs" ("id", "action", "entity", "entityId", "changes", "createdAt")
SELECT gen_random_uuid(), 'ACCOUNT_REQUEST_NAMES_PRE_SPLIT_SNAPSHOT', 'AccountRequest', 'bulk',
       COALESCE(jsonb_agg(jsonb_build_object('id', id, 'fullName', "fullName")), '[]'::jsonb),
       NOW()
FROM "account_requests"
HAVING COUNT(*) > 0;

-- ── 2. Verify before any destructive step ────────────────────────────────────

DO $$
DECLARE bad INT;
BEGIN
  SELECT COUNT(*) INTO bad FROM "account_requests"
   WHERE "firstName" IS NULL OR "lastName" IS NULL
      OR btrim("firstName") = '' OR btrim("lastName") = '';
  IF bad > 0 THEN
    RAISE EXCEPTION 'ABORT: % account_requests rows have no usable first/last name', bad;
  END IF;
END $$;

ALTER TABLE "account_requests" ALTER COLUMN "firstName" SET NOT NULL;
ALTER TABLE "account_requests" ALTER COLUMN "lastName"  SET NOT NULL;
ALTER TABLE "account_requests" DROP COLUMN IF EXISTS "fullName";

-- ── 3. email -> personalEmail ────────────────────────────────────────────────

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='account_requests' AND column_name='email')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='account_requests' AND column_name='personalEmail') THEN
    ALTER TABLE "account_requests" RENAME COLUMN "email" TO "personalEmail";
  END IF;
END $$;

-- ── 4. Departments: exactly four, flat ───────────────────────────────────────

INSERT INTO "departments" ("id", "name", "description", "createdAt", "updatedAt")
SELECT gen_random_uuid(), d.name, d.descr, NOW(), NOW()
FROM (VALUES
        ('Finance',             'Finance and accounts'),
        ('Marketing',           'Campaigns and digital marketing'),
        ('Student Recruitment', 'ICRs and regional managers'),
        ('Leadership',          'Executive leadership team')
     ) AS d(name, descr)
WHERE NOT EXISTS (SELECT 1 FROM "departments" x WHERE x."name" = d.name);

-- Flatten: "Headquarters" was the parent of the others and is going away, so a
-- surviving parentId would dangle.
UPDATE "departments" SET "parentId" = NULL WHERE "parentId" IS NOT NULL;

-- Move anyone attached to a department that is being removed onto Leadership,
-- rather than letting the delete fail or silently orphan them.
UPDATE "employees" e
   SET "departmentId" = (SELECT id FROM "departments" WHERE "name" = 'Leadership')
 WHERE e."departmentId" IN (
         SELECT id FROM "departments"
          WHERE "name" NOT IN ('Finance','Marketing','Student Recruitment','Leadership'));

UPDATE "account_requests" ar
   SET "departmentId" = (SELECT id FROM "departments" WHERE "name" = 'Leadership')
 WHERE ar."departmentId" IN (
         SELECT id FROM "departments"
          WHERE "name" NOT IN ('Finance','Marketing','Student Recruitment','Leadership'));

DELETE FROM "departments"
 WHERE "name" NOT IN ('Finance','Marketing','Student Recruitment','Leadership');

-- ── 5. Post-conditions ──────────────────────────────────────────────────────

DO $$
DECLARE n INT;
BEGIN
  SELECT COUNT(*) INTO n FROM "departments";
  IF n <> 4 THEN RAISE EXCEPTION 'ABORT: expected 4 departments, found %', n; END IF;

  SELECT COUNT(*) INTO n FROM "departments"
   WHERE "name" IN ('Finance','Marketing','Student Recruitment','Leadership');
  IF n <> 4 THEN RAISE EXCEPTION 'ABORT: the four expected departments are not all present'; END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='account_requests' AND column_name='fullName') THEN
    RAISE EXCEPTION 'ABORT: account_requests.fullName still exists';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_name='account_requests' AND column_name='personalEmail') THEN
    RAISE EXCEPTION 'ABORT: account_requests.personalEmail missing';
  END IF;
END $$;

SELECT 'departments' AS check, string_agg("name", ', ' ORDER BY "name") AS value FROM "departments"
UNION ALL
SELECT 'account_requests', COUNT(*)::text FROM "account_requests";

COMMIT;
