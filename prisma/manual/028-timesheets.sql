-- 028 — Timesheets (spec §Timesheets).
--
-- Structured time recording for designated staff, initially Finance. Owned by
-- the HR & ERP module.
--
-- Supersedes the `worklogs` table, which had NO create/update path anywhere in
-- the application and zero rows — a read-only tab with no way to put data in
-- it. It is left in place (the employee detail page still reads it) but must
-- not gain writers. Timesheets own employee time recording from here.
--
-- Note on defaults: `timesheetRequired` defaults to FALSE. The spec is explicit
-- that ICRs must not be required to submit timesheets unless it is switched on
-- for them individually, and a TRUE default would immediately generate periods,
-- reminders and overdue chases for every employee in the business.
--
-- RUN AS THE APP ROLE, not postgres. CREATE TABLE assigns ownership to whoever
-- runs it, and a role has no privileges on another role's table — running this
-- as postgres produces tables the app cannot read, and which are INVISIBLE to
-- it in information_schema. See the post-condition guard at the bottom.
--
--   PGPASSWORD=... psql -h 127.0.0.1 -U illume_user -d illume_crm \
--     -v ON_ERROR_STOP=1 -f 028-timesheets.sql

BEGIN;

-- ─── Enums ──────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "TimesheetFrequency" AS ENUM ('WEEKLY', 'BIWEEKLY', 'MONTHLY');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "TimesheetStatus" AS ENUM
    ('DRAFT', 'SUBMITTED', 'MANAGER_REVIEW', 'AMENDMENTS_REQUIRED', 'APPROVED');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE "WorkCategory" AS ENUM
    ('CLIENT_WORK', 'INTERNAL_PROJECT', 'ADMINISTRATION', 'FINANCE_OPERATIONS',
     'MEETINGS', 'TRAINING', 'RECRUITMENT_SUPPORT', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ─── Employee configuration ─────────────────────────────────────────────────
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "timesheetRequired"    BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "timesheetFrequency"   "TimesheetFrequency";
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "standardWorkingHours" DOUBLE PRECISION;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "timesheetApproverId"  TEXT;
ALTER TABLE employees ADD COLUMN IF NOT EXISTS "costCentre"           TEXT;

DO $$ BEGIN
  ALTER TABLE employees
    ADD CONSTRAINT "employees_timesheetApproverId_fkey"
    FOREIGN KEY ("timesheetApproverId") REFERENCES employees(id)
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "employees_timesheetApproverId_idx" ON employees("timesheetApproverId");

-- ─── Timesheets ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS timesheets (
  id                    TEXT PRIMARY KEY,
  "employeeId"          TEXT NOT NULL,
  frequency             "TimesheetFrequency" NOT NULL,
  "periodStart"         DATE NOT NULL,
  "periodEnd"           DATE NOT NULL,
  "expectedHours"       DOUBLE PRECISION NOT NULL DEFAULT 0,
  "loggedHours"         DOUBLE PRECISION NOT NULL DEFAULT 0,
  "approvedLeaveHours"  DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalAccountedHours" DOUBLE PRECISION NOT NULL DEFAULT 0,
  variance              DOUBLE PRECISION NOT NULL DEFAULT 0,
  status                "TimesheetStatus" NOT NULL DEFAULT 'DRAFT',
  "submittedAt"         TIMESTAMP(3),
  "approvedAt"          TIMESTAMP(3),
  "approverId"          TEXT,
  "reviewNotes"         TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "timesheets_employeeId_fkey" FOREIGN KEY ("employeeId")
    REFERENCES employees(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "timesheets_approverId_fkey" FOREIGN KEY ("approverId")
    REFERENCES employees(id) ON DELETE SET NULL ON UPDATE CASCADE
);

-- One sheet per employee per period. This is also the idempotency key for the
-- period generator, so a cron that fires twice cannot issue duplicates.
CREATE UNIQUE INDEX IF NOT EXISTS "timesheets_employeeId_periodStart_key"
  ON timesheets("employeeId", "periodStart");
CREATE INDEX IF NOT EXISTS "timesheets_status_periodEnd_idx" ON timesheets(status, "periodEnd");
CREATE INDEX IF NOT EXISTS "timesheets_employeeId_periodStart_idx" ON timesheets("employeeId", "periodStart");

-- ─── Entries ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS timesheet_entries (
  id              TEXT PRIMARY KEY,
  "timesheetId"   TEXT NOT NULL,
  date            DATE NOT NULL,
  "workCategory"  "WorkCategory" NOT NULL,
  description     TEXT NOT NULL,
  hours           DOUBLE PRECISION NOT NULL,
  notes           TEXT,
  "institutionId" TEXT,
  "departmentId"  TEXT,
  "parentType"    "TaskParentType",
  "parentId"      TEXT,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "timesheet_entries_timesheetId_fkey" FOREIGN KEY ("timesheetId")
    REFERENCES timesheets(id) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "timesheet_entries_institutionId_fkey" FOREIGN KEY ("institutionId")
    REFERENCES institutions(id) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "timesheet_entries_departmentId_fkey" FOREIGN KEY ("departmentId")
    REFERENCES departments(id) ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "timesheet_entries_timesheetId_idx" ON timesheet_entries("timesheetId");
CREATE INDEX IF NOT EXISTS "timesheet_entries_date_idx" ON timesheet_entries(date);
CREATE INDEX IF NOT EXISTS "timesheet_entries_workCategory_idx" ON timesheet_entries("workCategory");
CREATE INDEX IF NOT EXISTS "timesheet_entries_institutionId_idx" ON timesheet_entries("institutionId");

-- ─── Version and approval history ───────────────────────────────────────────
-- Append-only. Spec: "Maintain complete version and approval history."
-- actorId is nullable so the history outlives a deleted account, the same
-- reasoning as audit_logs.userId.
CREATE TABLE IF NOT EXISTS timesheet_events (
  id            TEXT PRIMARY KEY,
  "timesheetId" TEXT NOT NULL,
  action        TEXT NOT NULL,
  "fromStatus"  "TimesheetStatus",
  "toStatus"    "TimesheetStatus",
  "actorId"     TEXT,
  notes         TEXT,
  snapshot      JSONB,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "timesheet_events_timesheetId_fkey" FOREIGN KEY ("timesheetId")
    REFERENCES timesheets(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "timesheet_events_timesheetId_createdAt_idx"
  ON timesheet_events("timesheetId", "createdAt");

-- ─── Post-conditions ────────────────────────────────────────────────────────
-- Aborts rather than half-applying, and proves the new objects are owned by the
-- same role as the rest of the schema. Copied from migration 026's guard, which
-- exists because a migration run as postgres silently produced tables the app
-- could neither read nor even see in information_schema.
DO $$
DECLARE
  ref_owner  TEXT;
  bad        TEXT;
  missing    TEXT;
BEGIN
  SELECT tableowner INTO ref_owner FROM pg_tables WHERE tablename = 'employees';

  SELECT string_agg(t.tbl, ', ') INTO missing
    FROM (VALUES ('timesheets'), ('timesheet_entries'), ('timesheet_events')) AS t(tbl)
   WHERE NOT EXISTS (SELECT 1 FROM pg_tables WHERE tablename = t.tbl);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'migration 028 incomplete — missing tables: %', missing;
  END IF;

  SELECT string_agg(tablename || ' owned by ' || tableowner, ', ') INTO bad
    FROM pg_tables
   WHERE tablename IN ('timesheets', 'timesheet_entries', 'timesheet_events')
     AND tableowner <> ref_owner;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'migration 028 ownership mismatch (employees is owned by %): %', ref_owner, bad;
  END IF;

  SELECT string_agg(t.col, ', ') INTO missing
    FROM (VALUES ('timesheetRequired'), ('timesheetFrequency'), ('standardWorkingHours'),
                 ('timesheetApproverId'), ('costCentre')) AS t(col)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_name = 'employees' AND column_name = t.col
   );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'migration 028 incomplete — missing employee columns: %', missing;
  END IF;

  RAISE NOTICE 'migration 028 ok — timesheet tables and columns created, owned by %', ref_owner;
END $$;

COMMIT;
