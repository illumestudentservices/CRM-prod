-- 040 — Advance notice for public holidays.
--
-- Adds holiday_reminders: one row per holiday per notice sent, so a second run
-- of the cron on the same day cannot email a whole region twice.
--
-- ★ RUN AS THE APP ROLE, NOT postgres. Every table here is owned by the app
-- role, and a table created by postgres is not merely unreadable by the app —
-- it is INVISIBLE to it in information_schema, so an "does it exist?" check
-- answers no while the same check as postgres answers yes.
--
--   PGPASSWORD=... psql -h 127.0.0.1 -U illume_user -d illume_crm \
--     -v ON_ERROR_STOP=1 -f prisma/manual/040-holiday-reminders.sql
--
-- Code-only otherwise: no existing row is read or written.

BEGIN;

CREATE TABLE IF NOT EXISTS holiday_reminders (
  id          TEXT PRIMARY KEY,
  "holidayId" TEXT NOT NULL REFERENCES holidays(id) ON DELETE CASCADE,
  -- The holiday date the notice announced. Part of the unique key so that
  -- correcting a holiday's date lets the notice legitimately go out again.
  "forDate"   DATE NOT NULL,
  -- Zero is a real outcome: it means the region has no members. Recording it
  -- is what makes "nobody was told" visible instead of silent.
  "sentCount" INTEGER NOT NULL DEFAULT 0,
  "sentAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The guarantee. Without this the table is just a log; with it, a duplicate
-- broadcast is impossible rather than merely unlikely.
CREATE UNIQUE INDEX IF NOT EXISTS "holiday_reminders_holidayId_forDate_key"
  ON holiday_reminders ("holidayId", "forDate");

-- The job scans holidays by date every morning.
CREATE INDEX IF NOT EXISTS "holidays_date_idx" ON holidays (date);

-- ── Post-condition ──────────────────────────────────────────────────────────
-- Aborts unless the new table is owned by the same role as holidays. Copied
-- from migration 026 after a table created by the wrong role cost real time.
DO $$
DECLARE
  want TEXT;
  got  TEXT;
BEGIN
  SELECT tableowner INTO want FROM pg_tables WHERE tablename = 'holidays';
  SELECT tableowner INTO got  FROM pg_tables WHERE tablename = 'holiday_reminders';
  IF want IS NULL THEN
    RAISE EXCEPTION 'holidays table not found — wrong database?';
  END IF;
  IF got IS DISTINCT FROM want THEN
    RAISE EXCEPTION
      'holiday_reminders is owned by % but holidays is owned by % — rerun as the app role, then: ALTER TABLE holiday_reminders OWNER TO %;',
      got, want, want;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE tablename = 'holiday_reminders'
      AND indexname = 'holiday_reminders_holidayId_forDate_key'
  ) THEN
    RAISE EXCEPTION 'the unique index is missing — duplicate broadcasts would be possible';
  END IF;
END $$;

COMMIT;
