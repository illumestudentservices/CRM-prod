-- Phase 4 — Recruitment Planning.
--
-- Six new tables + one new enum family. Zero backfill: quarterly plans are
-- forward-looking work; existing TravelRequest rows are NOT retroactively
-- attached to a Recruitment Plan. Once an ICR drafts a Q4 2026 plan, that
-- plan owns the workflow going forward.
--
-- Currency handling is spec §4D + decision #6: original amount + currency
-- stays alongside converted amount + rate + rate-date + free-text source note.
-- No live FX API in Phase 4.

BEGIN;

-- ── 1. Enums ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'RecruitmentPlanStatus') THEN
    CREATE TYPE "RecruitmentPlanStatus" AS ENUM (
      'DRAFT', 'SUBMITTED', 'REGIONAL_MANAGER_REVIEW', 'ACCOUNT_MANAGER_REVIEW',
      'INTERNAL_FINAL_REVIEW', 'CLIENT_REVIEW', 'APPROVED', 'ACTIVE',
      'COMPLETED', 'CLOSED', 'RETURNED'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VariationType') THEN
    CREATE TYPE "VariationType" AS ENUM (
      'ADD_TRAVEL', 'CANCEL_TRAVEL', 'ADD_RECRUITMENT_EVENT',
      'CANCEL_RECRUITMENT_EVENT', 'INCREASE_BUDGET', 'DECREASE_BUDGET',
      'ADD_FIELD_ACTIVITY', 'REMOVE_FIELD_ACTIVITY', 'OTHER'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'FieldWorkPlanAlignment') THEN
    CREATE TYPE "FieldWorkPlanAlignment" AS ENUM (
      'WITHIN_APPROVED_PLAN', 'APPROVED_VARIATION',
      'UNPLANNED_NO_BUDGET', 'UNPLANNED_APPROVAL_REQUIRED'
    );
  END IF;
END $$;

-- ── 2. Table: quarterly_recruitment_plans ────────────────────────────────
CREATE TABLE "quarterly_recruitment_plans" (
  "id"                       TEXT PRIMARY KEY,
  "icrId"                    TEXT NOT NULL REFERENCES "users"("id"),
  "institutionId"            TEXT REFERENCES "institutions"("id"),
  "marketId"                 TEXT REFERENCES "markets"("id"),
  "quarter"                  INTEGER NOT NULL CHECK ("quarter" BETWEEN 1 AND 4),
  "year"                     INTEGER NOT NULL,
  "reportingCurrency"        TEXT NOT NULL DEFAULT 'USD',
  "status"                   "RecruitmentPlanStatus" NOT NULL DEFAULT 'DRAFT',

  "regionalManagerId"        TEXT REFERENCES "users"("id"),
  "regionalReviewedAt"       TIMESTAMP(3),
  "regionalReviewNotes"      TEXT,

  "accountManagerId"         TEXT REFERENCES "users"("id"),
  "accountReviewedAt"        TIMESTAMP(3),
  "accountReviewNotes"       TEXT,

  "vpReviewerId"             TEXT REFERENCES "users"("id"),
  "internalFinalReviewedAt"  TIMESTAMP(3),
  "internalFinalReviewNotes" TEXT,

  "clientReviewedAt"         TIMESTAMP(3),
  "clientReviewNotes"        TEXT,

  "approvedAt"               TIMESTAMP(3),
  "activatedAt"              TIMESTAMP(3),
  "completedAt"              TIMESTAMP(3),
  "closedAt"                 TIMESTAMP(3),

  "objectives"               JSONB,

  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"                TIMESTAMP(3) NOT NULL DEFAULT NOW(),

  UNIQUE ("icrId", "institutionId", "quarter", "year")
);
CREATE INDEX "recruitment_plans_status_idx"   ON "quarterly_recruitment_plans"("status");
CREATE INDEX "recruitment_plans_quarter_idx"  ON "quarterly_recruitment_plans"("quarter", "year");

-- ── 3. Table: planned_travel ─────────────────────────────────────────────
CREATE TABLE "planned_travel" (
  "id"                       TEXT PRIMARY KEY,
  "planId"                   TEXT NOT NULL REFERENCES "quarterly_recruitment_plans"("id") ON DELETE CASCADE,
  "destination"              TEXT NOT NULL,
  "country"                  TEXT NOT NULL,
  "city"                     TEXT,
  "plannedStart"             TIMESTAMP(3) NOT NULL,
  "plannedEnd"               TIMESTAMP(3) NOT NULL,
  "purpose"                  TEXT NOT NULL,
  "linkedEventId"            TEXT REFERENCES "events"("id"),
  "estimatedCost"            DOUBLE PRECISION,
  "estimatedCurrency"        TEXT DEFAULT 'USD',
  "activatedAt"              TIMESTAMP(3),
  "activatedTravelRequestId" TEXT UNIQUE,
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"                TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX "planned_travel_planId_idx" ON "planned_travel"("planId");

-- ── 4. Table: planned_event_participations ───────────────────────────────
CREATE TABLE "planned_event_participations" (
  "id"                       TEXT PRIMARY KEY,
  "planId"                   TEXT NOT NULL REFERENCES "quarterly_recruitment_plans"("id") ON DELETE CASCADE,
  "eventId"                  TEXT NOT NULL REFERENCES "events"("id"),
  "institutionRepresentedId" TEXT NOT NULL REFERENCES "institutions"("id"),
  "purpose"                  TEXT,
  "estimatedCost"            DOUBLE PRECISION,
  "estimatedCurrency"        TEXT DEFAULT 'USD',
  "expectedLeads"            INTEGER,
  "expectedApplications"     INTEGER,
  "expectedEnrolments"       INTEGER,
  "createdAt"                TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"                TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX "planned_event_participations_planId_idx"  ON "planned_event_participations"("planId");
CREATE INDEX "planned_event_participations_eventId_idx" ON "planned_event_participations"("eventId");

-- ── 5. Table: planned_field_activities ───────────────────────────────────
CREATE TABLE "planned_field_activities" (
  "id"           TEXT PRIMARY KEY,
  "planId"       TEXT NOT NULL REFERENCES "quarterly_recruitment_plans"("id") ON DELETE CASCADE,
  "activityType" TEXT NOT NULL,
  "plannedCount" INTEGER NOT NULL,
  "actualCount"  INTEGER NOT NULL DEFAULT 0,
  "notes"        TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX "planned_field_activities_planId_idx" ON "planned_field_activities"("planId");

-- ── 6. Table: recruitment_plan_budget_items ──────────────────────────────
CREATE TABLE "recruitment_plan_budget_items" (
  "id"                 TEXT PRIMARY KEY,
  "planId"             TEXT NOT NULL REFERENCES "quarterly_recruitment_plans"("id") ON DELETE CASCADE,
  "category"           TEXT NOT NULL,
  "description"        TEXT,
  "amount"             DOUBLE PRECISION NOT NULL,
  "currency"           TEXT NOT NULL,
  "convertedAmount"    DOUBLE PRECISION,
  "reportingCurrency"  TEXT,
  "exchangeRate"       DOUBLE PRECISION,
  "exchangeRateDate"   TIMESTAMP(3),
  "exchangeRateSource" TEXT,
  "approvedAmount"     DOUBLE PRECISION,
  "actualSpend"        DOUBLE PRECISION,
  "allocation"         TEXT NOT NULL DEFAULT 'PLAN',
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX "recruitment_plan_budget_items_planId_idx" ON "recruitment_plan_budget_items"("planId");

-- ── 7. Table: variation_requests ─────────────────────────────────────────
CREATE TABLE "variation_requests" (
  "id"              TEXT PRIMARY KEY,
  "planId"          TEXT NOT NULL REFERENCES "quarterly_recruitment_plans"("id") ON DELETE CASCADE,
  "type"            "VariationType" NOT NULL,
  "reason"          TEXT NOT NULL,
  "requestedById"   TEXT NOT NULL REFERENCES "users"("id"),
  "requestedAt"     TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "status"          "RecruitmentPlanStatus" NOT NULL DEFAULT 'SUBMITTED',
  "approvedById"    TEXT REFERENCES "users"("id"),
  "approvedAt"      TIMESTAMP(3),
  "reviewNotes"     TEXT,
  "incrementalCost" DOUBLE PRECISION,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX "variation_requests_planId_idx" ON "variation_requests"("planId");
CREATE INDEX "variation_requests_status_idx" ON "variation_requests"("status");

INSERT INTO "audit_logs" ("id", "userId", "action", "entity", "entityId", "changes", "createdAt")
VALUES (
  gen_random_uuid(), NULL, 'RECRUITMENT_PLANNING_COMPLETE',
  'System', '015-recruitment-planning',
  '{"tablesCreated": 6}'::jsonb, NOW()
);

COMMIT;
