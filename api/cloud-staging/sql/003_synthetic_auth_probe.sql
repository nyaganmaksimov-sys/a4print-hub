-- Synthetic-only username -> Neon Auth email lookup for isolated cloud staging.
-- No real employees, roles, password hashes or Supabase Auth accounts are stored.
create table if not exists public.cloud_staging_login_aliases (
  username text primary key
    check (username ~ '^staging_[a-z0-9_-]{3,32}$'),
  auth_email text not null unique
    check (auth_email ~ '^[a-z0-9._+-]+@example\.com$'),
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);
alter table public.cloud_staging_login_aliases enable row level security;
revoke all on public.cloud_staging_login_aliases from public, anonymous, authenticated;
grant select on public.cloud_staging_login_aliases to a4print_cloud_probe;
create policy cloud_staging_login_alias_read on public.cloud_staging_login_aliases
  for select to a4print_cloud_probe using (true);
insert into public.cloud_staging_login_aliases(username,auth_email,is_active)
values ('staging_operator','a4print-staging-operator-20261106-5b9cd8@example.com',true)
on conflict (username) do nothing;
comment on table public.cloud_staging_login_aliases is
  'Only synthetic example.com identities. For a one-time end-to-end password check; never use as production staff identity.';
