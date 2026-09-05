-- SUPPORT-only accounts are deliberately excluded from generic HUB-staff data access.
-- ADMIN+SUPPORT remains an administrator and is not restricted by this helper.
create or replace function public.is_hub_staff()
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists (
    select 1
    from public.users u
    join public.user_roles ur on ur.user_id=u.id
    join public.roles r on r.id=ur.role_id
    where u.auth_user_id=auth.uid()
      and u.is_active=true
      and (
        r.name <> 'SUPPORT'
        or exists (
          select 1
          from public.user_roles ur2
          join public.roles r2 on r2.id=ur2.role_id
          where ur2.user_id=u.id and r2.name='ADMIN'
        )
      )
  );
$$;

-- SUPPORT can read its own profile and people who opened support tickets,
-- but cannot enumerate the full staff directory.
drop policy if exists users_support_ticket_read on public.users;
create policy users_support_ticket_read on public.users
for select to authenticated
using (
  public.is_support_only()
  and (
    auth_user_id=auth.uid()
    or exists (
      select 1 from public.support_tickets t
      where t.requester_id=users.id
    )
  )
);

-- Company settings are business data; SUPPORT-only users do not need them.
drop policy if exists settings_read_authenticated on public.settings;
create policy settings_read_authenticated on public.settings
for select to authenticated
using (not public.is_support_only());
