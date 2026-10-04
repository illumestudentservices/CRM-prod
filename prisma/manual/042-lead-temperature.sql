-- 042 — Lead temperature.
--
-- A three-value judgement (Hot / Warm / Cold) the ICR records after speaking to
-- a student. Required by the New Lead gate before a student may move to
-- Contacted; NOT required at capture.
--
-- ★ RUN AS THE APP ROLE, NOT postgres. Every table and type here is owned by
-- the app role, and an object created by postgres is not merely unreadable by
-- the app — it is INVISIBLE to it in information_schema, so an "does it exist?"
-- check answers no while the same check as postgres answers yes. See 026/040.
--
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual/042-lead-temperature.sql
--
-- Additive and nullable. No existing row is read or written, and NULL correctly
-- means "nobody has judged this student yet", which is true of every lead that
-- predates this column.

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'LeadTemperature') THEN
    CREATE TYPE "LeadTemperature" AS ENUM ('HOT', 'WARM', 'COLD');
  END IF;
END $$;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS "leadTemperature" "LeadTemperature";

-- ── Post-conditions ─────────────────────────────────────────────────────────
-- Aborts unless the new type is owned by the same role as the table it is used
-- on. Copied from 026 after a type created by the wrong role cost real time.
DO $$
DECLARE
  want TEXT;
  got  TEXT;
BEGIN
  SELECT tableowner INTO want FROM pg_tables WHERE tablename = 'leads';
  SELECT pg_get_userbyid(typowner) INTO got FROM pg_type WHERE typname = 'LeadTemperature';

  IF want IS NULL THEN
    RAISE EXCEPTION 'leads table not found — wrong database?';
  END IF;
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION
      'type LeadTemperature is owned by % but leads is owned by % — rerun as the app role, then: ALTER TYPE "LeadTemperature" OWNER TO %;',
      got, want, want;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'leads' AND column_name = 'leadTemperature'
  ) THEN
    RAISE EXCEPTION 'leads."leadTemperature" was not added';
  END IF;
END $$;

COMMIT;
