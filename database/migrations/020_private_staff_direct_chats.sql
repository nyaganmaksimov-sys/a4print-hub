-- A4PRINT HUB: private one-to-one staff chats and attachment privacy

-- Keep historical chat attachments when an employee profile is removed.
alter table public.message_attachments
  alter column uploaded_by drop not null;

alter table public.message_attachments
  drop constraint if exists message_attachments_uploaded_by_fkey;

alter table public.message_attachments
  add constraint message_attachments_uploaded_by_fkey
  foreign key (uploaded_by) references public.users(id) on delete set null;

-- Deterministic key for a pair of employees. NULL remains valid for group rooms.
alter table public.chat_rooms
  add column if not exists direct_key text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.chat_rooms'::regclass
      and conname = 'chat_rooms_direct_key_key'
  ) then
    alter table public.chat_rooms
      add constraint chat_rooms_direct_key_key unique (direct_key);
  end if;
end $$;

create or replace function public.current_hub_user_id()
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select u.id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1
$$;

create or replace function public.can_access_chat_room(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.chat_rooms r
    where r.id = p_room_id
      and (
        r.is_group = true
        or exists (
          select 1
          from public.chat_members cm
          where cm.room_id = r.id
            and cm.user_id = public.current_hub_user_id()
        )
      )
  )
$$;

create or replace function public.open_direct_chat(p_other_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid;
  v_key text;
  v_room uuid;
begin
  v_me := public.current_hub_user_id();
  if v_me is null then
    raise exception 'STAFF_REQUIRED';
  end if;

  if p_other_user_id is null or p_other_user_id = v_me then
    raise exception 'INVALID_RECIPIENT';
  end if;

  if not exists (
    select 1 from public.users u
    where u.id = p_other_user_id and u.is_active = true
  ) then
    raise exception 'RECIPIENT_NOT_FOUND';
  end if;

  if v_me::text < p_other_user_id::text then
    v_key := v_me::text || ':' || p_other_user_id::text;
  else
    v_key := p_other_user_id::text || ':' || v_me::text;
  end if;

  insert into public.chat_rooms (name, is_group, direct_key)
  values (null, false, v_key)
  on conflict (direct_key) do update
    set direct_key = excluded.direct_key
  returning id into v_room;

  insert into public.chat_members (room_id, user_id)
  values (v_room, v_me), (v_room, p_other_user_id)
  on conflict do nothing;

  return v_room;
end;
$$;

revoke all on function public.current_hub_user_id() from public, anon;
revoke all on function public.can_access_chat_room(uuid) from public, anon;
revoke all on function public.open_direct_chat(uuid) from public, anon;
grant execute on function public.current_hub_user_id() to authenticated;
grant execute on function public.can_access_chat_room(uuid) to authenticated;
grant execute on function public.open_direct_chat(uuid) to authenticated;

alter table public.chat_rooms enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;

drop policy if exists chat_rooms_read_staff on public.chat_rooms;
create policy chat_rooms_read_staff on public.chat_rooms
for select to authenticated
using (public.is_hub_staff() and (is_group = true or public.can_access_chat_room(id)));

drop policy if exists chat_members_read_staff on public.chat_members;
create policy chat_members_read_staff on public.chat_members
for select to authenticated
using (public.is_hub_staff() and public.can_access_chat_room(room_id));

drop policy if exists messages_read_staff on public.messages;
create policy messages_read_staff on public.messages
for select to authenticated
using (public.is_hub_staff() and public.can_access_chat_room(room_id));

drop policy if exists messages_insert_self on public.messages;
create policy messages_insert_self on public.messages
for insert to authenticated
with check (
  public.is_hub_staff()
  and sender_id = public.current_hub_user_id()
  and public.can_access_chat_room(room_id)
);

drop policy if exists messages_update_self on public.messages;
create policy messages_update_self on public.messages
for update to authenticated
using (
  public.is_hub_staff()
  and sender_id = public.current_hub_user_id()
  and public.can_access_chat_room(room_id)
)
with check (
  public.is_hub_staff()
  and sender_id = public.current_hub_user_id()
  and public.can_access_chat_room(room_id)
);

drop policy if exists messages_delete_self on public.messages;
create policy messages_delete_self on public.messages
for delete to authenticated
using (
  public.is_hub_staff()
  and sender_id = public.current_hub_user_id()
  and public.can_access_chat_room(room_id)
);

drop policy if exists message_attachments_read_staff on public.message_attachments;
create policy message_attachments_read_staff on public.message_attachments
for select to authenticated
using (public.is_hub_staff() and public.can_access_chat_room(room_id));

drop policy if exists message_attachments_insert_self on public.message_attachments;
create policy message_attachments_insert_self on public.message_attachments
for insert to authenticated
with check (
  public.is_hub_staff()
  and uploaded_by = public.current_hub_user_id()
  and public.can_access_chat_room(room_id)
);

drop policy if exists message_attachments_update_self on public.message_attachments;
create policy message_attachments_update_self on public.message_attachments
for update to authenticated
using (
  uploaded_by = public.current_hub_user_id()
  and public.can_access_chat_room(room_id)
)
with check (
  uploaded_by = public.current_hub_user_id()
  and public.can_access_chat_room(room_id)
);

drop policy if exists message_attachments_delete_self on public.message_attachments;
create policy message_attachments_delete_self on public.message_attachments
for delete to authenticated
using (
  uploaded_by = public.current_hub_user_id()
  and message_id is null
  and public.can_access_chat_room(room_id)
);
