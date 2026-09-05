create or replace function public.is_support_only()
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select public.has_role('SUPPORT') and not public.has_role('ADMIN');
$$;
grant execute on function public.is_support_only() to authenticated;

drop policy if exists chat_rooms_read_staff on public.chat_rooms;
create policy chat_rooms_read_staff on public.chat_rooms
for select to authenticated
using (
  not public.is_support_only()
  and exists (select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active=true)
);

drop policy if exists chat_members_read_staff on public.chat_members;
create policy chat_members_read_staff on public.chat_members
for select to authenticated
using (
  not public.is_support_only()
  and exists (select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active=true)
);

drop policy if exists messages_read_staff on public.messages;
create policy messages_read_staff on public.messages
for select to authenticated
using (
  not public.is_support_only()
  and exists (select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active=true)
);

drop policy if exists messages_insert_self on public.messages;
create policy messages_insert_self on public.messages
for insert to authenticated
with check (
  not public.is_support_only()
  and sender_id in (select id from public.users u where u.auth_user_id=auth.uid() and u.is_active=true)
  and exists (select 1 from public.chat_rooms r where r.id=room_id)
);
