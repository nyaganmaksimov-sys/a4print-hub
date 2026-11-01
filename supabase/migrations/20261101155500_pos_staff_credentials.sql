-- Server-only PIN credentials for shared-login POS staff.
-- PIN values are never stored in plaintext; the API stores a per-user scrypt hash and salt.
create table if not exists public.pos_staff_credentials (
  user_id uuid primary key references public.users(id) on delete cascade,
  pin_salt text not null,
  pin_hash text not null,
  failed_attempts integer not null default 0 check (failed_attempts >= 0),
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.pos_staff_credentials enable row level security;
revoke all on public.pos_staff_credentials from anon, authenticated;

comment on table public.pos_staff_credentials is
  'Server-only hashed PIN credentials for A4PRINT POS staff. Access via API service role only.';
