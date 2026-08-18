-- 031 — ICR Monthly Report (rep-wise).
--
-- Adds the CRM equivalent of the "Illume - ICR - Monthly Report Template
-- (Master)" Word document. Keyed on the REP and the period, not on the
-- institution: a rep covering four schools should see one month, not four
-- reports. `monthly_reports` (institution-scoped) is untouched and stays live —
-- this is an additional report, not a replacement, and nothing here reads or
-- writes that table.
--
-- Purely additive: two new tables, no ALTER on anything that exists, no new
-- enum types (ReportStatus and ApprovalAction are reused). The diff was taken
-- schema-to-schema rather than against the live database, which is why it does
-- not carry the four pre-existing drift statements that migrations 029 and 030
-- had to filter out by hand.
--
-- Idempotent throughout, for the reason 030 learned the hard way: deploy paths
-- re-run migrations more often than anyone intends, and a migration that only
-- works once fails on production mid-deploy the second time.
--
-- Run as the application role, never as postgres — CREATE TABLE assigns
-- ownership, and illume_user gets no privileges on a table owned by someone
-- else:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual/031-icr-monthly-report.sql

-- AlterEnum
-- §7 "Snapshots" needs somewhere to hang photos, and attachments are keyed by
-- a parent-type enum. Deliberately OUTSIDE the transaction below: older
-- PostgreSQL refuses ALTER TYPE ... ADD VALUE inside a transaction block
-- altogether, and even where it is allowed the new value cannot be used until
-- the transaction commits. It is idempotent on its own, and additive, so
-- running it separately costs nothing.
ALTER TYPE "AttachmentParentType" ADD VALUE IF NOT EXISTS 'ICR_MONTHLY_REPORT';

BEGIN;

-- CreateTable
CREATE TABLE IF NOT EXISTS "icr_monthly_reports" (
    "id" TEXT NOT NULL,
    "icrId" TEXT NOT NULL,
    "regionId" TEXT,
    "reportingMonth" INTEGER NOT NULL,
    "reportingYear" INTEGER NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'DRAFT',
    "intakesCovered" TEXT,
    "performance" JSONB,
    "pipelineSnapshot" JSONB,
    "institutionBreakdown" JSONB,
    "priorityApplications" JSONB,
    "agentEngagement" JSONB,
    "topAgents" JSONB,
    "atRiskAgents" JSONB,
    "eventActivities" JSONB,
    "keyHighlights" TEXT,
    "keyChallenges" TEXT,
    "channelDevelopment" TEXT,
    "businessDevelopment" TEXT,
    "demandTrends" TEXT,
    "competitiveActivity" TEXT,
    "marketConditions" TEXT,
    "priorityOne" TEXT,
    "priorityTwo" TEXT,
    "priorityThree" TEXT,
    "supportRequested" TEXT,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "refreshedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3),
    "finalApprovedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "icr_monthly_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "icr_report_approvals" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" "ApprovalAction" NOT NULL,
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "icr_report_approvals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "icr_monthly_reports_status_idx" ON "icr_monthly_reports"("status");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "icr_monthly_reports_regionId_status_idx" ON "icr_monthly_reports"("regionId", "status");

-- CreateIndex
-- One report per rep per month. Without this a rep could end up with two
-- Augusts, and "what did the rep report in August" would have two answers.
CREATE UNIQUE INDEX IF NOT EXISTS "icr_monthly_reports_icrId_reportingMonth_reportingYear_key" ON "icr_monthly_reports"("icrId", "reportingMonth", "reportingYear");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "icr_report_approvals_reportId_createdAt_idx" ON "icr_report_approvals"("reportId", "createdAt");

-- AddForeignKey
-- Postgres has no ADD CONSTRAINT IF NOT EXISTS, so every FK is guarded.
DO $$ BEGIN
  ALTER TABLE "icr_monthly_reports" ADD CONSTRAINT "icr_monthly_reports_icrId_fkey" FOREIGN KEY ("icrId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "icr_monthly_reports" ADD CONSTRAINT "icr_monthly_reports_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "icr_report_approvals" ADD CONSTRAINT "icr_report_approvals_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "icr_monthly_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AddForeignKey
DO $$ BEGIN
  ALTER TABLE "icr_report_approvals" ADD CONSTRAINT "icr_report_approvals_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;


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
    FROM (VALUES ('icr_monthly_reports'), ('icr_report_approvals')) AS t(name)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t.name
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'migration 031 incomplete — missing tables: %', missing;
  END IF;

  SELECT string_agg(tablename, ', ') INTO bad FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename LIKE 'icr\_%'
     AND tableowner IS DISTINCT FROM ref_owner;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 031 — wrong owner (expected %) on: %', ref_owner, bad;
  END IF;

  -- The institution-scoped report must survive untouched. This migration adds
  -- a second report; if monthly_reports has gone missing, something in this
  -- file has done far more than it was supposed to.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'monthly_reports'
  ) THEN
    RAISE EXCEPTION 'migration 031 — monthly_reports is gone; this migration must not touch it';
  END IF;

  RAISE NOTICE 'migration 031 ok — icr_monthly_reports created, owned by %', ref_owner;
END $$;

COMMIT;
