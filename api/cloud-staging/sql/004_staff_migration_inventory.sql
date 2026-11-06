-- A4PRINT Cloud STAGING: legacy staff identity inventory (NO PASSWORDS).
-- Keep old profile UUIDs for later FK reconciliation. No roles are granted here.
-- Contact personal data is limited to login-email mapping only, for four linked users.
create table if not exists public.cloud_staff_migration_inventory (
  legacy_profile_id uuid primary key,
  legacy_auth_user_id uuid unique,
  username text unique,
  auth_email text unique,
  is_active boolean not null,
  migration_status text not null check (
    migration_status in ('AWAITING_PASSWORD_SETUP','NEEDS_AUTH_LINK','ONBOARDED')
  ),
  neon_auth_user_id uuid unique,
  copied_at timestamptz not null default now(),
  constraint linked_profile_fields check (
    (legacy_auth_user_id is not null and username is not null and auth_email is not null)
    or (legacy_auth_user_id is null and username is null and auth_email is null)
  ),
  constraint valid_username check (
    username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,63}$'
  ),
  constraint no_unverified_roles check (
    migration_status <> 'ONBOARDED' or neon_auth_user_id is not null
  )
);
alter table public.cloud_staff_migration_inventory enable row level security;
-- Not readable even by the staging Render API! Only the Neon DB owner for migration.
revoke all on public.cloud_staff_migration_inventory from public, anonymous, authenticated, a4print_cloud_probe;
comment on table public.cloud_staff_migration_inventory is
  'Pending staff migration ONLY: no password hashes, no PINs, no role activation, no public access. Never attach this data to the demo HTTP API.';
