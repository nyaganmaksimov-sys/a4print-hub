-- A4PRINT HUB: secure partner self-registration invite links

create extension if not exists pgcrypto;

create table if not exists public.partner_registration_invites (
  id uuid primary key default gen_random_uuid(),
  token text not null unique,
  label text,
  created_by uuid references public.users(id) on delete set null,
  default_discount_percent numeric(5,2) not null default 0 check (default_discount_percent between 0 and 100),
  default_payment_terms_days integer not null default 0 check (default_payment_terms_days between 0 and 3650),
  max_uses integer not null default 1 check (max_uses between 1 and 10000),
  used_count integer not null default 0 check (used_count >= 0),
  is_active boolean not null default true,
  expires_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_partner_registration_invites_active
  on public.partner_registration_invites(is_active, expires_at, created_at desc);

create table if not exists public.partner_registration_invite_uses (
  id uuid primary key default gen_random_uuid(),
  invite_id uuid not null references public.partner_registration_invites(id) on delete cascade,
  partner_id uuid references public.partners(id) on delete set null,
  partner_user_id uuid references public.partner_users(id) on delete set null,
  registered_email text,
  company_name text,
  registered_at timestamptz not null default now()
);

create index if not exists idx_partner_registration_invite_uses_invite
  on public.partner_registration_invite_uses(invite_id, registered_at desc);

alter table public.partner_registration_invites enable row level security;
alter table public.partner_registration_invite_uses enable row level security;

revoke all on public.partner_registration_invites from anon, authenticated;
revoke all on public.partner_registration_invite_uses from anon, authenticated;
grant select, insert, update, delete on public.partner_registration_invites to service_role;
grant select, insert, update, delete on public.partner_registration_invite_uses to service_role;

create or replace function public.reserve_partner_registration_invite(p_token text)
returns table(
  invite_id uuid,
  default_discount_percent numeric,
  default_payment_terms_days integer
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v public.partner_registration_invites%rowtype;
begin
  select * into v
  from public.partner_registration_invites
  where token=p_token
  for update;

  if v.id is null then raise exception 'INVITE_NOT_FOUND'; end if;
  if v.is_active is not true then raise exception 'INVITE_DISABLED'; end if;
  if v.expires_at is not null and v.expires_at <= now() then raise exception 'INVITE_EXPIRED'; end if;
  if v.used_count >= v.max_uses then raise exception 'INVITE_LIMIT_REACHED'; end if;

  update public.partner_registration_invites
  set used_count=used_count+1,
      last_used_at=now(),
      updated_at=now()
  where id=v.id;

  return query select v.id, v.default_discount_percent, v.default_payment_terms_days;
end;
$$;

create or replace function public.release_partner_registration_invite(p_invite_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  update public.partner_registration_invites
  set used_count=greatest(used_count-1,0), updated_at=now()
  where id=p_invite_id;
end;
$$;

revoke all on function public.reserve_partner_registration_invite(text) from public, anon, authenticated;
revoke all on function public.release_partner_registration_invite(uuid) from public, anon, authenticated;
grant execute on function public.reserve_partner_registration_invite(text) to service_role;
grant execute on function public.release_partner_registration_invite(uuid) to service_role;
