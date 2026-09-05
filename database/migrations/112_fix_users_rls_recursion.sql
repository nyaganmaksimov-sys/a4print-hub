-- Fix infinite recursion between users and support_tickets RLS policies.
-- The helper is SECURITY DEFINER so visibility checks do not recurse through table RLS.
create or replace function public.can_read_support_user(p_user_id uuid, p_auth_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select public.is_support_only()
    and (
      p_auth_user_id = auth.uid()
      or exists (
        select 1
        from public.support_tickets t
        where t.requester_id = p_user_id
      )
    );
$$;

grant execute on function public.can_read_support_user(uuid,uuid) to authenticated;

drop policy if exists users_support_ticket_read on public.users;
create policy users_support_ticket_read on public.users
for select to authenticated
using (public.can_read_support_user(id, auth_user_id));
