-- 046 — ICR-only leave coverage checks.
--
-- When an ICR applies for leave they must confirm they informed the institution
-- manager; when a manager approves an ICR's leave they must confirm the
-- institution representative is informed and that work is covered (with an
-- optional note). These columns store those confirmations. They stay false/null
-- for non-ICR leave.
--
-- Run on TEST (illume_crm_test) then PROD (illume_crm). Idempotent.

ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "informedInstitution" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "coverageVerified"    BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "workCovered"         BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "leave_requests" ADD COLUMN IF NOT EXISTS "coverageNote"        TEXT;
