-- 032 — Monthly KPI section on the ICR Monthly Report
--
-- Adds one nullable JSONB column holding the §8 Monthly KPI snapshot: the six
-- mandatory activities from the "Illume KPIs — Weekly Activity Planner" rolled
-- up from the four weeks of the reporting month.
--
-- Purely additive and nullable, so existing reports are untouched and simply
-- carry NULL until they are refreshed. No data is moved and nothing is dropped.
--
-- Run AS THE APP ROLE (illume_user), never as postgres — a table or column
-- created by postgres is not writable by the application.
--
--   psql "$DATABASE_URL" -f prisma/manual/032-icr-monthly-kpi.sql
--
-- Idempotent: re-running is a no-op.

BEGIN;

-- ADD COLUMN IF NOT EXISTS is supported from PostgreSQL 9.6 and is the whole
-- migration, so no DO block is needed here.
ALTER TABLE "icr_monthly_reports"
  ADD COLUMN IF NOT EXISTS "monthlyKpi" JSONB;

-- ── Post-conditions ────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'icr_monthly_reports' AND column_name = 'monthlyKpi'
  ) THEN
    RAISE EXCEPTION '032: monthlyKpi column was not created';
  END IF;

  -- The column must be nullable: every report that already exists has no
  -- snapshot yet, and a NOT NULL would have required a backfill that invented
  -- figures for months whose planner was never filled in.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'icr_monthly_reports'
      AND column_name = 'monthlyKpi'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION '032: monthlyKpi must be nullable';
  END IF;

  -- The planner this section reads from must still be present.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables WHERE table_name = 'weekly_activities'
  ) THEN
    RAISE EXCEPTION '032: weekly_activities is missing — the KPI section has no source';
  END IF;
END $$;

COMMIT;
