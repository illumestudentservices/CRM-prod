-- Granular permissions (Phase 10).
--
-- Adds a second, finer tier under the existing permission_overrides table:
--
--   permission_overrides   role × resource × action     ("leads:write")
--   granular_permissions   role × capability            ("leads.merge")
--                          role × field × read|write    ("leads.passportNumber:read")
--
-- The finer tier can only narrow: it is consulted after the coarse action
-- check has already passed, so a row here can withhold part of a granted
-- action but can never hand out an action the role doesn't hold.
--
-- Only deviations from the registry defaults are stored. "Reset to default"
-- is therefore a DELETE, and an empty table means the app behaves exactly as
-- it did before this migration.

BEGIN;

DO $$ BEGIN
  CREATE TYPE "PermissionScope" AS ENUM ('CAPABILITY', 'FIELD');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "granular_permissions" (
  "id"          TEXT PRIMARY KEY,
  "role"        "Role" NOT NULL,
  "scope"       "PermissionScope" NOT NULL,
  "resource"    TEXT NOT NULL,
  "target"      TEXT NOT NULL,
  "access"      TEXT,
  "granted"     BOOLEAN NOT NULL,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedById" TEXT NOT NULL
);

-- FIELD rows carry an access mode, so (role, scope, resource, target, access)
-- is the natural key.
CREATE UNIQUE INDEX IF NOT EXISTS "granular_permissions_field_key"
  ON "granular_permissions" ("role", "scope", "resource", "target", "access")
  WHERE "access" IS NOT NULL;

-- CAPABILITY rows have access IS NULL. Postgres treats NULLs as distinct in a
-- unique index, so without this partial index the same capability could be
-- inserted twice for one role.
CREATE UNIQUE INDEX IF NOT EXISTS "granular_permissions_capability_key"
  ON "granular_permissions" ("role", "scope", "resource", "target")
  WHERE "access" IS NULL;

CREATE INDEX IF NOT EXISTS "granular_permissions_role_scope_idx"
  ON "granular_permissions" ("role", "scope");

INSERT INTO "audit_logs" ("id", "userId", "action", "entity", "entityId", "changes", "createdAt")
VALUES (
  gen_random_uuid(),
  NULL,
  'MIGRATION_024_GRANULAR_PERMISSIONS',
  'SCHEMA',
  '024',
  jsonb_build_object(
    'tableAdded', 'granular_permissions',
    'enumAdded', 'PermissionScope',
    'note', 'Capability and field-level tier under permission_overrides. Stores deviations from registry defaults only; empty table = pre-migration behaviour.'
  ),
  CURRENT_TIMESTAMP
);

COMMIT;
