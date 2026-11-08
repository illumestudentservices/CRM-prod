-- 047 — Leave carry-over (controlled exception to "paid leave does not carry forward")
--
-- VACATION_PAID normally resets on 31 December and is NOT carried forward. This
-- table records a one-off, capped carry-over of UNUSED paid-leave days from one
-- year into an early booking window of the next (introduced for the SEA region:
-- up to 5 unused 2026 days, bookable for a Jan–Feb 2027 holiday).
--
-- Mechanics (see the LeaveCarryover Prisma model, @@map("leave_carryovers")):
--   grant  — move `days` from the fromYear balance to the toYear balance
--            (leave_balances.adjustmentDays: -days on fromYear, +days on toYear).
--   expire — after `bookingDeadline`, credit `bookedDays` (what was actually
--            booked inside [windowStart, windowEnd]) and ERASE the rest from the
--            toYear balance. "Use it or lose it."
--
-- Deploy pattern: run on TEST (illume_crm_test) first, then PROD (illume_crm).
-- Plain statements (no new enum value), safe to re-run.

CREATE TABLE IF NOT EXISTS "leave_carryovers" (
  "id"              TEXT PRIMARY KEY,
  "employeeId"      TEXT NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "leaveType"       "LeaveType" NOT NULL DEFAULT 'VACATION_PAID',
  "fromYear"        INTEGER NOT NULL,
  "toYear"          INTEGER NOT NULL,
  "days"            DOUBLE PRECISION NOT NULL,
  "windowStart"     DATE NOT NULL,
  "windowEnd"       DATE NOT NULL,
  "bookingDeadline" DATE NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'ACTIVE',
  "bookedDays"      DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expiredAt"       TIMESTAMP(3),
  "grantedBy"       TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- One carry-over per employee / leave type / year pair makes the grant idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS "leave_carryovers_emp_type_years_key"
  ON "leave_carryovers" ("employeeId", "leaveType", "fromYear", "toYear");

-- The expire job scans for ACTIVE rows past their deadline.
CREATE INDEX IF NOT EXISTS "leave_carryovers_status_deadline_idx"
  ON "leave_carryovers" ("status", "bookingDeadline");

-- Ownership: the app connects as the role that owns the other tables
-- (illume_test on test, illume on prod). Hand this table to that same role so
-- the app has full access and prod/test stay consistent — otherwise 42501.
DO $$
DECLARE app_role text;
BEGIN
  SELECT tableowner INTO app_role FROM pg_tables WHERE tablename = 'leave_requests';
  IF app_role IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "leave_carryovers" OWNER TO %I', app_role);
  END IF;
END $$;
