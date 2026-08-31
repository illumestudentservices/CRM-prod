-- 037 — Student Pipeline: the columns and enum members spec pages 2-11 require
-- and this schema never had.
--
-- Closes the eight migration-dependent findings from the pages 2-11 conformance
-- check. Everything here is ADDITIVE: no column is dropped, no enum member is
-- removed, and no existing value is rewritten. The only structural change is to
-- the checklist uniqueness rule, and that is done by adding the replacement
-- indexes BEFORE removing the old constraint so there is never a window in
-- which duplicates could be inserted.
--
-- RUN AS THE APP ROLE, NOT postgres:
--   PGPASSWORD=... psql -h 127.0.0.1 -U illume_user -d illume_crm \
--     -v ON_ERROR_STOP=1 -f 037-pipeline-spec-gaps.sql
--
-- CREATE TABLE assigns ownership to whoever runs it and a role gets no
-- privileges on another role's objects, so running this as postgres would
-- produce objects the application cannot read — and the nastiest part is that
-- they are INVISIBLE in information_schema to the app role, so a "does it
-- exist?" check answers no while the same check as postgres answers yes.
--
-- ⚠ ALL IDENTIFIERS ARE camelCase AND MUST STAY QUOTED. Postgres folds
-- unquoted identifiers to lower case, and these tables predate any snake_case
-- convention. An unquoted "expectedDecisionDate" becomes expecteddecisiondate,
-- which migrates and indexes cleanly and then fails every query with
-- "The column `(not available)` does not exist" — naming neither the column nor
-- the table.
--
-- Idempotent: safe to re-run. Postgres has no CREATE TYPE IF NOT EXISTS and no
-- ADD CONSTRAINT IF NOT EXISTS, so those are wrapped in exception handlers;
-- ALTER TYPE ... ADD VALUE, columns and indexes all take IF NOT EXISTS.

\set ON_ERROR_STOP on

-- ─── Enum members ──────────────────────────────────────────────────────────
-- Deliberately OUTSIDE the transaction below. A value added by
-- ALTER TYPE ... ADD VALUE cannot be USED in the same transaction that adds it,
-- and keeping these separate means the column work stays atomic without that
-- restriction leaking into it. Each statement is individually idempotent.

-- Spec §8 "Application Statuses". These describe the INSTITUTION's position on
-- the application, which is what the specification asks for. The six
-- pre-existing members describe OUR position (accepted, withdrawn) and are kept
-- because removing an enum member requires a full table rewrite and nothing in
-- the codebase branches on any of these values — `status` is written and
-- displayed, never tested. `UNDER_REVIEW` is added as its own member rather
-- than reusing `AWAITING_DECISION`: that one is a stage name, and conflating
-- "the institution is reviewing it" with "our pipeline stage" is the confusion
-- this column exists to resolve.
ALTER TYPE "ApplicationStatus" ADD VALUE IF NOT EXISTS 'UNDER_REVIEW';
ALTER TYPE "ApplicationStatus" ADD VALUE IF NOT EXISTS 'ADDITIONAL_DOCUMENTS_REQUIRED';
ALTER TYPE "ApplicationStatus" ADD VALUE IF NOT EXISTS 'INTERVIEW_REQUIRED';
ALTER TYPE "ApplicationStatus" ADD VALUE IF NOT EXISTS 'ON_HOLD';
ALTER TYPE "ApplicationStatus" ADD VALUE IF NOT EXISTS 'DECISION_DELAYED';
ALTER TYPE "ApplicationStatus" ADD VALUE IF NOT EXISTS 'DECISION_RECEIVED';

-- Spec §10 lists five post-deposit workflows; four had categories and the
-- arrival checklist had none, so that workflow could not exist at all.
ALTER TYPE "LeadChecklistCategory" ADD VALUE IF NOT EXISTS 'ARRIVAL';

BEGIN;

-- ─── Spec §8 Stage 5 — Awaiting Decision required fields ───────────────────
-- Without these the Awaiting Decision gate had an empty required-field list,
-- and the automation "notify the assigned ICR when the expected decision date
-- passes" could not be built because there was no date to compare against.
ALTER TABLE "lead_applications"
  ADD COLUMN IF NOT EXISTS "expectedDecisionDate"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "lastInstitutionUpdateAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "outstandingRequirement" TEXT;

-- ─── Spec §10 — acceptance date ────────────────────────────────────────────
-- `acceptanceStatus` recorded WHAT was decided with no record of WHEN.
ALTER TABLE "lead_applications"
  ADD COLUMN IF NOT EXISTS "acceptanceDate" TIMESTAMP(3);

-- ─── Spec §7 — submission evidence ─────────────────────────────────────────
-- The specification requires the application reference "where available", with
-- submission confirmation or evidence as the alternative where no reference
-- number exists. With nowhere to record evidence, the gate had to require the
-- reference unconditionally, which blocked any application submitted by email
-- or to an institution that issues no reference. This column is that
-- alternative, so the rule can become conditional.
ALTER TABLE "lead_applications"
  ADD COLUMN IF NOT EXISTS "submissionEvidence" TEXT;

-- ─── Spec §1 / §4 — marketing campaign attribution ─────────────────────────
-- A Campaign model already existed and nothing linked a student to one, so
-- `campaigns.leadsGenerated` was a hand-typed integer rather than a count.
-- ON DELETE SET NULL: deleting a campaign must not delete students, and the
-- attribution being unknown is the correct outcome.
ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "campaignId" TEXT;

DO $$
BEGIN
  ALTER TABLE "leads"
    ADD CONSTRAINT "leads_campaignId_fkey"
    FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "leads_campaignId_idx" ON "leads"("campaignId");

-- ─── Spec §1 — communication preferences ───────────────────────────────────
-- Only marketing EMAIL consent existed, while the specification asks for
-- "consent and communication preferences" as a set.
--
-- All three consents are three-valued (NULL = never asked, false = asked and
-- declined), the same deliberate choice as `marketingConsent`: a plain boolean
-- defaulting to false collapses those two into one, and under CASL the
-- difference is the whole point — "never asked" is a gap to go and close,
-- "declined" is a record you must honour and be able to produce.
--
-- `doNotContact` is the exception and IS a plain boolean, because its absence
-- genuinely means "no such instruction has been given", which is the same thing
-- as false. It is a blanket override across every channel.
ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "phoneContactConsent"    BOOLEAN,
  ADD COLUMN IF NOT EXISTS "smsContactConsent"      BOOLEAN,
  ADD COLUMN IF NOT EXISTS "whatsappContactConsent" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "doNotContact"           BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "doNotContactAt"         TIMESTAMP(3);

-- Deliberately NO backfill of the three consent columns. Stamping the existing
-- rows "declined" would assert something untrue, and stamping them "granted"
-- would manufacture consent. Same reasoning as migration 011.

-- ─── Spec §6 — checklists are per journey, not per student ─────────────────
-- The uniqueness rule was ("leadId", category, label), i.e. per STUDENT, while
-- the specification and the column comment both describe programme-specific
-- lists belonging to one Institution Interest. The consequence was quiet: a
-- second journey reaching Qualified generated nothing, because createMany's
-- skipDuplicates matched the first journey's rows.
--
-- Replaced by TWO PARTIAL unique indexes rather than one four-column index,
-- because Postgres treats NULLs as distinct: a plain unique on
-- ("leadId", "institutionInterestId", category, label) would let unlimited
-- duplicate STUDENT-level rows (institutionInterestId IS NULL) accumulate,
-- which is a regression, not a fix.
--
-- Created BEFORE the old constraint is dropped. The NULL-side index is exactly
-- the old constraint restricted to student-level rows, so it cannot conflict
-- with existing data, and there is no moment when nothing is enforced.
CREATE UNIQUE INDEX IF NOT EXISTS "lead_checklist_items_interest_label_key"
  ON "lead_checklist_items" ("leadId", "institutionInterestId", "category", "label")
  WHERE "institutionInterestId" IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "lead_checklist_items_lead_label_key"
  ON "lead_checklist_items" ("leadId", "category", "label")
  WHERE "institutionInterestId" IS NULL;

-- Prisma's `@@unique` emits a bare CREATE UNIQUE INDEX, not a table
-- constraint, so this is an INDEX on both production and the mirror — verified,
-- not assumed. `ALTER TABLE ... DROP CONSTRAINT IF EXISTS` is therefore a
-- silent no-op against it, which would leave the old per-student rule in force
-- while this migration reported success. DROP INDEX is the one that does the
-- work; the DROP CONSTRAINT is kept only in case some environment has it in the
-- other shape.
DROP INDEX IF EXISTS "lead_checklist_items_leadId_category_label_key";

ALTER TABLE "lead_checklist_items"
  DROP CONSTRAINT IF EXISTS "lead_checklist_items_leadId_category_label_key";

-- ─── Post-conditions — abort rather than leave a half-applied migration ────
DO $$
DECLARE
  missing TEXT;
  owner_mismatch TEXT;
BEGIN
  -- Every column landed, with the exact camelCase name.
  SELECT string_agg(c.name, ', ') INTO missing
  FROM (VALUES
    ('lead_applications', 'expectedDecisionDate'),
    ('lead_applications', 'lastInstitutionUpdateAt'),
    ('lead_applications', 'outstandingRequirement'),
    ('lead_applications', 'acceptanceDate'),
    ('lead_applications', 'submissionEvidence'),
    ('leads', 'campaignId'),
    ('leads', 'phoneContactConsent'),
    ('leads', 'smsContactConsent'),
    ('leads', 'whatsappContactConsent'),
    ('leads', 'doNotContact'),
    ('leads', 'doNotContactAt')
  ) AS c(tbl, name)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = c.tbl AND column_name = c.name
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '037 aborted: columns missing or mis-cased: %', missing;
  END IF;

  -- Both enums gained every member.
  IF (SELECT count(*) FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'ApplicationStatus'
        AND e.enumlabel IN ('UNDER_REVIEW','ADDITIONAL_DOCUMENTS_REQUIRED',
                            'INTERVIEW_REQUIRED','ON_HOLD','DECISION_DELAYED',
                            'DECISION_RECEIVED')) <> 6 THEN
    RAISE EXCEPTION '037 aborted: ApplicationStatus did not gain all six members';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
                 WHERE t.typname = 'LeadChecklistCategory' AND e.enumlabel = 'ARRIVAL') THEN
    RAISE EXCEPTION '037 aborted: LeadChecklistCategory did not gain ARRIVAL';
  END IF;

  -- The checklist swap completed in both directions.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                 WHERE tablename = 'lead_checklist_items'
                   AND indexname = 'lead_checklist_items_interest_label_key') THEN
    RAISE EXCEPTION '037 aborted: per-journey checklist index missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes
                 WHERE tablename = 'lead_checklist_items'
                   AND indexname = 'lead_checklist_items_lead_label_key') THEN
    RAISE EXCEPTION '037 aborted: student-level checklist index missing';
  END IF;
  -- Checked against pg_indexes, NOT pg_constraint. The first version of this
  -- guard looked only at pg_constraint, so it passed while the old unique INDEX
  -- was still in place and the per-journey fix had silently not applied — a
  -- post-condition that proved nothing. Both catalogues are checked now.
  IF EXISTS (SELECT 1 FROM pg_indexes
             WHERE tablename = 'lead_checklist_items'
               AND indexname = 'lead_checklist_items_leadId_category_label_key') THEN
    RAISE EXCEPTION '037 aborted: old per-student checklist unique INDEX still present';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_constraint
             WHERE conname = 'lead_checklist_items_leadId_category_label_key') THEN
    RAISE EXCEPTION '037 aborted: old per-student checklist constraint still present';
  END IF;

  -- The FK exists, so campaign attribution cannot point at a deleted campaign.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'leads_campaignId_fkey') THEN
    RAISE EXCEPTION '037 aborted: leads_campaignId_fkey missing';
  END IF;

  -- Nothing this migration touched changed hands. Ownership is what makes a
  -- table readable by the application at all.
  SELECT string_agg(tablename, ', ') INTO owner_mismatch
  FROM pg_tables
  WHERE tablename IN ('leads', 'lead_applications', 'lead_checklist_items')
    AND tableowner <> (SELECT tableowner FROM pg_tables WHERE tablename = 'campaigns');
  IF owner_mismatch IS NOT NULL THEN
    RAISE EXCEPTION '037 aborted: owner mismatch on %  (run as the app role, not postgres)',
      owner_mismatch;
  END IF;

  RAISE NOTICE '037 post-conditions passed: 11 columns, 7 enum members, checklist uniqueness swapped, FK present.';
END $$;

COMMIT;
