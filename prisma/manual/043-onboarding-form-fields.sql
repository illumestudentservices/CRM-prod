-- 043: onboarding (account request) form — two new optional fields.
--   * countryOfResidence  — free text, where the joiner is based.
--   * reportsToInstitution — the client university the joiner reports to, if any.
-- Both nullable; existing rows keep NULL. FK is ON DELETE SET NULL so removing a
-- client never deletes the hiring record that referenced it. Idempotent.

ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS "countryOfResidence" TEXT;
ALTER TABLE account_requests ADD COLUMN IF NOT EXISTS "reportsToInstitutionId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'account_requests_reportsToInstitutionId_fkey'
  ) THEN
    ALTER TABLE account_requests
      ADD CONSTRAINT "account_requests_reportsToInstitutionId_fkey"
      FOREIGN KEY ("reportsToInstitutionId") REFERENCES institutions(id)
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "account_requests_reportsToInstitutionId_idx"
  ON account_requests ("reportsToInstitutionId");
