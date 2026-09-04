-- A4PRINT HUB: Google Drive attachments for internal staff chat

create table if not exists public.message_attachments (
  id uuid primary key default gen_random_uuid(),
  message_id uuid null references public.messages(id) on delete cascade,
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  uploaded_by uuid not null references public.users(id) on delete cascade,
  drive_file_id text not null unique,
  file_name text not null check (length(trim(file_name)) > 0),
  mime_type text null,
  file_size bigint not null default 0 check (file_size >= 0),
  drive_web_view_link text null,
  created_at timestamptz not null default now()
);

create index if not exists message_attachments_message_idx on public.message_attachments(message_id);
create index if not exists message_attachments_room_idx on public.message_attachments(room_id, created_at);
create index if not exists message_attachments_uploaded_by_idx on public.message_attachments(uploaded_by, created_at);
create index if not exists message_attachments_unsent_idx on public.message_attachments(created_at) where message_id is null;
create index if not exists message_attachments_sent_idx on public.message_attachments(message_id, created_at) where message_id is not null;

alter table public.message_attachments enable row level security;

drop policy if exists message_attachments_read_staff on public.message_attachments;
create policy message_attachments_read_staff on public.message_attachments
for select to authenticated
using (
  exists (
    select 1 from public.users u
    where u.auth_user_id = auth.uid() and u.is_active = true
  )
  and exists (select 1 from public.chat_rooms r where r.id = room_id)
);

drop policy if exists message_attachments_insert_self on public.message_attachments;
create policy message_attachments_insert_self on public.message_attachments
for insert to authenticated
with check (
  uploaded_by in (
    select id from public.users u
    where u.auth_user_id = auth.uid() and u.is_active = true
  )
  and exists (select 1 from public.chat_rooms r where r.id = room_id)
);

drop policy if exists message_attachments_update_self on public.message_attachments;
create policy message_attachments_update_self on public.message_attachments
for update to authenticated
using (
  uploaded_by in (
    select id from public.users u
    where u.auth_user_id = auth.uid() and u.is_active = true
  )
)
with check (
  uploaded_by in (
    select id from public.users u
    where u.auth_user_id = auth.uid() and u.is_active = true
  )
);

drop policy if exists message_attachments_delete_self on public.message_attachments;
create policy message_attachments_delete_self on public.message_attachments
for delete to authenticated
using (
  uploaded_by in (
    select id from public.users u
    where u.auth_user_id = auth.uid() and u.is_active = true
  )
  and message_id is null
);

grant select, insert, update, delete on public.message_attachments to authenticated;

-- OAuth refresh token is server-only. No browser role receives table grants.
create table if not exists public.google_drive_connection (
  singleton boolean primary key default true check (singleton = true),
  connected_by uuid null references public.users(id) on delete set null,
  google_email text null,
  refresh_token text not null,
  scope text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.google_drive_connection enable row level security;
revoke all on public.google_drive_connection from anon, authenticated;
comment on table public.google_drive_connection is 'Server-only Google Drive OAuth connection. Edge Function service key only.';
