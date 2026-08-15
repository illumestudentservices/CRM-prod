-- 027 — Spec §15: make WITHDRAWN and VISA_REFUSED reachable.
--
-- Both stages have existed in the LeadStage enum since the spec §15 work, with
-- gate configs, labels and colours — but nothing could ever set them. The stage
-- route validates against ALL_STAGES (built from CLOSED_STAGES, which never
-- listed them) and the close route's discriminated union only accepted LOST,
-- DEFERRED and APPLICATION_REJECTED. They were dead values.
--
-- Adding them to CLOSED_STAGES alone would surface two buttons that POST to a
-- route which rejects them, so the close route needs real outcome fields first.
-- That is what this migration adds.
--
-- Withdrawal and visa refusal are deliberately NOT folded into `lostReason`.
-- LeadLostReason already has a VISA member, but "lost, because visa" and "visa
-- refused" are different events: the first is a competitive loss attributed to
-- visa difficulty, the second is a government decision on a specific
-- application, and only the second can be reapplied for. Collapsing them would
-- make it impossible to answer "what is our visa refusal rate".
--
-- RUN AS THE APP ROLE, not postgres:
--   PGPASSWORD=... psql -h 127.0.0.1 -U illume_user -d illume_crm \
--     -v ON_ERROR_STOP=1 -f 027-spec-15-close-outcomes.sql
-- ADD COLUMN inherits the table's existing owner so this one cannot orphan a
-- table the way 026 could, but the habit is worth keeping.

BEGIN;

-- ─── Withdrawal (student pulled out unilaterally) ───────────────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS "withdrawnReason" TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS "withdrawnNotes"  TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS "withdrawnDate"   TIMESTAMP(3);

-- ─── Visa refusal ───────────────────────────────────────────────────────────
ALTER TABLE leads ADD COLUMN IF NOT EXISTS "visaRefusalDate"   TIMESTAMP(3);
ALTER TABLE leads ADD COLUMN IF NOT EXISTS "visaRefusalReason" TEXT;
-- Three-valued on purpose, matching the marketingConsent precedent:
-- NULL = not asked, false = asked and not reapplying, true = reapplying.
-- Defaulting to false would assert something nobody said.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS "visaReapplying" BOOLEAN;

-- ─── Post-conditions ────────────────────────────────────────────────────────
-- Aborts rather than half-applying. The same shape as 026's guard.
DO $$
DECLARE
  missing TEXT;
  wrong_owner TEXT;
BEGIN
  SELECT string_agg(c.col, ', ')
    INTO missing
    FROM (VALUES
      ('withdrawnReason'), ('withdrawnNotes'), ('withdrawnDate'),
      ('visaRefusalDate'), ('visaRefusalReason'), ('visaReapplying')
    ) AS c(col)
   WHERE NOT EXISTS (
     SELECT 1 FROM information_schema.columns
      WHERE table_name = 'leads' AND column_name = c.col
   );

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'migration 027 incomplete — missing columns: %', missing;
  END IF;

  -- If this file were ever run as postgres against a fresh table, the owner
  -- would diverge from the rest of the schema and the app would get
  -- "permission denied". leads is pre-existing, so this only ever confirms.
  SELECT tableowner INTO wrong_owner FROM pg_tables WHERE tablename = 'leads';
  RAISE NOTICE 'migration 027 ok — leads owned by %', wrong_owner;
END $$;

COMMIT;
