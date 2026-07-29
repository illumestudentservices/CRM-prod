-- Let an audit trail outlive the account that created it.
--
-- audit_logs.userId was NOT NULL with a plain foreign key, so deleting a user
-- either failed on the constraint or required destroying their history first.
-- For a departing employee that is the wrong trade in both directions: the
-- record of who did what is the entire point of the table.
--
-- Rows whose author is deleted now keep everything except attribution.

ALTER TABLE "audit_logs" ALTER COLUMN "userId" DROP NOT NULL;

ALTER TABLE "audit_logs" DROP CONSTRAINT IF EXISTS "audit_logs_userId_fkey";

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
