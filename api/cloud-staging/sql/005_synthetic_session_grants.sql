-- Isolated synthetic-only grants; no production permissions.
create table if not exists public.cloud_staging_session_grants (
  neon_auth_user_id uuid primary key,
  role text not null default 'STAGING_VIEWER' check(role='STAGING_VIEWER'),
  enabled boolean not null default false,
  identity_verified boolean not null default false,
  source text not null default 'SYNTHETIC' check(source='SYNTHETIC'),
  created_at timestamptz not null default now(),
  constraint verified_before_activation check (not enabled or identity_verified)
);
alter table public.cloud_staging_session_grants enable row level security;
revoke all on public.cloud_staging_session_grants from public, anonymous, authenticated;
grant select on public.cloud_staging_session_grants to a4print_cloud_probe;
create policy cloud_staging_grant_read on public.cloud_staging_session_grants
  for select to a4print_cloud_probe using(true);
-- Seed only synthetic Neon Auth identities, explicitly DISABLED.
insert into public.cloud_staging_session_grants(neon_auth_user_id)
select id from neon_auth."user" where email like 'a4print-staging-%@example.com'
on conflict(neon_auth_user_id) do nothing;
comment on table public.cloud_staging_session_grants is
  'Only fake identities, grants disabled until verified; no real staff or POS access.';
