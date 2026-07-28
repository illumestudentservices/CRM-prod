-- Lead pipeline: backfill the new columns.
--
-- Run AFTER `prisma db push` has created them.
--
-- Two things matter here, and both are easy to skip with bad consequences:
--
-- 1. `stageEnteredAt` is load-bearing for correctness, not just for the
--    "Days in Current Stage" badge. The stage gate only counts activities
--    completed at or after it, so leaving it at the row's insert-time default
--    would make every historical lead's gate behave unpredictably.
--
-- 2. The inactivity flags are set to now() deliberately. No ENGAGEMENT
--    activities exist yet — the activity table has only ever held audit rows —
--    so on its first run the automation cron would find every lead in the
--    database "inactive for 21+ days" and fire a reminder AND a manager
--    escalation for all of them. Pre-setting the flags suppresses that
--    one-off backlog; they clear naturally as real engagements are logged.

BEGIN;

UPDATE "leads"
SET "stageEnteredAt" = COALESCE("lastProgressedAt", "updatedAt", "createdAt")
WHERE "stageEnteredAt" IS NULL
   OR "stageEnteredAt" > COALESCE("lastProgressedAt", "updatedAt", "createdAt");

UPDATE "leads"
SET "inactivity14NotifiedAt" = NOW(),
    "inactivity21NotifiedAt" = NOW()
WHERE "deletedAt" IS NULL;

-- Enrolled leads predate the conversion flags; set them so conversion
-- reporting is consistent from day one rather than only counting new arrivals.
UPDATE "leads"
SET "isConverted" = TRUE,
    "convertedAt" = COALESCE("lastProgressedAt", "updatedAt")
WHERE "stage" = 'ENROLLED' AND "isConverted" = FALSE;

COMMIT;
