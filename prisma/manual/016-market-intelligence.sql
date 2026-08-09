-- Phase 5 — Market Intelligence.
--
-- Adds priority/potential classification and the ICR→RM suggestion workflow.
-- `markets.healthScore` is DEPRECATED but NOT dropped in this pass — it
-- stays nullable, readers get one release cycle to switch to
-- (priority, potential) before the column disappears in a later migration.

BEGIN;

-- ── 1. Enums ─────────────────────────────────────────────────────────────
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MarketPriority') THEN
    CREATE TYPE "MarketPriority" AS ENUM ('HIGH', 'MEDIUM', 'LOW');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MarketPotential') THEN
    CREATE TYPE "MarketPotential" AS ENUM ('EMERGING', 'GROWING', 'STABLE', 'DECLINING');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MarketUpdateStatus') THEN
    CREATE TYPE "MarketUpdateStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'EDITED');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'MarketUpdateKind') THEN
    CREATE TYPE "MarketUpdateKind" AS ENUM (
      'VISA_CHANGE', 'SCHOOL_UPDATE', 'COMPETITOR_OBSERVATION',
      'NEW_OPPORTUNITY', 'GOVERNMENT_ANNOUNCEMENT', 'OTHER'
    );
  END IF;
END $$;

-- ── 2. Extend markets table ──────────────────────────────────────────────
ALTER TABLE "markets"
  ADD COLUMN IF NOT EXISTS "priority"                 "MarketPriority"  DEFAULT 'MEDIUM',
  ADD COLUMN IF NOT EXISTS "potential"                "MarketPotential" DEFAULT 'STABLE',
  ADD COLUMN IF NOT EXISTS "overview"                 TEXT,
  ADD COLUMN IF NOT EXISTS "strategicRecommendations" TEXT,
  ADD COLUMN IF NOT EXISTS "regionalManagerId"        TEXT REFERENCES "users"("id");

CREATE INDEX IF NOT EXISTS "markets_priority_idx"  ON "markets"("priority");
CREATE INDEX IF NOT EXISTS "markets_potential_idx" ON "markets"("potential");

-- Best-effort backfill: if healthScore was populated, translate it into
-- priority so RMs don't start with everything at Medium.
UPDATE "markets"
SET "priority" = CASE
  WHEN "healthScore" IS NULL      THEN 'MEDIUM'::"MarketPriority"
  WHEN "healthScore" >= 75        THEN 'HIGH'::"MarketPriority"
  WHEN "healthScore" >= 40        THEN 'MEDIUM'::"MarketPriority"
  ELSE                                 'LOW'::"MarketPriority"
END
WHERE "priority" IS NULL;

-- ── 3. Table: market_update_suggestions ──────────────────────────────────
CREATE TABLE "market_update_suggestions" (
  "id"           TEXT PRIMARY KEY,
  "marketId"     TEXT NOT NULL REFERENCES "markets"("id") ON DELETE CASCADE,
  "kind"         "MarketUpdateKind" NOT NULL,
  "originalText" TEXT NOT NULL,
  "editedText"   TEXT,
  "submittedById" TEXT NOT NULL REFERENCES "users"("id"),
  "submittedAt"  TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "status"       "MarketUpdateStatus" NOT NULL DEFAULT 'PENDING',
  "reviewedById" TEXT REFERENCES "users"("id"),
  "reviewedAt"   TIMESTAMP(3),
  "reviewNotes"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW(),
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT NOW()
);
CREATE INDEX "market_update_suggestions_market_status_idx" ON "market_update_suggestions"("marketId", "status");
CREATE INDEX "market_update_suggestions_submittedById_idx" ON "market_update_suggestions"("submittedById");

INSERT INTO "audit_logs" ("id", "userId", "action", "entity", "entityId", "changes", "createdAt")
VALUES (
  gen_random_uuid(), NULL, 'MARKET_INTELLIGENCE_COMPLETE',
  'System', '016-market-intelligence',
  jsonb_build_object(
    'marketsWithPriority', (SELECT COUNT(*) FROM "markets" WHERE "priority" IS NOT NULL)
  ),
  NOW()
);

COMMIT;
