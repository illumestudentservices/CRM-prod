-- partner_notes: notes thread for recruitment partners (agents/schools).
-- Mirrors lead_notes. Deploy does NOT push schema, so run this manually on prod.
CREATE TABLE IF NOT EXISTS partner_notes (
  id          text PRIMARY KEY,
  "partnerId" text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  content     text NOT NULL,
  "authorId"  text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "partner_notes_partnerId_idx" ON partner_notes("partnerId");
