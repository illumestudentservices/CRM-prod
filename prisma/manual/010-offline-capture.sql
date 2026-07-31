-- Offline lead capture: idempotency key for batch upload from an event.
--
-- Purely additive — one nullable column and a unique index. Nothing to
-- back-fill, and no existing row is touched: leads created in the office have
-- no device-side origin, so their captureId stays NULL.
--
-- Postgres allows any number of NULLs under a UNIQUE index, which is what makes
-- a nullable idempotency key workable. Only rows that actually carry a captureId
-- are constrained against each other.
--
-- Why this exists: an ICR uploading 100 leads over event wifi can lose the
-- connection at lead 40. Nothing tells them which ones landed, so they press
-- Upload again — and without this constraint the first 40 are inserted a second
-- time. The existing dedup only *flags* isDuplicate after the fact; it does not
-- prevent the row. This does.

BEGIN;

ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "captureId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "leads_captureId_key"
  ON "leads" ("captureId");

COMMIT;
