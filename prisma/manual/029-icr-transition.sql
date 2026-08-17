-- 029 — ICR Transition & Handover (spec §ICR Transition & Handover Report).
--
-- A structured handover produced when an ICR stops covering an assignment.
--
-- Scope is an ASSIGNMENT, not a person (spec §7): an ICR covering Institution A
-- and Institution B who stops covering only A must produce a report containing
-- A's pipeline and none of B's. `institutionId` is therefore NOT NULL, and
-- every section query filters on it rather than on outgoingIcrId alone.
--
-- Deliberately NOT stored here: students, agents, tasks, plans, forecasts.
-- Spec §36 states the report "does not become the owner of linked operational
-- data" and §3 that it "must not become another database containing copies of
-- information already in the CRM". Those are read live from their owning
-- modules until the report is finalised.
--
-- `snapshot` (jsonb, nullable) exists for spec §37: when the report becomes
-- Final, the material figures are frozen, because the underlying records keep
-- moving afterwards. A student at Offer Received on the handover date must
-- still read Offer Received in the final report after they enrol three months
-- later. Null until finalisation — a populated snapshot IS the record of
-- having been finalised.
--
-- transition_workflow_events is append-only (spec §5, "full workflow history
-- must be retained"): rows are inserted on every status change and never
-- updated, so a later transition cannot rewrite the trail of an earlier one.
--
-- Generated with `prisma migrate diff`, then filtered. The raw diff also wanted
-- to DROP INDEX employees_timesheetApproverId_idx and drop three `updatedAt`
-- defaults on offboarding_requests, timesheet_entries and timesheets. That is
-- pre-existing drift between schema.prisma and the database, unrelated to this
-- change, and dropping an index on a live table is not something a Transition
-- migration should do quietly. Those four statements were removed.
--
-- Run as the application role:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f prisma/manual/029-icr-transition.sql

BEGIN;

-- CreateEnum
CREATE TYPE "TransitionType" AS ENUM ('LEAVING_ILLUME', 'INSTITUTION_REASSIGNMENT', 'MARKET_REASSIGNMENT', 'INTERNAL_ROLE_CHANGE', 'TEMPORARY_COVERAGE', 'EXTENDED_LEAVE', 'OTHER');

-- CreateEnum
CREATE TYPE "TransitionStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'SUBMITTED_TO_RM', 'AMENDMENTS_REQUIRED', 'RESUBMITTED', 'ACCEPTED_BY_RM', 'FINAL', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "TransitionSectionKey" AS ENUM ('EXECUTIVE_HANDOVER_SUMMARY', 'MARKET_OVERVIEW', 'RECRUITMENT_EVENTS_ACTIVITIES', 'PRIORITY_AGENT_HANDOVER', 'NEW_HIGH_POTENTIAL_AGENTS', 'SCHOOL_INSTITUTION_RELATIONSHIPS', 'OTHER_KEY_RELATIONSHIPS', 'ACTIVE_STUDENT_PIPELINE', 'OUTSTANDING_TASKS_COMMITMENTS', 'RECRUITMENT_PLAN_TRAVEL_BUDGET', 'CURRENT_FORECAST', 'CLIENT_OPERATIONAL_KNOWLEDGE', 'OUTSTANDING_ISSUES_RISKS', 'KEY_DOCUMENTS_RESOURCES', 'FINAL_STRATEGIC_RECOMMENDATIONS');

-- DropIndex

-- AlterTable

-- AlterTable

-- AlterTable

-- CreateTable
CREATE TABLE "transition_reports" (
    "id" TEXT NOT NULL,
    "outgoingIcrId" TEXT NOT NULL,
    "institutionId" TEXT NOT NULL,
    "regionId" TEXT,
    "incomingIcrId" TEXT,
    "regionalManagerId" TEXT NOT NULL,
    "clientRelationsDirectorId" TEXT,
    "vpGlobalSalesId" TEXT,
    "transitionType" "TransitionType" NOT NULL,
    "effectiveTransitionDate" TIMESTAMP(3) NOT NULL,
    "finalWorkingDay" TIMESTAMP(3),
    "reportDueDate" TIMESTAMP(3) NOT NULL,
    "status" "TransitionStatus" NOT NULL DEFAULT 'ASSIGNED',
    "declarationConfirmedAt" TIMESTAMP(3),
    "declarationById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "finalisedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "snapshot" JSONB,
    "snapshotAt" TIMESTAMP(3),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transition_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transition_report_markets" (
    "reportId" TEXT NOT NULL,
    "marketId" TEXT NOT NULL,

    CONSTRAINT "transition_report_markets_pkey" PRIMARY KEY ("reportId","marketId")
);

-- CreateTable
CREATE TABLE "transition_report_sections" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "section" "TransitionSectionKey" NOT NULL,
    "narrative" TEXT,
    "data" JSONB,
    "completedAt" TIMESTAMP(3),
    "completedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transition_report_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transition_workflow_events" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "fromStatus" "TransitionStatus",
    "toStatus" "TransitionStatus" NOT NULL,
    "actedById" TEXT NOT NULL,
    "comments" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transition_workflow_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transition_reports_outgoingIcrId_institutionId_idx" ON "transition_reports"("outgoingIcrId", "institutionId");

-- CreateIndex
CREATE INDEX "transition_reports_status_idx" ON "transition_reports"("status");

-- CreateIndex
CREATE INDEX "transition_reports_regionalManagerId_idx" ON "transition_reports"("regionalManagerId");

-- CreateIndex
CREATE INDEX "transition_reports_reportDueDate_idx" ON "transition_reports"("reportDueDate");

-- CreateIndex
CREATE INDEX "transition_report_markets_marketId_idx" ON "transition_report_markets"("marketId");

-- CreateIndex
CREATE UNIQUE INDEX "transition_report_sections_reportId_section_key" ON "transition_report_sections"("reportId", "section");

-- CreateIndex
CREATE INDEX "transition_workflow_events_reportId_createdAt_idx" ON "transition_workflow_events"("reportId", "createdAt");

-- AddForeignKey
ALTER TABLE "transition_reports" ADD CONSTRAINT "transition_reports_outgoingIcrId_fkey" FOREIGN KEY ("outgoingIcrId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transition_reports" ADD CONSTRAINT "transition_reports_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "institutions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transition_reports" ADD CONSTRAINT "transition_reports_regionId_fkey" FOREIGN KEY ("regionId") REFERENCES "regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transition_reports" ADD CONSTRAINT "transition_reports_incomingIcrId_fkey" FOREIGN KEY ("incomingIcrId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transition_reports" ADD CONSTRAINT "transition_reports_regionalManagerId_fkey" FOREIGN KEY ("regionalManagerId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transition_reports" ADD CONSTRAINT "transition_reports_clientRelationsDirectorId_fkey" FOREIGN KEY ("clientRelationsDirectorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transition_reports" ADD CONSTRAINT "transition_reports_vpGlobalSalesId_fkey" FOREIGN KEY ("vpGlobalSalesId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transition_reports" ADD CONSTRAINT "transition_reports_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transition_report_markets" ADD CONSTRAINT "transition_report_markets_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "transition_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transition_report_markets" ADD CONSTRAINT "transition_report_markets_marketId_fkey" FOREIGN KEY ("marketId") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transition_report_sections" ADD CONSTRAINT "transition_report_sections_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "transition_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transition_workflow_events" ADD CONSTRAINT "transition_workflow_events_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "transition_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transition_workflow_events" ADD CONSTRAINT "transition_workflow_events_actedById_fkey" FOREIGN KEY ("actedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ── Post-conditions ────────────────────────────────────────────────────────
-- Objects must exist AND be owned by the application role. A migration run as
-- `postgres` creates tables the app cannot write to, which fails at runtime
-- rather than here, so the ownership check is part of the migration.
DO $$
DECLARE
  ref_owner text;
  bad       text;
  missing   text;
BEGIN
  SELECT tableowner INTO ref_owner FROM pg_tables
   WHERE schemaname = 'public' AND tablename = 'users';

  SELECT string_agg(t.name, ', ') INTO missing
    FROM (VALUES ('transition_reports'), ('transition_report_markets'),
                 ('transition_report_sections'), ('transition_workflow_events')) AS t(name)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t.name
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'migration 029 incomplete — missing tables: %', missing;
  END IF;

  SELECT string_agg(tablename, ', ') INTO bad FROM pg_tables
   WHERE schemaname = 'public'
     AND tablename LIKE 'transition\_%'
     AND tableowner IS DISTINCT FROM ref_owner;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 029 — wrong owner (expected %) on: %', ref_owner, bad;
  END IF;

  -- The snapshot column carries the historical-integrity requirement; a text
  -- column here would defeat querying it later.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_name = 'transition_reports' AND column_name = 'snapshot'
       AND data_type = 'jsonb'
  ) THEN
    RAISE EXCEPTION 'migration 029 — transition_reports.snapshot must be jsonb';
  END IF;

  RAISE NOTICE 'migration 029 ok — transition tables created, owned by %', ref_owner;
END $$;

COMMIT;
