-- Lead pipeline: replace the LeadStage enum.
--
-- Run BEFORE `prisma db push`. Prisma's own diff would try to drop and recreate
-- the type, which fails on the dependent columns (leads.stage,
-- forecast_entries.stage) and on the column default.
--
-- Rather than RENAME VALUE + ADD VALUE + DROP (Postgres has no DROP VALUE), we
-- build the target type and swap both columns across in one transaction, doing
-- the value mapping in the USING clause. Atomic, and it cannot leave a column
-- pointing at a half-migrated type.
--
-- Mapping:
--   NEW                -> NEW_LEAD
--   CONTACTED          -> CONTACTED
--   APPLICATION_SENT   -> APPLICATION_SUBMITTED
--   DOCUMENTS_RECEIVED -> QUALIFIED              (per product decision)
--   OFFER_ISSUED       -> OFFER_RECEIVED
--   ENROLLED           -> ENROLLED
--   DEFERRED           -> DEFERRED
--   REJECTED           -> APPLICATION_REJECTED
--   LOST               -> LOST

BEGIN;

-- Value order is significant: GET /api/leads?sortBy=stage sorts by enum
-- ordinal, so declaration order is the funnel order.
CREATE TYPE "LeadStage_new" AS ENUM (
  'NEW_LEAD',
  'CONTACTED',
  'QUALIFIED',
  'APPLICATION_SUBMITTED',
  'AWAITING_DECISION',
  'OFFER_RECEIVED',
  'DEPOSIT_PAID',
  'ENROLLED',
  'LOST',
  'DEFERRED',
  'APPLICATION_REJECTED'
);

-- The default references the old type and blocks the swap.
ALTER TABLE "leads" ALTER COLUMN "stage" DROP DEFAULT;

-- forecast_entries.stage uses the same enum. Missing it would leave a column
-- typed against a type we are about to drop.
ALTER TABLE "leads"
  ALTER COLUMN "stage" TYPE "LeadStage_new"
  USING (
    CASE "stage"::text
      WHEN 'NEW'                THEN 'NEW_LEAD'
      WHEN 'APPLICATION_SENT'   THEN 'APPLICATION_SUBMITTED'
      WHEN 'DOCUMENTS_RECEIVED' THEN 'QUALIFIED'
      WHEN 'OFFER_ISSUED'       THEN 'OFFER_RECEIVED'
      WHEN 'REJECTED'           THEN 'APPLICATION_REJECTED'
      ELSE "stage"::text
    END
  )::"LeadStage_new";

ALTER TABLE "forecast_entries"
  ALTER COLUMN "stage" TYPE "LeadStage_new"
  USING (
    CASE "stage"::text
      WHEN 'NEW'                THEN 'NEW_LEAD'
      WHEN 'APPLICATION_SENT'   THEN 'APPLICATION_SUBMITTED'
      WHEN 'DOCUMENTS_RECEIVED' THEN 'QUALIFIED'
      WHEN 'OFFER_ISSUED'       THEN 'OFFER_RECEIVED'
      WHEN 'REJECTED'           THEN 'APPLICATION_REJECTED'
      ELSE "stage"::text
    END
  )::"LeadStage_new";

DROP TYPE "LeadStage";
ALTER TYPE "LeadStage_new" RENAME TO "LeadStage";

ALTER TABLE "leads" ALTER COLUMN "stage" SET DEFAULT 'NEW_LEAD';

COMMIT;
