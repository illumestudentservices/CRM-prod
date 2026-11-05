-- 045 — In-lieu earn requests can span a date range.
--
-- Staff may log extra hours worked across several days (e.g. a weekend event),
-- so add an optional end date. Weekends/holidays are allowed as worked days —
-- the earn flow has no working-day restriction (unlike booking time off).
--
-- Run on TEST (illume_crm_test) then PROD (illume_crm). Idempotent.

ALTER TABLE "in_lieu_requests" ADD COLUMN IF NOT EXISTS "workDateEnd" TIMESTAMP(3);
