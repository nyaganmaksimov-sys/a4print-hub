-- A4PRINT HUB: username + password sign-in, while retaining existing Supabase Auth users.
-- This is additive. Never replace auth.users, email, passwords, PINs or RLS policies.
-- Apply to a test database first, after a verified backup.
create table if not exists public.staff_login_aliases (
    username text primary key,
    auth_user_id uuid not null unique references auth.users(id) on delete cascade,
    created_at timestamptz not null default now(),
    constraint staff_login_username_format check (
      username = lower(username)
      and username ~ '^[a-z0-9][a-z0-9._-]{2,63}$'
    )
);

alter table public.staff_login_aliases enable row level security;
-- Only the trusted API (service_role) resolves login aliases.
revoke all on table public.staff_login_aliases from public, anon, authenticated;
grant select, insert, update, delete on table public.staff_login_aliases to service_role;

-- Existing authenticated employees get their current email local-part as login.
-- On ambiguous or invalid local-parts no alias is created: administrator must
-- assign a unique login explicitly (do not guess).
with candidates as (
    select u.auth_user_id, lower(split_part(a.email, '@', 1)) as username
    from public.users u
    join auth.users a on a.id = u.auth_user_id
    where u.is_active is true and a.email is not null
), unambiguous as (
    select username from candidates
    where username ~ '^[a-z0-9][a-z0-9._-]{2,63}$'
    group by username having count(*) = 1
)
insert into public.staff_login_aliases (username, auth_user_id)
select c.username, c.auth_user_id from candidates c
join unambiguous valid on valid.username = c.username
on conflict do nothing;

comment on table public.staff_login_aliases is
  'Server-side lookup of staff usernames. No public/anon/authenticated table access.';
