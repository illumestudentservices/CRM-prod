-- Phase 6 — Tasks Workflow Engine.
--
-- Turns the Task model into a workflow-linked object: every task now has a
-- typed parent (student, institution interest, event, etc.) unless it's
-- category=PERSONAL. TaskTemplate captures reusable recipes.
--
-- Existing task rows without a parent become category=OTHER — the constraint
-- is enforced at the API layer, not the DB, so migration doesn't have to
-- backfill an arbitrary parent for legacy data.

BEGIN;

-- ── 1. Enums ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaskCategory') THEN
    CREATE TYPE "TaskCategory" AS ENUM (
      'STUDENT_FOLLOW_UP', 'CLIENT_FOLLOW_UP', 'RECRUITMENT_PARTNER',
      'SCHOOL_ENGAGEMENT', 'EVENT_PREPARATION', 'EVENT_FOLLOW_UP',
      'MARKETING', 'ADMINISTRATION', 'REPORTING', 'COMPLIANCE',
      'INTERNAL', 'PERSONAL', 'OTHER'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaskParentType') THEN
    CREATE TYPE "TaskParentType" AS ENUM (
      'STUDENT', 'INSTITUTION_INTEREST', 'INSTITUTION',
      'RECRUITMENT_PARTNER', 'RECRUITMENT_EVENT', 'MARKETING_CAMPAIGN',
      'FIELD_OPERATION', 'MARKET', 'MONTHLY_REPORT',
      'RECRUITMENT_PLAN', 'VARIATION_REQUEST', 'TRAVEL_RECORD', 'CLIENT_ISSUE'
    );
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'TaskRecurrence') THEN
    CREATE TYPE "TaskRecurrence" AS ENUM (
      'ONE_OFF', 'WEEKLY', 'MONTHLY', 'QUARTERLY', 'ANNUAL'
    );
  END IF;
END $$;

-- ── 2. Extend TaskStatus enum ────────────────────────────────────────────
-- Postgres enum values are added, never removed, so this is safe. New values
-- are for spec compliance; existing values (TODO, DONE, etc.) stay valid so
-- no row rewrite is needed.
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'NOT_STARTED';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'WAITING_ON_EXTERNAL_PARTY';
ALTER TYPE "TaskStatus" ADD VALUE IF NOT EXISTS 'COMPLETED';

-- ── 3. Extend tasks table ────────────────────────────────────────────────
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "parentType"       "TaskParentType",
  ADD COLUMN IF NOT EXISTS "parentId"         TEXT,
  ADD COLUMN IF NOT EXISTS "category"         "TaskCategory" DEFAULT 'OTHER',
  ADD COLUMN IF NOT EXISTS "recurrence"       "TaskRecurrence" DEFAULT 'ONE_OFF',
  ADD COLUMN IF NOT EXISTS "templateId"       TEXT,
  ADD COLUMN IF NOT EXISTS "reminderDate"     TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "escalationDate"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "estimatedMinutes" INTEGER,
  ADD COLUMN IF NOT EXISTS "actualMinutes"    INTEGER;

CREATE INDEX IF NOT EXISTS "tasks_parent_idx"     ON "tasks"("parentType", "parentId");
CREATE INDEX IF NOT EXISTS "tasks_category_idx"   ON "tasks"("category");
CREATE INDEX IF NOT EXISTS "tasks_assignee_status_idx" ON "tasks"("assigneeId", "status");
CREATE INDEX IF NOT EXISTS "tasks_templateId_idx" ON "tasks"("templateId");

-- ── 4. Table: task_templates ─────────────────────────────────────────────
CREATE TABLE "task_templates" (
  "id"           TEXT PRIMARY KEY,
  "name"         TEXT NOT NULL UNIQUE,
  "description"  TEXT,
  "triggerEvent" TEXT,
  "parentType"   "TaskParentType",
  "category"     "TaskCategory" NOT NULL DEFAULT 'OTHER',
  "recurrence"   "TaskRecurrence" NOT NULL DEFAULT 'ONE_OFF',
  "itemsJson"    JSONB NOT NULL,
  "isActive"     BOOLEAN NOT NULL DEFAULT TRUE,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_templateId_fkey"
  FOREIGN KEY ("templateId") REFERENCES "task_templates"("id") ON DELETE SET NULL;

-- ── 5. Seed the templates the spec explicitly names ──────────────────────
INSERT INTO "task_templates" ("id", "name", "description", "triggerEvent", "parentType", "category", "recurrence", "itemsJson")
VALUES
  (gen_random_uuid(), 'School Visit', 'Standard prep + follow-up for a school visit',
    'FIELD_OP_SCHOOL_VISIT_CREATED', 'FIELD_OPERATION', 'SCHOOL_ENGAGEMENT', 'ONE_OFF',
    '[{"title":"Confirm appointment","offsetDays":-3},{"title":"Prepare materials","offsetDays":-1},{"title":"Upload visit summary","offsetDays":1},{"title":"Schedule follow-up","offsetDays":2}]'::jsonb),

  (gen_random_uuid(), 'Recruitment Event', 'Standard team preparation for an upcoming event',
    'EVENT_CONFIRMED', 'RECRUITMENT_EVENT', 'EVENT_PREPARATION', 'ONE_OFF',
    '[{"title":"Register team","offsetDays":-14},{"title":"Book travel","offsetDays":-14},{"title":"Prepare marketing material","offsetDays":-7},{"title":"Upload event report","offsetDays":3}]'::jsonb),

  (gen_random_uuid(), 'Client Onboarding', 'New institution client onboarding steps',
    'INSTITUTION_STATUS_ONBOARDING', 'INSTITUTION', 'CLIENT_FOLLOW_UP', 'ONE_OFF',
    '[{"title":"Introduce Account Manager","offsetDays":1},{"title":"Upload signed agreement","offsetDays":3},{"title":"Schedule kick-off meeting","offsetDays":7}]'::jsonb),

  (gen_random_uuid(), 'Weekly Activity Plan', 'ICR submits their weekly activity plan',
    NULL, NULL, 'REPORTING', 'WEEKLY',
    '[{"title":"Submit weekly activity plan","offsetDays":0}]'::jsonb),

  (gen_random_uuid(), 'Monthly Report', 'ICR submits their monthly recruitment report',
    NULL, 'MONTHLY_REPORT', 'REPORTING', 'MONTHLY',
    '[{"title":"Submit monthly report","offsetDays":0}]'::jsonb);

INSERT INTO "audit_logs" ("id", "userId", "action", "entity", "entityId", "changes", "createdAt")
VALUES (
  gen_random_uuid(), NULL, 'TASKS_WORKFLOW_COMPLETE',
  'System', '017-tasks-workflow',
  jsonb_build_object(
    'templatesSeeded', (SELECT COUNT(*) FROM "task_templates")
  ),
  NOW()
);

COMMIT;
