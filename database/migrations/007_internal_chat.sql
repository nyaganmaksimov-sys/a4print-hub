-- A4PRINT HUB internal staff chat
-- Safe to run after base schema.

alter table if exists chat_rooms enable row level security;
alter table if exists chat_members enable row level security;
alter table if exists messages enable row level security;

-- All authenticated active HUB users may read the shared internal chat.
drop policy if exists chat_rooms_read_staff on chat_rooms;
create policy chat_rooms_read_staff on chat_rooms
for select to authenticated
using (exists (
  select 1 from users u
  where u.auth_user_id = auth.uid() and u.is_active = true
));

drop policy if exists chat_members_read_staff on chat_members;
create policy chat_members_read_staff on chat_members
for select to authenticated
using (exists (
  select 1 from users u
  where u.auth_user_id = auth.uid() and u.is_active = true
));

drop policy if exists messages_read_staff on messages;
create policy messages_read_staff on messages
for select to authenticated
using (exists (
  select 1 from users u
  where u.auth_user_id = auth.uid() and u.is_active = true
));

-- Staff can send only as their own profile.
drop policy if exists messages_insert_self on messages;
create policy messages_insert_self on messages
for insert to authenticated
with check (
  sender_id in (
    select id from users u
    where u.auth_user_id = auth.uid() and u.is_active = true
  )
  and exists (select 1 from chat_rooms r where r.id = room_id)
);

-- A user may edit/delete only their own messages.
drop policy if exists messages_update_self on messages;
create policy messages_update_self on messages
for update to authenticated
using (sender_id in (select id from users u where u.auth_user_id = auth.uid()))
with check (sender_id in (select id from users u where u.auth_user_id = auth.uid()));

drop policy if exists messages_delete_self on messages;
create policy messages_delete_self on messages
for delete to authenticated
using (sender_id in (select id from users u where u.auth_user_id = auth.uid()));

-- Seed one shared room used by all employees.
insert into chat_rooms (name, is_group)
select 'Общий чат', true
where not exists (select 1 from chat_rooms where name = 'Общий чат');
