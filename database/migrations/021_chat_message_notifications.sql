create index if not exists idx_notifications_user_unread_created
  on public.notifications(user_id, is_read, created_at desc);

alter table public.notifications enable row level security;

drop policy if exists notifications_select_own on public.notifications;
create policy notifications_select_own
on public.notifications
for select
to authenticated
using (user_id = public.current_hub_user_id());

drop policy if exists notifications_update_own on public.notifications;
create policy notifications_update_own
on public.notifications
for update
to authenticated
using (user_id = public.current_hub_user_id())
with check (user_id = public.current_hub_user_id());

create or replace function public.notify_chat_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sender_name text;
  v_is_group boolean;
  v_preview text;
begin
  select coalesce(nullif(trim(full_name),''), email, 'Сотрудник')
    into v_sender_name
  from public.users
  where id = new.sender_id;

  select is_group into v_is_group
  from public.chat_rooms
  where id = new.room_id;

  v_preview := nullif(trim(coalesce(new.body,'')), '');
  if v_preview is null then
    v_preview := 'Новое сообщение или вложение';
  else
    v_preview := left(v_preview, 180);
  end if;

  if coalesce(v_is_group, false) then
    insert into public.notifications(user_id,title,body,type,entity_type,entity_id,is_read)
    select u.id,
           'Общий чат · ' || coalesce(v_sender_name,'Сотрудник'),
           v_preview,
           'CHAT_MESSAGE',
           'chat_room',
           new.room_id,
           false
    from public.users u
    where u.is_active = true
      and u.id <> new.sender_id;
  else
    insert into public.notifications(user_id,title,body,type,entity_type,entity_id,is_read)
    select cm.user_id,
           'Сообщение от ' || coalesce(v_sender_name,'Сотрудник'),
           v_preview,
           'CHAT_MESSAGE',
           'chat_room',
           new.room_id,
           false
    from public.chat_members cm
    join public.users u on u.id = cm.user_id and u.is_active = true
    where cm.room_id = new.room_id
      and cm.user_id <> new.sender_id;
  end if;

  return new;
end;
$$;

revoke all on function public.notify_chat_message() from public, anon, authenticated;

drop trigger if exists trg_notify_chat_message on public.messages;
create trigger trg_notify_chat_message
after insert on public.messages
for each row execute function public.notify_chat_message();

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='notifications'
  ) then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;
