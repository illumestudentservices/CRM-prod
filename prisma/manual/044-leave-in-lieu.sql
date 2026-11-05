-- 044 — Leave in lieu (time off in lieu of extra hours worked)
--
-- Adds a new leave type and a request table for the "earn" flow:
--   * staff submit extra hours worked -> manager approves -> days are credited
--     to their IN_LIEU leave balance (leave_balances.adjustmentDays) for the year
--   * they then book the time off as an ordinary IN_LIEU leave_request
--
-- The balance resets each year because entitlement is derived per calendar-year
-- leave_balances row (adjustmentDays), and a new year starts at 0.
--
-- Deploy pattern: run on TEST (illume_crm_test) first, then PROD (illume_crm).
-- ALTER TYPE ... ADD VALUE cannot run inside a transaction block on older
-- PostgreSQL, so run these statements directly (not wrapped in BEGIN/COMMIT).

-- 1. New enum value. IF NOT EXISTS makes the script safe to re-run.
ALTER TYPE "LeaveType" ADD VALUE IF NOT EXISTS 'IN_LIEU';

-- 2. The earn-request table. Mirrors the InLieuRequest Prisma model
--    (@@map("in_lieu_requests")).
CREATE TABLE IF NOT EXISTS "in_lieu_requests" (
  "id"            TEXT PRIMARY KEY,
  "employeeId"    TEXT NOT NULL REFERENCES "employees"("id") ON DELETE CASCADE,
  "workDate"      TIMESTAMP(3) NOT NULL,
  "hours"         DOUBLE PRECISION NOT NULL,
  "days"          DOUBLE PRECISION NOT NULL,
  "reason"        TEXT,
  "status"        "LeaveStatus" NOT NULL DEFAULT 'PENDING',
  "approvedById"  TEXT,
  "approvedAt"    TIMESTAMP(3),
  "rejectionNote" TEXT,
  "year"          INTEGER NOT NULL,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS "in_lieu_requests_employeeId_status_idx"
  ON "in_lieu_requests" ("employeeId", "status");

-- 3. Ownership. The table above is created by whoever runs this script (often a
--    superuser), but the application connects as the role that owns the other
--    tables (illume_test on test, illume on prod) and would otherwise get
--    "permission denied". Hand the table to that same role, whatever it is in
--    this database, so the app has full access and prod/test stay consistent.
DO $$
DECLARE app_role text;
BEGIN
  SELECT tableowner INTO app_role FROM pg_tables WHERE tablename = 'leave_requests';
  IF app_role IS NOT NULL THEN
    EXECUTE format('ALTER TABLE "in_lieu_requests" OWNER TO %I', app_role);
  END IF;
END $$;
