-- 034 — East Asia becomes China
--
-- Migration 033 created "East Asia" as the home for the client list's China
-- column, named geographically to sit alongside Africa / Europe / Middle East /
-- South Asia / Southeast Asia. The business calls it China, the source
-- spreadsheet calls it China, and every one of its rows arrived from a column
-- headed China — so the geographic naming was consistency for its own sake at
-- the cost of matching what people actually say.
--
-- A RENAME, not a second region. Adding "China" beside "East Asia" would have
-- left the 11 existing clients filed under East Asia — which is where their
-- China ticks landed — and created an empty China next to it. One idea, two
-- rows, and the populated one is the one nobody would look in.
--
-- No data moves. Every reference is by regions.id, so the 11 institution_regions
-- rows and the 2 institutions whose primary region this is follow automatically.
-- Verified before writing this: no users and no leads reference it.
--
-- Run AS THE APP ROLE (illume_user), never as postgres.
--
--   psql "$DATABASE_URL" -f prisma/manual/034-rename-east-asia-to-china.sql
--
-- Idempotent: re-running is a no-op, and it is safe on a database where 033 has
-- run but the region was already renamed by hand.

BEGIN;

-- Guard: if a separate "China" already exists, renaming would collide with the
-- unique index on name. Stop rather than half-apply.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "regions" WHERE "name" = 'China')
     AND EXISTS (SELECT 1 FROM "regions" WHERE "name" = 'East Asia') THEN
    RAISE EXCEPTION
      '034: both "China" and "East Asia" exist. Merge them by hand — this migration will not guess which rows belong where.';
  END IF;
END $$;

UPDATE "regions"
   SET "name" = 'China',
       "code" = 'CN',
       "description" = 'Mainland China, Hong Kong and Taiwan. Renamed from "East Asia" — the client list and the business both call it China.',
       "updatedAt" = NOW()
 WHERE "name" = 'East Asia';

-- ── Post-conditions ────────────────────────────────────────────────────────
DO $$
DECLARE linked INT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "regions" WHERE "name" = 'China' AND "code" = 'CN') THEN
    RAISE EXCEPTION '034: no region named China after the rename';
  END IF;

  IF EXISTS (SELECT 1 FROM "regions" WHERE "name" = 'East Asia') THEN
    RAISE EXCEPTION '034: East Asia still exists — the rename did not take';
  END IF;

  -- The clients that were on East Asia must still be attached. If this is zero
  -- on a database that had them, something detached them rather than renaming.
  SELECT COUNT(*) INTO linked
    FROM "institution_regions" ir
    JOIN "regions" r ON r.id = ir."regionId"
   WHERE r."name" = 'China';
  RAISE NOTICE '034: % client links now sit under China', linked;
END $$;

COMMIT;
