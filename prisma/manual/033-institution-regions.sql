-- 033 — Clients can be worked in more than one region
--
-- `institutions.regionId` holds ONE region and stays as the primary: the
-- dashboard geo filter, analytics and reporting all read it. But a client is
-- rarely worked in one region — of the 39 in the first client list, 24 span
-- several and one spans all six — so storing only the primary threw the rest
-- away silently.
--
-- Adds the join table, and the two regions the client list needs that the CRM
-- did not have: East Asia (the sheet's "China") and Latin America ("LATAM").
-- Without them the two LATAM-only clients would import with no region at all.
--
-- Purely additive: no existing column changes, nothing is dropped, and every
-- existing institution keeps the regionId it already had.
--
-- Run AS THE APP ROLE (illume_user), never as postgres — a table created by
-- postgres is not writable by the application.
--
--   psql "$DATABASE_URL" -f prisma/manual/033-institution-regions.sql
--
-- Idempotent: re-running is a no-op.

BEGIN;

-- ── The join table ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "institution_regions" (
    "id"            TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "regionId"      TEXT NOT NULL,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "institution_regions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "institution_regions_regionId_idx"
  ON "institution_regions"("regionId");

-- One row per pairing: re-importing a client must not duplicate its regions.
CREATE UNIQUE INDEX IF NOT EXISTS "institution_regions_institutionId_regionId_key"
  ON "institution_regions"("institutionId", "regionId");

-- PostgreSQL has no ADD CONSTRAINT IF NOT EXISTS, hence the catch.
DO $$ BEGIN
  ALTER TABLE "institution_regions"
    ADD CONSTRAINT "institution_regions_institutionId_fkey"
    FOREIGN KEY ("institutionId") REFERENCES "institutions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "institution_regions"
    ADD CONSTRAINT "institution_regions_regionId_fkey"
    FOREIGN KEY ("regionId") REFERENCES "regions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── The two missing regions ────────────────────────────────────────────────
--
-- Named geographically, to sit alongside the existing Africa / Europe /
-- Middle East / South Asia / Southeast Asia rather than beside them in a
-- different naming style. The client list's "China" and "LATAM" map onto these.
--
-- gen_random_uuid() is pgcrypto/PG13+; the existing ids are UUIDs so this keeps
-- the column consistent.
INSERT INTO "regions" ("id", "name", "code", "description", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'East Asia', 'EA',
       'China, Hong Kong, Taiwan, Japan, Korea. Added for the client list, whose "China" column had no home.',
       NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "regions" WHERE "name" = 'East Asia' OR "code" = 'EA');

INSERT INTO "regions" ("id", "name", "code", "description", "createdAt", "updatedAt")
SELECT gen_random_uuid(), 'Latin America', 'LATAM',
       'Mexico, Central and South America. Added for the client list, whose "LATAM" column had no home.',
       NOW(), NOW()
WHERE NOT EXISTS (SELECT 1 FROM "regions" WHERE "name" = 'Latin America' OR "code" = 'LATAM');

-- ── Post-conditions ────────────────────────────────────────────────────────
DO $$
DECLARE region_count INT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'institution_regions'
  ) THEN
    RAISE EXCEPTION '033: institution_regions was not created';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'institution_regions'
      AND indexname = 'institution_regions_institutionId_regionId_key'
  ) THEN
    RAISE EXCEPTION '033: the (institutionId, regionId) unique index is missing — re-import would duplicate';
  END IF;

  SELECT COUNT(*) INTO region_count FROM "regions";
  IF region_count < 7 THEN
    RAISE EXCEPTION '033: expected at least 7 regions after insert, found %', region_count;
  END IF;

  -- The primary region column must survive untouched: everything that reads it
  -- keeps working, and this migration only adds beside it.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'institutions' AND column_name = 'regionId'
  ) THEN
    RAISE EXCEPTION '033: institutions.regionId is missing — it must be kept as the primary';
  END IF;
END $$;

COMMIT;
