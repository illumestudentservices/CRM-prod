-- 041 — Renewal countdown marker.
--
-- Institution.renewalNoticeStage records the last countdown window announced
-- for that client's renewalDate, so each notice fires once and a missed run
-- catches up the next morning rather than losing the window permanently.
--
-- ★ RUN AS THE APP ROLE, NOT postgres. See 026/040 for why.
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual/041-renewal-notice-stage.sql
--
-- Additive and nullable: every existing row keeps working, and NULL correctly
-- means "nothing announced yet", which is true.

BEGIN;

ALTER TABLE institutions ADD COLUMN IF NOT EXISTS "renewalNoticeStage" INTEGER;

-- The job scans clients by renewal date.
CREATE INDEX IF NOT EXISTS "institutions_renewalDate_idx"
  ON institutions ("renewalDate");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'institutions' AND column_name = 'renewalNoticeStage'
  ) THEN
    RAISE EXCEPTION 'renewalNoticeStage was not added';
  END IF;
END $$;

COMMIT;
