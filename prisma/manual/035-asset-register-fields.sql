-- 035 — the IT asset register's own columns
--
-- `it_assets` was built as a thin device record: name, type, serial, brand,
-- model, two dates, a status and a note. The register IT actually keeps
-- ("Global IT Equipment Inventory") carries ten more columns, and every one of
-- them is the sort of thing somebody asks about a device: where in the world it
-- is, who is holding it, what condition it is in, what came in the box with it,
-- and who last laid eyes on it.
--
-- WHY STATUS CHANGES MEANING. The old status vocabulary was
-- AVAILABLE / ASSIGNED / MAINTENANCE / RETIRED, which describes CUSTODY —
-- whether the device is out with someone. But custody is already recorded, and
-- recorded properly, by `asset_assignments` (who, from when, until when). The
-- status column was a denormalised copy of "does a row exist in that table",
-- and it left no way to say the thing the register cares about: this laptop is
-- in use, that one is a spare, this phone was stolen.
--
-- Importing the register would have made the contradiction visible on screen.
-- 63 of its 84 devices are "In Use", but almost none of the people holding them
-- have an Employee record yet, so under the old scheme every single row would
-- have displayed as AVAILABLE while the register said otherwise.
--
-- So status becomes the register's own vocabulary — its Reference Lists tab
-- gives In Use / Spare / Repair / Lost / Retired — plus the two values people
-- typed into the sheet because that list did not cover them (TEMPORARY for a
-- loaner, STOLEN, which is a materially different conversation from lost).
-- Custody stays in asset_assignments where it belongs.
--
-- Safe to do at all only because `it_assets` and `asset_assignments` are both
-- EMPTY in production (checked immediately before writing this: 0 and 0). The
-- UPDATE below exists for the mirror and for any developer database, and is a
-- no-op where there is nothing to remap.
--
-- WHY THE CUSTODIAN IS A NAME. `asset_assignments.employeeId` is a real foreign
-- key, and it should stay one. But the register names 52 people and the CRM has
-- 16 employees, so requiring an Employee row to record who holds a device would
-- mean either inventing 40 staff records or throwing away the answer to the
-- most-asked question about a laptop. `custodianName` holds the answer now; the
-- assignment table takes over as accounts are created.
--
-- COLUMN NAMES ARE camelCase, AND QUOTED. Prisma maps a field to a column of the
-- same name unless `@map` says otherwise, and this table predates any
-- snake_case convention: its existing columns are `serialNumber`,
-- `purchasedAt`, `warrantyEnd`, `createdAt`. A snake_case column here compiles,
-- migrates and indexes perfectly happily, and then every query fails with
-- "The column `(not available)` does not exist" — which names neither the
-- column nor the table. Postgres folds unquoted identifiers to lower case, so
-- the double quotes are load-bearing.
--
-- Run AS THE APP ROLE (illume_user), never as postgres — a table created or
-- altered by postgres is invisible to the app role in information_schema.
--
--   psql "$DATABASE_URL" -f prisma/manual/035-asset-register-fields.sql
--
-- Idempotent: every step is IF NOT EXISTS or guarded, so re-running is a no-op.

BEGIN;

-- ── New columns ─────────────────────────────────────────────────────────────

-- The register's "Asset ID" (e.g. UAE-001). Nullable because only the two
-- template example rows carry one — IT has not started tagging yet — and unique
-- because a tag that identifies two devices identifies neither.
ALTER TABLE it_assets ADD COLUMN IF NOT EXISTS "assetTag" TEXT;

-- Where the device is. A real FK rather than free text so this can be scoped
-- and filtered the same way every other regional thing in the app is. Nullable:
-- a device in transit or in a country we have no region for must still be
-- recordable.
ALTER TABLE it_assets ADD COLUMN IF NOT EXISTS "regionId" TEXT;
ALTER TABLE it_assets ADD COLUMN IF NOT EXISTS country TEXT;

-- Who is holding it, and in what job, by NAME. See the note above.
ALTER TABLE it_assets ADD COLUMN IF NOT EXISTS "custodianName" TEXT;
ALTER TABLE it_assets ADD COLUMN IF NOT EXISTS "custodianPosition" TEXT;

-- Excellent / Good / Fair / Poor / Damaged, per the register's Reference Lists.
-- Separate from status on purpose: a spare in excellent condition and a spare
-- that cannot be turned on are the same status and very different problems.
ALTER TABLE it_assets ADD COLUMN IF NOT EXISTS condition TEXT;

-- What came with it — "Charger, Backpack". Free text, because the register is
-- free text and the alternative is a controlled list that immediately fails on
-- "Charger - Bad" and "case (to be purchased)", both of which are real entries
-- carrying real information.
ALTER TABLE it_assets ADD COLUMN IF NOT EXISTS accessories TEXT;

-- How much of `purchasedAt` to believe. The register records a year and a
-- month, not a date, and for 18 of 84 devices not even the year. Storing
-- 2024-06-01 and rendering it as "1 June 2024" would state a day nobody knows;
-- DAY / MONTH / YEAR lets the screen say exactly as much as is known.
ALTER TABLE it_assets ADD COLUMN IF NOT EXISTS "purchasePrecision" TEXT;

-- Who last physically checked the device, and when. This is the audit half of
-- an inventory: a register nobody has verified is a list of what used to be
-- true.
ALTER TABLE it_assets ADD COLUMN IF NOT EXISTS "verifiedBy" TEXT;
ALTER TABLE it_assets ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);

-- ── Constraints and indexes ─────────────────────────────────────────────────

-- Postgres unique indexes already permit many NULLs, which is what we need
-- while most devices are untagged.
CREATE UNIQUE INDEX IF NOT EXISTS it_assets_asset_tag_key ON it_assets ("assetTag");
CREATE INDEX IF NOT EXISTS it_assets_region_id_idx ON it_assets ("regionId");
CREATE INDEX IF NOT EXISTS it_assets_status_idx ON it_assets (status);
-- The list is read whole and grouped by holder; this is the column that answers
-- "what has this person got".
CREATE INDEX IF NOT EXISTS it_assets_custodian_name_idx ON it_assets ("custodianName");

-- ON DELETE SET NULL, not CASCADE: deleting a region must never delete the
-- record of a laptop. `ADD CONSTRAINT IF NOT EXISTS` does not exist, hence the
-- guarded block.
DO $$
BEGIN
  ALTER TABLE it_assets
    ADD CONSTRAINT it_assets_region_id_fkey
    FOREIGN KEY ("regionId") REFERENCES regions(id) ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ── Status vocabulary ───────────────────────────────────────────────────────

-- SPARE is the new resting state: a device nobody is holding. The old default
-- AVAILABLE meant the same thing in the old vocabulary.
ALTER TABLE it_assets ALTER COLUMN status SET DEFAULT 'SPARE';

-- No-op on production (0 rows). Present so a mirror or a developer database
-- with old rows lands on the new vocabulary instead of keeping values the UI no
-- longer has a label for. ASSIGNED becomes IN_USE because that is what an
-- assigned device is; MAINTENANCE becomes REPAIR, the register's word.
UPDATE it_assets SET status = 'SPARE'  WHERE status = 'AVAILABLE';
UPDATE it_assets SET status = 'IN_USE' WHERE status = 'ASSIGNED';
UPDATE it_assets SET status = 'REPAIR' WHERE status = 'MAINTENANCE';

-- ── Post-conditions ─────────────────────────────────────────────────────────
--
-- Ownership is checked because a column added by the wrong role is invisible to
-- the app in information_schema, which produces two contradictory answers to
-- "does this exist" depending on who asks. Cheaper to fail here.
DO $$
DECLARE
  missing TEXT;
  wrong_owner TEXT;
BEGIN
  SELECT string_agg(c, ', ') INTO missing
  FROM unnest(ARRAY[
    'assetTag','regionId','country','custodianName','custodianPosition',
    'condition','accessories','purchasePrecision','verifiedBy','verifiedAt'
  ]) AS c
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'it_assets' AND column_name = c
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '035 did not add: %', missing;
  END IF;

  SELECT tableowner INTO wrong_owner
  FROM pg_tables WHERE tablename = 'it_assets' AND tableowner <> current_user;
  IF wrong_owner IS NOT NULL THEN
    RAISE EXCEPTION 'it_assets is owned by % but this ran as % — run migrations as the app role',
      wrong_owner, current_user;
  END IF;

  IF EXISTS (SELECT 1 FROM it_assets WHERE status IN ('AVAILABLE','ASSIGNED','MAINTENANCE')) THEN
    RAISE EXCEPTION '035 left rows on the old status vocabulary';
  END IF;
END $$;

COMMIT;
