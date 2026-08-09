-- Phase 7 — Reporting simplification.
--
-- Drops the ForecastEntry table (orphaned since the 2026-05-30 report
-- redesign — no code reads or writes it) and prepares the monthly-report
-- flow for the new "Unique Students vs Institution Interests vs Applications"
-- breakdown.
--
-- ForecastEntry drop is DESTRUCTIVE. Pre-checks:
--   * gap-analysis.md confirmed zero `db.forecastEntry.*` calls
--   * `forecast-section.tsx` and `/api/reports/[id]/forecast/route.ts` are
--     both orphaned (removed by the code-cleanup PR)
-- Rows are copied to audit_logs first as a paranoia belt-and-braces.
--
-- OTHER DEAD MODELS listed in gap-analysis (`LeadDocument`, `OnboardingItem`,
-- `ActivityAttendee`, `InstitutionUser`) are NOT dropped here — they have
-- active FK relations from live models in the Prisma schema. Removing them
-- requires either deleting the relation fields first (schema PR) or a longer
-- rollout. Left for a follow-up migration.

BEGIN;

-- ── 1. Belt-and-braces snapshot of forecast_entries ──────────────────────
INSERT INTO "audit_logs" ("id", "userId", "action", "entity", "entityId", "changes", "createdAt")
SELECT
  gen_random_uuid(),
  NULL,
  'FORECAST_ENTRY_PRE_DROP_SNAPSHOT',
  'ForecastEntry',
  '018-reporting-simplification',
  jsonb_build_object(
    'rowCount', (SELECT COUNT(*) FROM "forecast_entries"),
    'rows',     (SELECT jsonb_agg(to_jsonb(fe)) FROM "forecast_entries" fe)
  ),
  NOW();

-- ── 2. Drop the table ────────────────────────────────────────────────────
DROP TABLE IF EXISTS "forecast_entries";

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ConfidenceLevel') THEN
    -- Only drop the enum if nothing else references it.
    IF NOT EXISTS (
      SELECT 1 FROM pg_depend d
      JOIN pg_type t ON t.oid = d.refobjid
      WHERE t.typname = 'ConfidenceLevel' AND d.deptype = 'n'
    ) THEN
      DROP TYPE "ConfidenceLevel";
    END IF;
  END IF;
END $$;

INSERT INTO "audit_logs" ("id", "userId", "action", "entity", "entityId", "changes", "createdAt")
VALUES (
  gen_random_uuid(), NULL, 'REPORTING_SIMPLIFICATION_COMPLETE',
  'System', '018-reporting-simplification',
  '{"forecast_entries_dropped": true}'::jsonb, NOW()
);

COMMIT;
