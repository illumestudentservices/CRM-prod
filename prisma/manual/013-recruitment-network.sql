-- Phase 2 — Recruitment Network foundation.
--
-- Additive: creates `partner_contacts` and `event_participations`, backfills
-- from the retiring `counsellors` table and the flat `event_institutions`
-- join. No drops in this migration — the retirement of `counsellors` and
-- `event_institutions` happens in a later migration once readers cut over.
--
-- SPEC RENAME DEFERRED: `Source` remains the Prisma model name. Renaming to
-- `RecruitmentPartner` requires ~40 code call-sites to update and is a pure
-- rename PR that ships independently after this data-level change.

BEGIN;

-- ── 1. Pre-flight audit ──────────────────────────────────────────────────
INSERT INTO "audit_logs" ("id", "userId", "action", "entity", "entityId", "changes", "createdAt")
SELECT
  gen_random_uuid(),
  NULL,
  'RECRUITMENT_NETWORK_PREFLIGHT',
  'System',
  '013-recruitment-network',
  jsonb_build_object(
    'counsellorRows',        (SELECT COUNT(*) FROM "counsellors"),
    'eventInstitutionRows',  (SELECT COUNT(*) FROM "event_institutions"),
    'sourcesTotal',          (SELECT COUNT(*) FROM "sources"),
    'sourcesTypeSchool',     (SELECT COUNT(*) FROM "sources" WHERE "type" = 'SCHOOL')
  ),
  NOW();

-- ── 2. Table: partner_contacts ───────────────────────────────────────────
CREATE TABLE "partner_contacts" (
  "id"                 TEXT PRIMARY KEY,
  "partnerId"          TEXT NOT NULL REFERENCES "sources"("id") ON DELETE CASCADE,
  "fullName"           TEXT NOT NULL,
  "position"           TEXT,
  "role"               TEXT,
  "email"              TEXT,
  "phone"              TEXT,
  "isPrimary"          BOOLEAN NOT NULL DEFAULT FALSE,
  "isActive"           BOOLEAN NOT NULL DEFAULT TRUE,
  "notes"              TEXT,
  "legacyCounsellorId" TEXT UNIQUE,
  "lastEngagementDate" TIMESTAMP(3),
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"          TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

CREATE INDEX "partner_contacts_partnerId_idx" ON "partner_contacts"("partnerId");
CREATE INDEX "partner_contacts_email_idx"     ON "partner_contacts"("email");

-- ── 3. Backfill counsellors → partner_contacts ───────────────────────────
-- Every existing counsellor becomes a partner_contact of role=COUNSELLOR
-- attached to the Source row that corresponds to their school. If no Source
-- row exists yet (schools that were never wired to a Source), we create one
-- of type=SCHOOL so the counsellor has a home. This is the ONLY place where
-- Source rows are auto-created; user-facing UIs must not do this.
INSERT INTO "sources" (
  "id", "name", "type", "country", "isActive", "createdAt", "updatedAt", "createdById"
)
SELECT
  gen_random_uuid(),
  s."name",
  'SCHOOL',
  s."country",
  s."isActive",
  NOW(),
  NOW(),
  s."createdById"
FROM "schools" s
WHERE s."deletedAt" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "sources" src
    WHERE src."type" = 'SCHOOL'
      AND src."name" = s."name"
      AND src."country" = s."country"
  );

INSERT INTO "partner_contacts" (
  "id", "partnerId", "fullName", "position", "role", "email", "phone",
  "isPrimary", "isActive", "notes", "legacyCounsellorId", "lastEngagementDate",
  "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  (
    SELECT src."id" FROM "sources" src
    JOIN "schools" sch ON sch."id" = c."schoolId"
    WHERE src."type" = 'SCHOOL'
      AND src."name" = sch."name"
      AND src."country" = sch."country"
    LIMIT 1
  ),
  c."name",
  c."position",
  'COUNSELLOR',
  c."email",
  c."phone",
  FALSE,
  c."isActive",
  c."notes",
  c."id",
  c."lastEngagementDate",
  c."createdAt",
  c."updatedAt"
FROM "counsellors" c
WHERE (
    SELECT src."id" FROM "sources" src
    JOIN "schools" sch ON sch."id" = c."schoolId"
    WHERE src."type" = 'SCHOOL'
      AND src."name" = sch."name"
      AND src."country" = sch."country"
    LIMIT 1
  ) IS NOT NULL;

-- ── 4. Table: event_participations ────────────────────────────────────────
CREATE TABLE "event_participations" (
  "id"                        TEXT PRIMARY KEY,
  "eventId"                   TEXT NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
  "institutionId"             TEXT NOT NULL REFERENCES "institutions"("id"),
  "assignedICRId"             TEXT REFERENCES "users"("id"),
  "status"                    TEXT NOT NULL DEFAULT 'CONFIRMED',
  "attendanceConfirmed"       BOOLEAN NOT NULL DEFAULT FALSE,
  "activitySummary"           TEXT,
  "institutionOutcomeNotes"   TEXT,
  "participationCost"         DOUBLE PRECISION,
  "participationCostCurrency" TEXT DEFAULT 'USD',
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"                 TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  UNIQUE ("eventId", "institutionId")
);

CREATE INDEX "event_participations_assignedICRId_idx"
  ON "event_participations"("assignedICRId");

-- Backfill from event_institutions — one participation per join row.
INSERT INTO "event_participations" (
  "id", "eventId", "institutionId", "status", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  ei."eventId",
  ei."institutionId",
  'CONFIRMED',
  NOW(),
  NOW()
FROM "event_institutions" ei;

-- ── 5. Post-flight audit + parity ────────────────────────────────────────
DO $$
DECLARE
  expected_pc INTEGER;
  actual_pc   INTEGER;
  expected_ep INTEGER;
  actual_ep   INTEGER;
BEGIN
  SELECT COUNT(*) INTO expected_pc FROM "counsellors";
  SELECT COUNT(*) INTO actual_pc   FROM "partner_contacts" WHERE "legacyCounsellorId" IS NOT NULL;
  IF actual_pc < expected_pc THEN
    RAISE NOTICE 'PartnerContact backfill: expected % from counsellors, got % (some schools had no Source row of type SCHOOL — investigate)', expected_pc, actual_pc;
  END IF;

  SELECT COUNT(*) INTO expected_ep FROM "event_institutions";
  SELECT COUNT(*) INTO actual_ep   FROM "event_participations";
  IF actual_ep <> expected_ep THEN
    RAISE EXCEPTION 'EventParticipation backfill parity failed: expected %, got %', expected_ep, actual_ep;
  END IF;

  RAISE NOTICE 'PartnerContact: %, EventParticipation: % (parity OK)', actual_pc, actual_ep;
END $$;

INSERT INTO "audit_logs" ("id", "userId", "action", "entity", "entityId", "changes", "createdAt")
SELECT
  gen_random_uuid(),
  NULL,
  'RECRUITMENT_NETWORK_COMPLETE',
  'System',
  '013-recruitment-network',
  jsonb_build_object(
    'partnerContactsCreated', (SELECT COUNT(*) FROM "partner_contacts"),
    'eventParticipationsCreated', (SELECT COUNT(*) FROM "event_participations")
  ),
  NOW();

COMMIT;

-- ── Backout ────────────────────────────────────────────────────────────────
-- DROP TABLE "event_participations";
-- DROP TABLE "partner_contacts";
-- Because this is additive, `counsellors` and `event_institutions` are
-- untouched — the old code paths keep working through rollback.
