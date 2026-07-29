-- Reduce LeaveType to the four the business operates, and add Employee.gender.
--
-- Postgres cannot drop a value from an enum, so the type is rebuilt and
-- swapped. Both dependent columns (leave_requests.leaveType and
-- leave_balances.leaveType) must move in the same statement pair or the swap
-- fails on the one left behind.
--
-- ANNUAL becomes VACATION_PAID. UNPAID and COMP_OFF are removed; the only rows
-- carrying them are two cancelled test requests created on 2026-07-28 against
-- the disabled demo account icr@illume.edu, so they are deleted rather than
-- remapped — there is no honest target to remap an unpaid request to.

BEGIN;

-- Gender, nullable: unknown for everyone hired before this existed, and a null
-- deliberately blocks the parental leave types until HR fills it in.
DO $$ BEGIN
  CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "gender" "Gender";

-- Remove rows that reference values about to disappear. Verified before
-- writing this: both are CANCELLED, both belong to a disabled seed account.
DELETE FROM "leave_requests" WHERE "leaveType" IN ('UNPAID', 'COMP_OFF');
DELETE FROM "leave_balances" WHERE "leaveType" IN ('UNPAID', 'COMP_OFF');

CREATE TYPE "LeaveType_new" AS ENUM ('VACATION_PAID', 'SICK', 'MATERNITY', 'PATERNITY');

ALTER TABLE "leave_requests"
  ALTER COLUMN "leaveType" TYPE "LeaveType_new"
  USING (CASE "leaveType"::text
           WHEN 'ANNUAL' THEN 'VACATION_PAID'
           ELSE "leaveType"::text
         END)::"LeaveType_new";

ALTER TABLE "leave_balances"
  ALTER COLUMN "leaveType" TYPE "LeaveType_new"
  USING (CASE "leaveType"::text
           WHEN 'ANNUAL' THEN 'VACATION_PAID'
           ELSE "leaveType"::text
         END)::"LeaveType_new";

DROP TYPE "LeaveType";
ALTER TYPE "LeaveType_new" RENAME TO "LeaveType";

COMMIT;
