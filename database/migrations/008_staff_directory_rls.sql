-- A4PRINT HUB: staff directory access for internal chat
-- Run after 007_internal_chat.sql.

alter table if exists public.users enable row level security;

-- Active authenticated HUB employees may read the internal staff directory.
-- This is required so the chat can resolve the current employee profile
-- and display sender names. It does not grant INSERT/UPDATE/DELETE rights.
drop policy if exists users_read_active_staff on public.users;
create policy users_read_active_staff on public.users
for select to authenticated
using (
  exists (
    select 1
    from public.users self
    where self.auth_user_id = auth.uid()
      and self.is_active = true
  )
);
