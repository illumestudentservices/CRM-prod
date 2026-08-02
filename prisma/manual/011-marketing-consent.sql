-- Record whether a lead has agreed to receive commercial email.
--
-- Additive: two nullable columns, no back-fill, no existing row rewritten.
--
-- Deliberately NOT `BOOLEAN NOT NULL DEFAULT FALSE`. That would stamp all 52
-- existing leads as "declined", which is a claim nobody has any basis for —
-- they were never asked. NULL says exactly that, and leaves the existing rows
-- honestly marked as a gap to close rather than silently answered.
--
-- Under CASL the distinction matters in both directions: "never asked" is
-- someone you may still approach for permission, "declined" is a refusal you
-- have to honour and be able to evidence. Collapsing them loses the record of
-- which is which.

BEGIN;

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "marketingConsent" BOOLEAN;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "marketingConsentAt" TIMESTAMP(3);

-- Finding who still needs asking is the routine question this column creates,
-- and it is a scan of the whole table without an index.
CREATE INDEX IF NOT EXISTS "leads_marketingConsent_idx"
  ON "leads" ("marketingConsent");

COMMIT;
