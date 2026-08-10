-- Polymorphic attachments (Phase 8). Any parent record can own attachment
-- rows via (parentType, parentId). Uploads reuse the H-4 MIME + filename
-- allowlist so a stored bad row can't be served as HTML/SVG.
--
-- Additive only: existing purpose-built tables (kb_attachments,
-- contract_attachments, lead_documents, institution_documents,
-- employee_documents) are untouched.
--
-- Run before deploying the code that references db.attachment.

BEGIN;

DO $$ BEGIN
  CREATE TYPE "AttachmentParentType" AS ENUM (
    'TASK',
    'ACTIVITY',
    'CLIENT_ISSUE',
    'RECRUITMENT_EVENT',
    'MARKETING_CAMPAIGN',
    'RECRUITMENT_PARTNER',
    'MARKET_UPDATE_SUGGESTION',
    'RECRUITMENT_PLAN',
    'VARIATION_REQUEST',
    'MONTHLY_REPORT',
    'ENGAGEMENT_LOG',
    'LEAD_NOTE',
    'LEAD',
    'INSTITUTION_INTEREST',
    'RISK_REGISTER',
    'COMPLIANCE_ITEM',
    'ACCOUNT_INTERVENTION',
    'QUARTERLY_BUSINESS_REVIEW'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "attachments" (
  "id"           TEXT PRIMARY KEY,
  "parentType"   "AttachmentParentType" NOT NULL,
  "parentId"     TEXT NOT NULL,
  "name"         TEXT NOT NULL,
  "mimeType"     TEXT NOT NULL,
  "size"         INTEGER NOT NULL,
  "data"         BYTEA NOT NULL,
  "uploadedById" TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE "attachments"
    ADD CONSTRAINT "attachments_uploadedById_fkey"
    FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "attachments_parent_idx"
  ON "attachments" ("parentType", "parentId");
CREATE INDEX IF NOT EXISTS "attachments_uploadedById_idx"
  ON "attachments" ("uploadedById");

INSERT INTO "audit_logs" ("id", "userId", "action", "entity", "entityId", "changes", "createdAt")
VALUES (
  gen_random_uuid(),
  NULL,
  'MIGRATION_022_POLYMORPHIC_ATTACHMENTS',
  'SCHEMA',
  '022',
  jsonb_build_object(
    'tableAdded', 'attachments',
    'enumAdded', 'AttachmentParentType',
    'parentTypes', 18,
    'note', 'Uploads go through validateAttachment (MIME + filename allowlist). Downloads use safeAttachmentHeaders (sandbox CSP, nosniff, attachment-only).'
  ),
  CURRENT_TIMESTAMP
);

COMMIT;
