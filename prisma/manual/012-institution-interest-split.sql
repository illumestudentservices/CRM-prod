-- Split every Lead into a Student Profile + N Institution Interests.
--
-- Run this INSTEAD OF `prisma db push` for this change, not after it. Push
-- would see `institution_interests` as a new table but has no way to know that
-- the rows must be populated from `leads.institutionId` — an empty table would
-- ship, breaking every downstream reader that expects "the interest for this
-- student × institution."
--
-- Phase 1 is deliberately additive:
--   * `leads.stage`, `leads.institutionId`, all the per-institution columns on
--     `leads` STAY populated.
--   * The new `institution_interests` table is created and backfilled.
--   * `lead_applications`, `lead_activities`, `lead_checklist_items` get a
--     nullable `institutionInterestId` FK and are backfilled where possible.
--   * The API keeps writing to `leads.stage` in this phase; a later phase cuts
--     readers over to `institution_interests.stage`, then a third phase drops
--     the duplicated columns on `leads`.
-- This staging exists because the offline booth device, the inactivity cron,
-- the analytics group-bys and the students UI all read `leads.stage`. Any of
-- them shipping ahead of the others would silently under-count the pipeline.
--
-- ── What the backfill decides ──────────────────────────────────────────────
--
-- Only active, non-deleted leads WITH an institutionId get a backfilled
-- interest. A NEW_LEAD without an institutionId is a student who has not yet
-- picked an institution, and per the spec that is a valid state — zero
-- interests, not one placeholder interest.
--
-- Every backfilled interest inherits its parent lead's stage, ownership,
-- intake and dates one-for-one. This preserves the current pipeline snapshot
-- exactly. Any pipeline movement AFTER this migration writes to both tables
-- until Phase 2 cutover.
--
-- ── Unique constraint: one OPEN interest per (student, institution) ────────
--
-- If a student is rejected by UofT and wants to reapply for the next intake,
-- we close the rejected row (`closedAt = NOW()`) and open a new one. The
-- partial unique index enforces this: at most one row per (leadId,
-- institutionId) where `closedAt IS NULL`. Prisma cannot express partial
-- uniques in its schema DSL, so it lives here in the raw SQL and the API
-- layer's create/reopen paths must respect it.

BEGIN;

-- ── 1. Pre-flight audit ────────────────────────────────────────────────────
-- Write the counts to audit_logs BEFORE doing anything, so if step 4's parity
-- check fails and we roll back, we still know what the intended shape was.
INSERT INTO "audit_logs" ("id", "userId", "action", "entity", "entityId", "changes", "createdAt")
SELECT
  gen_random_uuid(),
  NULL,
  'INSTITUTION_INTEREST_SPLIT_PREFLIGHT',
  'System',
  '012-institution-interest-split',
  jsonb_build_object(
    'activeLeadsWithInstitution', (
      SELECT COUNT(*) FROM "leads"
      WHERE "deletedAt" IS NULL AND "institutionId" IS NOT NULL
    ),
    'activeLeadsWithoutInstitution', (
      SELECT COUNT(*) FROM "leads"
      WHERE "deletedAt" IS NULL AND "institutionId" IS NULL
    ),
    'softDeletedLeads', (
      SELECT COUNT(*) FROM "leads" WHERE "deletedAt" IS NOT NULL
    ),
    'leadApplicationsTotal', (SELECT COUNT(*) FROM "lead_applications"),
    'leadActivitiesTotal', (SELECT COUNT(*) FROM "lead_activities"),
    'leadChecklistItemsTotal', (SELECT COUNT(*) FROM "lead_checklist_items")
  ),
  NOW();

-- ── 2. Enum: EligibilityOutcome ────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'EligibilityOutcome') THEN
    CREATE TYPE "EligibilityOutcome" AS ENUM (
      'ELIGIBLE',
      'PROVISIONALLY_ELIGIBLE',
      'FURTHER_INFO_REQUIRED',
      'NOT_ELIGIBLE'
    );
  END IF;
END $$;

-- ── 3. Table: institution_interests ────────────────────────────────────────
CREATE TABLE "institution_interests" (
  "id"                     TEXT PRIMARY KEY,
  "leadId"                 TEXT NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "institutionId"          TEXT NOT NULL REFERENCES "institutions"("id"),

  "program"                TEXT,
  "intakeYear"             INTEGER NOT NULL,
  "intakeMonth"            INTEGER NOT NULL,
  "studyLevel"             "StudyLevel" NOT NULL,

  "assignedICRId"          TEXT REFERENCES "users"("id"),

  "stage"                  "LeadStage" NOT NULL DEFAULT 'NEW_LEAD',
  "stageEnteredAt"         TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "stageBeforeClose"       "LeadStage",
  "lastContactedAt"        TIMESTAMP(3),
  "lastProgressedAt"       TIMESTAMP(3),
  "inactivity14NotifiedAt" TIMESTAMP(3),
  "inactivity21NotifiedAt" TIMESTAMP(3),

  "eligibilityOutcome"     "EligibilityOutcome",
  "eligibilityConfirmedAt" TIMESTAMP(3),
  "academicQualification"  TEXT,
  "englishStatus"          "EnglishStatus",

  "enrolmentDate"          TIMESTAMP(3),
  "isConverted"            BOOLEAN NOT NULL DEFAULT FALSE,
  "commissionEligible"     BOOLEAN NOT NULL DEFAULT FALSE,
  "convertedAt"            TIMESTAMP(3),

  "lostReason"             "LeadLostReason",
  "lostDate"               TIMESTAMP(3),
  "lostNotes"              TEXT,
  "deferredIntakeYear"     INTEGER,
  "deferredIntakeMonth"    INTEGER,
  "deferredReason"         TEXT,
  "deferredFollowUpAt"     TIMESTAMP(3),
  "deferredReopenAt"       TIMESTAMP(3),

  "activeApplicationId"    TEXT,
  "closedAt"               TIMESTAMP(3),

  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"              TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE INDEX "institution_interests_leadId_idx"          ON "institution_interests"("leadId");
CREATE INDEX "institution_interests_institutionId_idx"   ON "institution_interests"("institutionId");
CREATE INDEX "institution_interests_stage_idx"           ON "institution_interests"("stage");
CREATE INDEX "institution_interests_assignedICRId_idx"   ON "institution_interests"("assignedICRId");
CREATE INDEX "institution_interests_stage_entered_idx"   ON "institution_interests"("stage", "stageEnteredAt");

-- Partial unique: at most one OPEN interest per (student, institution).
-- Prisma can't express this in schema.prisma; it lives here and API code
-- (create + reopen paths) must respect it.
CREATE UNIQUE INDEX "institution_interests_open_unique"
  ON "institution_interests"("leadId", "institutionId")
  WHERE "closedAt" IS NULL;

-- ── 4. Backfill from leads ────────────────────────────────────────────────
-- One interest per active lead that already has an institution picked. The
-- stage, dates and per-institution snapshot travel verbatim.
INSERT INTO "institution_interests" (
  "id", "leadId", "institutionId",
  "program", "intakeYear", "intakeMonth", "studyLevel",
  "assignedICRId",
  "stage", "stageEnteredAt", "stageBeforeClose",
  "lastContactedAt", "lastProgressedAt",
  "inactivity14NotifiedAt", "inactivity21NotifiedAt",
  "eligibilityConfirmedAt", "academicQualification", "englishStatus",
  "enrolmentDate", "isConverted", "commissionEligible", "convertedAt",
  "lostReason", "lostDate", "lostNotes",
  "deferredIntakeYear", "deferredIntakeMonth", "deferredReason",
  "deferredFollowUpAt", "deferredReopenAt",
  "activeApplicationId",
  "closedAt",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  l."id",
  l."institutionId",
  l."interestedProgram",
  l."intakeYear",
  l."intakeMonth",
  l."studyLevel",
  l."assignedICRId",
  l."stage",
  l."stageEnteredAt",
  l."stageBeforeClose",
  l."lastContactedAt",
  l."lastProgressedAt",
  l."inactivity14NotifiedAt",
  l."inactivity21NotifiedAt",
  l."eligibilityConfirmedAt",
  l."academicQualification",
  l."englishStatus",
  l."enrolmentDate",
  l."isConverted",
  l."commissionEligible",
  l."convertedAt",
  l."lostReason",
  l."lostDate",
  l."lostNotes",
  l."deferredIntakeYear",
  l."deferredIntakeMonth",
  l."deferredReason",
  l."deferredFollowUpAt",
  l."deferredReopenAt",
  l."activeApplicationId",
  -- Closed outcomes on the source lead map to a closed interest.
  CASE
    WHEN l."stage" IN ('LOST', 'DEFERRED', 'APPLICATION_REJECTED', 'ENROLLED')
      THEN COALESCE(l."updatedAt", NOW())
    ELSE NULL
  END,
  l."createdAt",
  l."updatedAt"
FROM "leads" l
WHERE l."deletedAt" IS NULL
  AND l."institutionId" IS NOT NULL;

-- ── 5. Add nullable FKs on child tables + backfill from the interest map ──

ALTER TABLE "lead_applications"
  ADD COLUMN "institutionInterestId" TEXT REFERENCES "institution_interests"("id") ON DELETE SET NULL;
CREATE INDEX "lead_applications_institutionInterestId_idx"
  ON "lead_applications"("institutionInterestId");

-- An application matches an interest by (leadId, institutionId). If the
-- interest has been closed and reopened multiple times, prefer the OPEN row.
UPDATE "lead_applications" la
SET "institutionInterestId" = (
  SELECT ii."id" FROM "institution_interests" ii
  WHERE ii."leadId" = la."leadId"
    AND ii."institutionId" = la."institutionId"
  ORDER BY (ii."closedAt" IS NULL) DESC, ii."createdAt" DESC
  LIMIT 1
);

ALTER TABLE "lead_activities"
  ADD COLUMN "institutionInterestId" TEXT REFERENCES "institution_interests"("id") ON DELETE SET NULL;
CREATE INDEX "lead_activities_institutionInterestId_idx"
  ON "lead_activities"("institutionInterestId");

-- A lead activity today has no institution FK. The best backfill guess is the
-- lead's ONLY interest, if it has exactly one. Leads with zero interests (no
-- institution yet) or multiple interests (this cohort is empty at cutover but
-- will exist later) leave the column NULL — the UI reads NULL as "student
-- level" which is the correct semantics for those rows.
UPDATE "lead_activities" la
SET "institutionInterestId" = (
  SELECT ii."id" FROM "institution_interests" ii
  WHERE ii."leadId" = la."leadId"
    AND (SELECT COUNT(*) FROM "institution_interests" WHERE "leadId" = la."leadId") = 1
  LIMIT 1
);

ALTER TABLE "lead_checklist_items"
  ADD COLUMN "institutionInterestId" TEXT REFERENCES "institution_interests"("id") ON DELETE SET NULL;
CREATE INDEX "lead_checklist_items_institutionInterestId_idx"
  ON "lead_checklist_items"("institutionInterestId");

-- Same logic as activities: single-interest leads can be backfilled cleanly.
UPDATE "lead_checklist_items" ci
SET "institutionInterestId" = (
  SELECT ii."id" FROM "institution_interests" ii
  WHERE ii."leadId" = ci."leadId"
    AND (SELECT COUNT(*) FROM "institution_interests" WHERE "leadId" = ci."leadId") = 1
  LIMIT 1
);

-- ── 6. Parity check — fail loudly rather than commit a partial migration ──
DO $$
DECLARE
  expected INTEGER;
  actual   INTEGER;
BEGIN
  SELECT COUNT(*) INTO expected
  FROM "leads"
  WHERE "deletedAt" IS NULL AND "institutionId" IS NOT NULL;

  SELECT COUNT(*) INTO actual FROM "institution_interests";

  IF actual <> expected THEN
    RAISE EXCEPTION
      'InstitutionInterest backfill parity failed: expected % rows, got %',
      expected, actual;
  END IF;

  RAISE NOTICE 'Backfilled % institution_interests rows (parity OK)', actual;
END $$;

-- ── 7. Post-flight audit ──────────────────────────────────────────────────
INSERT INTO "audit_logs" ("id", "userId", "action", "entity", "entityId", "changes", "createdAt")
SELECT
  gen_random_uuid(),
  NULL,
  'INSTITUTION_INTEREST_SPLIT_COMPLETE',
  'System',
  '012-institution-interest-split',
  jsonb_build_object(
    'institutionInterestsCreated',      (SELECT COUNT(*) FROM "institution_interests"),
    'openInterests',                    (SELECT COUNT(*) FROM "institution_interests" WHERE "closedAt" IS NULL),
    'closedInterests',                  (SELECT COUNT(*) FROM "institution_interests" WHERE "closedAt" IS NOT NULL),
    'leadApplicationsLinked',           (SELECT COUNT(*) FROM "lead_applications" WHERE "institutionInterestId" IS NOT NULL),
    'leadApplicationsUnlinked',         (SELECT COUNT(*) FROM "lead_applications" WHERE "institutionInterestId" IS NULL),
    'leadActivitiesLinked',             (SELECT COUNT(*) FROM "lead_activities" WHERE "institutionInterestId" IS NOT NULL),
    'leadActivitiesUnlinkedStudentLvl', (SELECT COUNT(*) FROM "lead_activities" WHERE "institutionInterestId" IS NULL),
    'leadChecklistItemsLinked',         (SELECT COUNT(*) FROM "lead_checklist_items" WHERE "institutionInterestId" IS NOT NULL),
    'leadChecklistItemsUnlinked',       (SELECT COUNT(*) FROM "lead_checklist_items" WHERE "institutionInterestId" IS NULL)
  ),
  NOW();

COMMIT;

-- ── Backout ────────────────────────────────────────────────────────────────
-- If Phase 1 needs to be reverted before the API cutover, drop in this order:
--   ALTER TABLE "lead_checklist_items" DROP COLUMN "institutionInterestId";
--   ALTER TABLE "lead_activities"      DROP COLUMN "institutionInterestId";
--   ALTER TABLE "lead_applications"    DROP COLUMN "institutionInterestId";
--   DROP TABLE "institution_interests";
--   DROP TYPE "EligibilityOutcome";
-- Because this migration is additive, backing out does not touch any existing
-- lead data. The rollback is safe until the Phase 2 cutover starts writing
-- authoritative pipeline state into institution_interests only.
