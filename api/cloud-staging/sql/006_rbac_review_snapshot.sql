-- A4PRINT Cloud STAGING: legacy RBAC review snapshot, *never* active permissions.
-- No real employee roles are granted to Neon Auth by this migration.
-- IDs and assignments stay in a non-exposed schema for later human review.

CREATE SCHEMA IF NOT EXISTS migration_review;
REVOKE ALL ON SCHEMA migration_review FROM PUBLIC, anonymous, authenticated, a4print_cloud_probe;

CREATE TABLE IF NOT EXISTS migration_review.roles (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS migration_review.permissions (
  id uuid PRIMARY KEY,
  code text NOT NULL UNIQUE,
  description text,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS migration_review.role_permissions (
  role_id uuid NOT NULL REFERENCES migration_review.roles(id) ON DELETE RESTRICT,
  permission_id uuid NOT NULL REFERENCES migration_review.permissions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  PRIMARY KEY(role_id, permission_id)
);
CREATE TABLE IF NOT EXISTS migration_review.staff_role_assignments (
  legacy_profile_id uuid NOT NULL REFERENCES public.cloud_staff_migration_inventory(legacy_profile_id) ON DELETE RESTRICT,
  legacy_role_id uuid NOT NULL REFERENCES migration_review.roles(id) ON DELETE RESTRICT,
  PRIMARY KEY(legacy_profile_id, legacy_role_id)
);
ALTER TABLE migration_review.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_review.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_review.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE migration_review.staff_role_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA migration_review FROM PUBLIC, anonymous, authenticated, a4print_cloud_probe;
COMMENT ON SCHEMA migration_review IS 'Private legacy migration snapshots, not an authorization source or API schema.';
COMMENT ON TABLE migration_review.staff_role_assignments IS 'Legacy role assignments for review only. NEVER authorize by reading this table directly.';
