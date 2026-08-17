-- 030 — Forecasting (spec §Forecasting Module).
--
-- Replaces the RM Master Aggregation workbook. The spec's division of labour is
-- the design: "CRM provides the facts. ICR provides the forecast judgement. RM
-- provides regional oversight."
--
-- Deliberately NOT stored: the pipeline itself. Spec §5 states the pipeline
-- figures are "system-generated and should not be manually editable from
-- Forecasting", so Active Leads / Qualified / Applications / Offers / Deposits
-- are computed live from the leads and interests that own them. Copying them
-- here would create a second set of numbers that drifts from the first.
--
-- forecast_segments holds BOTH judgements side by side. Spec §13 is explicit:
-- "RM adjustments must create separate RM forecast values rather than
-- overwriting the ICR submission… The historical record should therefore show
-- both professional judgements." The rm* columns are nullable and null means
-- "not adjusted", which is different information from "adjusted to the same
-- number" — that distinction is the whole point of §13, and it is also the only
-- data that makes per-person forecast-accuracy analysis possible later.
--
-- The unique key is period + institution + ICR + intake, per §3. Two forecasts
-- for the same combination would make "what did we forecast in March" have two
-- answers.
--
-- forecast_events is append-only (§35): inserted on every status change, never
-- updated, so a later cycle cannot rewrite an earlier one.
--
-- Generated with `prisma migrate diff`, then filtered. The raw diff again wanted
-- to DROP INDEX employees_timesheetApproverId_idx and drop three `updatedAt`
-- defaults — the same pre-existing drift that migration 029 excluded, still
-- unaddressed. Those four statements were removed; a Forecasting migration
-- should not quietly drop an index on a live HR table.
--
-- Run as the application role:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual/030-forecasting.sql

BEGIN;

-- CreateEnum
CREATE TYPE "ForecastSegmentKey" AS ENUM ('DIRECT_UG', 'DIRECT_PG', 'INDIRECT_UG', 'INDIRECT_PG');

-- CreateEnum
CREATE TYPE "ForecastStatus" AS ENUM ('DRAFT', 'SUBMITTED_TO_RM', 'RETURNED_TO_ICR', 'RM_REVIEWED', 'REGIONAL_SUBMITTED', 'RETURNED_TO_RM', 'ACCEPTED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PipelineMaturity" AS ENUM ('EARLY_STAGE', 'PIPELINE_DEPENDENT', 'MODERATE_MATURITY', 'HIGH_MATURITY');

-- DropIndex

-- AlterTable

-- AlterTable

-- AlterTable

-- CreateTable
CREATE TABLE "forecasts" (
    "id" TEXT NOT NULL,
    "periodYear" INTEGER NOT NULL,
    "periodMonth" INTEGER NOT NULL,
    "institutionId" TEXT NOT NULL,
    "marketId" TEXT,
    "icrId" TEXT NOT NULL,
    "intakeYear" INTEGER NOT NULL,
    "intakeMonth" INTEGER NOT NULL,
    "status" "ForecastStatus" NOT NULL DEFAULT 'DRAFT',
    "confidenceScore" INTEGER,
    "pipelineMaturity" "PipelineMaturity",
    "rationale" TEXT,
    "keyRisks" TEXT,
    "keyOpportunities" TEXT,
    "regionalManagerId" TEXT,
    "rmComment" TEXT,
    "vpReviewerId" TEXT,
    "vpComment" TEXT,
    "submittedAt" TIMESTAMP(3),
    "rmReviewedAt" TIMESTAMP(3),
    "regionalSubmittedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "actualEnrolments" INTEGER,
    "actualsRecordedAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forecasts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecast_segments" (
    "id" TEXT NOT NULL,
    "forecastId" TEXT NOT NULL,
    "segment" "ForecastSegmentKey" NOT NULL,
    "icrApplications" INTEGER NOT NULL DEFAULT 0,
    "icrDeposits" INTEGER NOT NULL DEFAULT 0,
    "icrEnrolments" INTEGER NOT NULL DEFAULT 0,
    "rmApplications" INTEGER,
    "rmDeposits" INTEGER,
    "rmEnrolments" INTEGER,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "forecast_segments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "forecast_events" (
    "id" TEXT NOT NULL,
    "forecastId" TEXT NOT NULL,
    "fromStatus" "ForecastStatus",
    "toStatus" "ForecastStatus" NOT NULL,
    "actedById" TEXT NOT NULL,
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "forecast_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "forecasts_status_idx" ON "forecasts"("status");

-- CreateIndex
CREATE INDEX "forecasts_icrId_status_idx" ON "forecasts"("icrId", "status");

-- CreateIndex
CREATE INDEX "forecasts_regionalManagerId_status_idx" ON "forecasts"("regionalManagerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "forecasts_periodYear_periodMonth_institutionId_icrId_intake_key" ON "forecasts"("periodYear", "periodMonth", "institutionId", "icrId", "intakeYear", "intakeMonth");

-- CreateIndex
CREATE UNIQUE INDEX "forecast_segments_forecastId_segment_key" ON "forecast_segments"("forecastId", "segment");

-- CreateIndex
CREATE INDEX "forecast_events_forecastId_createdAt_idx" ON "forecast_events"("forecastId", "createdAt");

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_icrId_fkey" FOREIGN KEY ("icrId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_regionalManagerId_fkey" FOREIGN KEY ("regionalManagerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_vpReviewerId_fkey" FOREIGN KEY ("vpReviewerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecasts" ADD CONSTRAINT "forecasts_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_segments" ADD CONSTRAINT "forecast_segments_forecastId_fkey" FOREIGN KEY ("forecastId") REFERENCES "forecasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_events" ADD CONSTRAINT "forecast_events_forecastId_fkey" FOREIGN KEY ("forecastId") REFERENCES "forecasts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "forecast_events" ADD CONSTRAINT "forecast_events_actedById_fkey" FOREIGN KEY ("actedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Post-conditions ────────────────────────────────────────────────────────
DO $$
DECLARE
  ref_owner text;
  bad       text;
  missing   text;
BEGIN
  SELECT tableowner INTO ref_owner FROM pg_tables
   WHERE schemaname = 'public' AND tablename = 'users';

  SELECT string_agg(t.name, ', ') INTO missing
    FROM (VALUES ('forecasts'), ('forecast_segments'), ('forecast_events')) AS t(name)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t.name
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'migration 030 incomplete — missing tables: %', missing;
  END IF;

  SELECT string_agg(tablename, ', ') INTO bad FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename LIKE 'forecast%'
     AND tableowner IS DISTINCT FROM ref_owner;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 030 — wrong owner (expected %) on: %', ref_owner, bad;
  END IF;

  -- The RM columns MUST stay nullable. A NOT NULL default of 0 here would erase
  -- the difference between "the RM did not adjust" and "the RM adjusted to
  -- zero", which spec §13 depends on.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'forecast_segments'
       AND column_name IN ('rmApplications', 'rmDeposits', 'rmEnrolments')
       AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION 'migration 030 — rm* columns must remain nullable (spec 13)';
  END IF;

  RAISE NOTICE 'migration 030 ok — forecast tables created, owned by %', ref_owner;
END $$;

COMMIT;
