-- New-account requests raised by managers for IT to action.
--
-- Purely additive: a new table and a new enum, no changes to existing columns,
-- so there is nothing to back-fill and nothing that can fail on existing rows.

BEGIN;

DO $$ BEGIN
  CREATE TYPE "AccountRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "account_requests" (
  "id"             TEXT NOT NULL,
  "status"         "AccountRequestStatus" NOT NULL DEFAULT 'PENDING',
  "fullName"       TEXT NOT NULL,
  "email"          TEXT NOT NULL,
  "jobTitle"       TEXT NOT NULL,
  "requestedRole"  "Role" NOT NULL,
  "employmentType" "EmploymentType" NOT NULL DEFAULT 'FULL_TIME',
  "startDate"      TIMESTAMP(3) NOT NULL,
  "gender"         "Gender",
  "phone"          TEXT,
  "justification"  TEXT NOT NULL,
  "regionId"       TEXT,
  "departmentId"   TEXT,
  "requestedById"  TEXT NOT NULL,
  "reviewedById"   TEXT,
  "reviewedAt"     TIMESTAMP(3),
  "reviewNotes"    TEXT,
  "fulfilledAt"    TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "account_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "account_requests_status_createdAt_idx"
  ON "account_requests" ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "account_requests_requestedById_idx"
  ON "account_requests" ("requestedById");

-- The requester cascades: if their account goes, their draft requests go with
-- it. The reviewer is SET NULL, so a decision survives the reviewer leaving —
-- same reasoning as audit_logs.
ALTER TABLE "account_requests"
  DROP CONSTRAINT IF EXISTS "account_requests_requestedById_fkey";
ALTER TABLE "account_requests"
  ADD CONSTRAINT "account_requests_requestedById_fkey"
  FOREIGN KEY ("requestedById") REFERENCES "users"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "account_requests"
  DROP CONSTRAINT IF EXISTS "account_requests_reviewedById_fkey";
ALTER TABLE "account_requests"
  ADD CONSTRAINT "account_requests_reviewedById_fkey"
  FOREIGN KEY ("reviewedById") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "account_requests"
  DROP CONSTRAINT IF EXISTS "account_requests_regionId_fkey";
ALTER TABLE "account_requests"
  ADD CONSTRAINT "account_requests_regionId_fkey"
  FOREIGN KEY ("regionId") REFERENCES "regions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "account_requests"
  DROP CONSTRAINT IF EXISTS "account_requests_departmentId_fkey";
ALTER TABLE "account_requests"
  ADD CONSTRAINT "account_requests_departmentId_fkey"
  FOREIGN KEY ("departmentId") REFERENCES "departments"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
