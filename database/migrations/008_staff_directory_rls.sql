-- A4PRINT HUB: staff directory access for internal chat
-- Run after 007_internal_chat.sql.

alter table if exists public.users enable row level security;

-- Supabase Auth accounts in this project are HUB employee accounts.
-- Authenticated employees may read staff names/profile ids so chat can
-- resolve the current profile and display message authors.
-- No INSERT/UPDATE/DELETE permission is granted here.
drop policy if exists users_read_active_staff on public.users;
create policy users_read_active_staff on public.users
for select to authenticated
using (auth.uid() is not null);
