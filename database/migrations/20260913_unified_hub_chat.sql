-- A4PRINT HUB unified chat for staff and partners.
-- Keeps existing staff chat history while adding private HUB <-> partner rooms.

alter table public.chat_rooms
  add column if not exists room_type text,
  add column if not exists partner_id uuid references public.partners(id) on delete cascade,
  add column if not exists last_message_at timestamptz;

update public.chat_rooms
set room_type = case
  when direct_key is not null then 'STAFF_DIRECT'
  when order_id is not null then 'STAFF_ORDER'
  else 'STAFF_GROUP'
end
where room_type is null;

update public.chat_rooms
set last_message_at = coalesce(
  (select max(m.created_at) from public.messages m where m.room_id = chat_rooms.id),
  created_at
)
where last_message_at is null;

alter table public.chat_rooms
  alter column room_type set default 'STAFF_GROUP',
  alter column room_type set not null,
  alter column last_message_at set default now(),
  alter column last_message_at set not null;

alter table public.chat_rooms drop constraint if exists chat_rooms_room_type_check;
alter table public.chat_rooms add constraint chat_rooms_room_type_check
  check (room_type in ('STAFF_GROUP','STAFF_DIRECT','STAFF_ORDER','PARTNER_HUB'));

create unique index if not exists uq_chat_rooms_partner_hub
  on public.chat_rooms(partner_id)
  where room_type = 'PARTNER_HUB';
create index if not exists idx_chat_rooms_last_message
  on public.chat_rooms(last_message_at desc);

alter table public.messages
  add column if not exists partner_user_id uuid references public.partner_users(id) on delete set null,
  add column if not exists sender_kind text;

update public.messages
set sender_kind = case when sender_id is not null then 'STAFF' else 'PARTNER' end
where sender_kind is null;

alter table public.messages
  alter column sender_kind set default 'STAFF',
  alter column sender_kind set not null;

alter table public.messages drop constraint if exists messages_sender_kind_check;
alter table public.messages add constraint messages_sender_kind_check
  check (sender_kind in ('STAFF','PARTNER'));

alter table public.messages drop constraint if exists messages_sender_actor_check;
alter table public.messages add constraint messages_sender_actor_check
  check (
    (sender_kind='STAFF' and sender_id is not null and partner_user_id is null)
    or
    (sender_kind='PARTNER' and sender_id is null and partner_user_id is not null)
  );

create index if not exists idx_messages_partner_user
  on public.messages(partner_user_id, created_at desc);

alter table public.message_attachments
  add column if not exists partner_uploaded_by uuid references public.partner_users(id) on delete set null,
  add column if not exists storage_path text,
  add column if not exists provider text;

update public.message_attachments
set provider = case when storage_path is not null then 'HUB_STORAGE' else 'DRIVE' end
where provider is null;

alter table public.message_attachments
  alter column drive_file_id drop not null,
  alter column provider set default 'HUB_STORAGE',
  alter column provider set not null;

alter table public.message_attachments drop constraint if exists message_attachments_provider_check;
alter table public.message_attachments add constraint message_attachments_provider_check
  check (provider in ('DRIVE','HUB_STORAGE'));

create index if not exists idx_message_attachments_storage_path
  on public.message_attachments(storage_path)
  where storage_path is not null;

create table if not exists public.chat_read_state (
  room_id uuid not null references public.chat_rooms(id) on delete cascade,
  auth_user_id uuid not null,
  read_at timestamptz not null default now(),
  primary key(room_id, auth_user_id)
);
create index if not exists idx_chat_read_state_user on public.chat_read_state(auth_user_id, read_at desc);
alter table public.chat_read_state enable row level security;

drop policy if exists chat_read_state_self_select on public.chat_read_state;
create policy chat_read_state_self_select on public.chat_read_state
for select to authenticated using (auth_user_id = auth.uid());
drop policy if exists chat_read_state_self_insert on public.chat_read_state;
create policy chat_read_state_self_insert on public.chat_read_state
for insert to authenticated with check (auth_user_id = auth.uid());
drop policy if exists chat_read_state_self_update on public.chat_read_state;
create policy chat_read_state_self_update on public.chat_read_state
for update to authenticated using (auth_user_id = auth.uid()) with check (auth_user_id = auth.uid());

create or replace function public.try_uuid(p_value text)
returns uuid
language plpgsql
immutable
security invoker
set search_path = ''
as $$
begin
  return p_value::uuid;
exception when others then
  return null;
end;
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
        (
          public.current_hub_user_id() is not null
          and not public.is_support_only()
          and (
            r.room_type in ('STAFF_GROUP','STAFF_ORDER','PARTNER_HUB')
            or (
              r.room_type='STAFF_DIRECT'
              and exists (
                select 1 from public.chat_members cm
                where cm.room_id=r.id and cm.user_id=public.current_hub_user_id()
              )
            )
          )
        )
        or
        (
          public.current_partner_id() is not null
          and r.room_type='PARTNER_HUB'
          and r.partner_id=public.current_partner_id()
        )
      )
  )
$$;

create or replace function public.open_partner_chat(p_partner_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid;
  v_partner uuid;
  v_room uuid;
  v_name text;
begin
  v_staff := public.current_hub_user_id();
  v_partner := public.current_partner_id();

  if v_staff is not null then
    if public.is_support_only() then raise exception 'ACCESS_DENIED'; end if;
    v_partner := p_partner_id;
  elsif v_partner is not null then
    if p_partner_id is not null and p_partner_id <> v_partner then raise exception 'ACCESS_DENIED'; end if;
  else
    raise exception 'CHAT_ACCESS_REQUIRED';
  end if;

  if v_partner is null then raise exception 'PARTNER_REQUIRED'; end if;
  select p.name into v_name from public.partners p where p.id=v_partner and p.is_active=true;
  if v_name is null then raise exception 'PARTNER_NOT_FOUND'; end if;

  insert into public.chat_rooms(name,is_group,room_type,partner_id,last_message_at)
  values(v_name,true,'PARTNER_HUB',v_partner,now())
  on conflict (partner_id) where room_type='PARTNER_HUB'
  do update set name=excluded.name
  returning id into v_room;

  return v_room;
end;
$$;

create or replace function public.hub_chat_unread_count(p_room_id uuid)
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select case when not public.can_access_chat_room(p_room_id) then 0 else (
    select count(*)
    from public.messages m
    left join public.chat_read_state rs
      on rs.room_id=m.room_id and rs.auth_user_id=auth.uid()
    where m.room_id=p_room_id
      and m.deleted_at is null
      and m.created_at > coalesce(rs.read_at,'1970-01-01'::timestamptz)
      and not (
        (m.sender_kind='STAFF' and m.sender_id=public.current_hub_user_id())
        or
        (m.sender_kind='PARTNER' and m.partner_user_id=public.current_partner_user_id())
      )
  ) end
$$;

create or replace function public.hub_chat_contacts()
returns table(
  target_kind text,
  target_id uuid,
  title text,
  subtitle text,
  room_id uuid,
  last_message_at timestamptz,
  unread_count bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid;
  v_partner uuid;
  v_room uuid;
begin
  v_me := public.current_hub_user_id();
  v_partner := public.current_partner_id();

  if v_me is not null then
    if public.is_support_only() then raise exception 'ACCESS_DENIED'; end if;

    return query
    select 'GENERAL'::text, null::uuid, coalesce(r.name,'Общий чат')::text,
           'Все сотрудники HUB'::text, r.id, r.last_message_at,
           public.hub_chat_unread_count(r.id)
    from public.chat_rooms r
    where r.room_type='STAFF_GROUP' and r.name='Общий чат'
    order by r.created_at
    limit 1;

    return query
    select 'STAFF'::text, u.id,
           coalesce(nullif(u.full_name,''),u.email,'Сотрудник')::text,
           coalesce(nullif(u.position,''),u.email,'Личная переписка')::text,
           r.id, r.last_message_at,
           case when r.id is null then 0 else public.hub_chat_unread_count(r.id) end
    from public.users u
    left join public.chat_rooms r
      on r.room_type='STAFF_DIRECT'
     and r.direct_key = case when v_me::text < u.id::text
       then v_me::text||':'||u.id::text else u.id::text||':'||v_me::text end
    where u.is_active=true and u.id<>v_me
    order by coalesce(r.last_message_at,'1970-01-01'::timestamptz) desc,
             coalesce(u.full_name,u.email);

    return query
    select 'PARTNER'::text, p.id, p.name::text,
           coalesce(nullif(p.contact_name,''),nullif(p.email,''),'Партнёр HUB')::text,
           r.id, r.last_message_at,
           case when r.id is null then 0 else public.hub_chat_unread_count(r.id) end
    from public.partners p
    left join public.chat_rooms r on r.room_type='PARTNER_HUB' and r.partner_id=p.id
    where p.is_active=true
    order by coalesce(r.last_message_at,'1970-01-01'::timestamptz) desc, p.name;
    return;
  end if;

  if v_partner is not null then
    v_room := public.open_partner_chat(v_partner);
    return query
    select 'HUB'::text, v_partner, 'A4PRINT HUB'::text,
           'Связь с персоналом HUB'::text, v_room, r.last_message_at,
           public.hub_chat_unread_count(v_room)
    from public.chat_rooms r where r.id=v_room;
    return;
  end if;

  raise exception 'CHAT_ACCESS_REQUIRED';
end;
$$;

create or replace function public.hub_chat_open(p_target_kind text, p_target_id uuid default null)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_me uuid;
  v_partner uuid;
  v_room uuid;
  v_kind text := upper(coalesce(p_target_kind,''));
begin
  v_me := public.current_hub_user_id();
  v_partner := public.current_partner_id();

  if v_me is not null then
    if public.is_support_only() then raise exception 'ACCESS_DENIED'; end if;
    if v_kind='GENERAL' then
      select r.id into v_room from public.chat_rooms r
      where r.room_type='STAFF_GROUP' and r.name='Общий чат'
      order by r.created_at limit 1;
      if v_room is null then
        insert into public.chat_rooms(name,is_group,room_type,last_message_at)
        values('Общий чат',true,'STAFF_GROUP',now()) returning id into v_room;
      end if;
    elsif v_kind='STAFF' then
      v_room := public.open_direct_chat(p_target_id);
    elsif v_kind='PARTNER' then
      v_room := public.open_partner_chat(p_target_id);
    else
      raise exception 'INVALID_CHAT_TARGET';
    end if;
  elsif v_partner is not null then
    if v_kind not in ('HUB','PARTNER') then raise exception 'ACCESS_DENIED'; end if;
    v_room := public.open_partner_chat(v_partner);
  else
    raise exception 'CHAT_ACCESS_REQUIRED';
  end if;

  return v_room;
end;
$$;

create or replace function public.hub_chat_mark_read(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.can_access_chat_room(p_room_id) then raise exception 'ACCESS_DENIED'; end if;
  insert into public.chat_read_state(room_id,auth_user_id,read_at)
  values(p_room_id,auth.uid(),now())
  on conflict(room_id,auth_user_id) do update set read_at=excluded.read_at;
end;
$$;

create or replace function public.hub_chat_messages(p_room_id uuid, p_limit integer default 200)
returns table(
  id uuid,
  body text,
  created_at timestamptz,
  edited_at timestamptz,
  sender_kind text,
  sender_id uuid,
  partner_user_id uuid,
  sender_name text,
  is_mine boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_me uuid := public.current_hub_user_id();
  v_partner_user uuid := public.current_partner_user_id();
begin
  if not public.can_access_chat_room(p_room_id) then raise exception 'ACCESS_DENIED'; end if;

  return query
  select q.id,q.body,q.created_at,q.edited_at,q.sender_kind,q.sender_id,q.partner_user_id,q.sender_name,q.is_mine
  from (
    select m.id,m.body,m.created_at,m.edited_at,m.sender_kind,m.sender_id,m.partner_user_id,
      case when m.sender_kind='STAFF'
        then coalesce(nullif(u.full_name,''),u.email,'Сотрудник HUB')
        else coalesce(nullif(pu.full_name,''),p.name,'Партнёр') end::text as sender_name,
      ((m.sender_kind='STAFF' and m.sender_id=v_me)
        or (m.sender_kind='PARTNER' and m.partner_user_id=v_partner_user)) as is_mine
    from public.messages m
    left join public.users u on u.id=m.sender_id
    left join public.partner_users pu on pu.id=m.partner_user_id
    left join public.partners p on p.id=pu.partner_id
    where m.room_id=p_room_id
      and m.deleted_at is null
      and (
        v_me is null
        or not exists (
          select 1 from public.message_user_hidden h
          where h.message_id=m.id and h.user_id=v_me
        )
      )
    order by m.created_at desc
    limit greatest(1,least(coalesce(p_limit,200),500))
  ) q
  order by q.created_at;
end;
$$;

create or replace function public.hub_chat_send(p_room_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := public.current_hub_user_id();
  v_partner_user uuid := public.current_partner_user_id();
  v_body text := trim(coalesce(p_body,''));
  v_id uuid;
begin
  if not public.can_access_chat_room(p_room_id) then raise exception 'ACCESS_DENIED'; end if;
  if length(v_body)=0 then raise exception 'MESSAGE_EMPTY'; end if;
  if length(v_body)>4000 then raise exception 'MESSAGE_TOO_LONG'; end if;

  if v_staff is not null then
    insert into public.messages(room_id,sender_id,partner_user_id,sender_kind,body)
    values(p_room_id,v_staff,null,'STAFF',v_body) returning id into v_id;
  elsif v_partner_user is not null then
    insert into public.messages(room_id,sender_id,partner_user_id,sender_kind,body)
    values(p_room_id,null,v_partner_user,'PARTNER',v_body) returning id into v_id;
  else
    raise exception 'CHAT_ACCESS_REQUIRED';
  end if;
  return v_id;
end;
$$;

create or replace function public.hub_chat_edit(p_message_id uuid, p_body text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := public.current_hub_user_id();
  v_partner_user uuid := public.current_partner_user_id();
  v_body text := trim(coalesce(p_body,''));
begin
  if length(v_body)=0 then raise exception 'MESSAGE_EMPTY'; end if;
  if length(v_body)>4000 then raise exception 'MESSAGE_TOO_LONG'; end if;
  update public.messages m set body=v_body,edited_at=now()
  where m.id=p_message_id and m.deleted_at is null
    and public.can_access_chat_room(m.room_id)
    and ((m.sender_kind='STAFF' and m.sender_id=v_staff)
      or (m.sender_kind='PARTNER' and m.partner_user_id=v_partner_user));
  if not found then raise exception 'MESSAGE_NOT_FOUND_OR_DENIED'; end if;
end;
$$;

create or replace function public.hub_chat_delete(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := public.current_hub_user_id();
  v_partner_user uuid := public.current_partner_user_id();
begin
  update public.messages m set deleted_at=now()
  where m.id=p_message_id and m.deleted_at is null
    and public.can_access_chat_room(m.room_id)
    and ((m.sender_kind='STAFF' and m.sender_id=v_staff)
      or (m.sender_kind='PARTNER' and m.partner_user_id=v_partner_user));
  if not found then raise exception 'MESSAGE_NOT_FOUND_OR_DENIED'; end if;
end;
$$;

create or replace function public.touch_chat_room_last_message()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.chat_rooms set last_message_at=new.created_at where id=new.room_id;
  return new;
end;
$$;

drop trigger if exists trg_touch_chat_room_last_message on public.messages;
create trigger trg_touch_chat_room_last_message
after insert on public.messages
for each row execute function public.touch_chat_room_last_message();

alter table public.chat_rooms enable row level security;
alter table public.chat_members enable row level security;
alter table public.messages enable row level security;
alter table public.message_attachments enable row level security;

drop policy if exists chat_rooms_read_staff on public.chat_rooms;
drop policy if exists chat_rooms_read_hub on public.chat_rooms;
create policy chat_rooms_read_hub on public.chat_rooms
for select to authenticated using (public.can_access_chat_room(id));

drop policy if exists chat_members_read_staff on public.chat_members;
drop policy if exists chat_members_read_hub on public.chat_members;
create policy chat_members_read_hub on public.chat_members
for select to authenticated using (
  public.current_hub_user_id() is not null
  and not public.is_support_only()
  and public.can_access_chat_room(room_id)
);

drop policy if exists messages_read_staff on public.messages;
drop policy if exists messages_read_hub on public.messages;
create policy messages_read_hub on public.messages
for select to authenticated using (public.can_access_chat_room(room_id));

drop policy if exists messages_insert_self on public.messages;
drop policy if exists messages_insert_hub on public.messages;
create policy messages_insert_hub on public.messages
for insert to authenticated with check (
  public.can_access_chat_room(room_id)
  and (
    (sender_kind='STAFF' and sender_id=public.current_hub_user_id() and partner_user_id is null)
    or
    (sender_kind='PARTNER' and partner_user_id=public.current_partner_user_id() and sender_id is null)
  )
);

drop policy if exists messages_update_self on public.messages;
drop policy if exists messages_update_hub on public.messages;
create policy messages_update_hub on public.messages
for update to authenticated
using (
  public.can_access_chat_room(room_id)
  and ((sender_kind='STAFF' and sender_id=public.current_hub_user_id())
    or (sender_kind='PARTNER' and partner_user_id=public.current_partner_user_id()))
)
with check (
  public.can_access_chat_room(room_id)
  and ((sender_kind='STAFF' and sender_id=public.current_hub_user_id())
    or (sender_kind='PARTNER' and partner_user_id=public.current_partner_user_id()))
);

drop policy if exists messages_delete_self on public.messages;
drop policy if exists messages_delete_hub on public.messages;
create policy messages_delete_hub on public.messages
for delete to authenticated using (
  public.can_access_chat_room(room_id)
  and ((sender_kind='STAFF' and sender_id=public.current_hub_user_id())
    or (sender_kind='PARTNER' and partner_user_id=public.current_partner_user_id()))
);

drop policy if exists message_attachments_read_staff on public.message_attachments;
drop policy if exists message_attachments_read_hub on public.message_attachments;
create policy message_attachments_read_hub on public.message_attachments
for select to authenticated using (public.can_access_chat_room(room_id));

drop policy if exists message_attachments_insert_self on public.message_attachments;
drop policy if exists message_attachments_insert_hub on public.message_attachments;
create policy message_attachments_insert_hub on public.message_attachments
for insert to authenticated with check (
  public.can_access_chat_room(room_id)
  and (
    (uploaded_by=public.current_hub_user_id() and partner_uploaded_by is null)
    or
    (partner_uploaded_by=public.current_partner_user_id() and uploaded_by is null)
  )
);

drop policy if exists message_attachments_update_self on public.message_attachments;
drop policy if exists message_attachments_update_hub on public.message_attachments;
create policy message_attachments_update_hub on public.message_attachments
for update to authenticated
using (
  public.can_access_chat_room(room_id)
  and ((uploaded_by=public.current_hub_user_id()) or (partner_uploaded_by=public.current_partner_user_id()))
)
with check (
  public.can_access_chat_room(room_id)
  and ((uploaded_by=public.current_hub_user_id()) or (partner_uploaded_by=public.current_partner_user_id()))
);

drop policy if exists message_attachments_delete_self on public.message_attachments;
drop policy if exists message_attachments_delete_hub on public.message_attachments;
create policy message_attachments_delete_hub on public.message_attachments
for delete to authenticated using (
  public.can_access_chat_room(room_id)
  and message_id is null
  and ((uploaded_by=public.current_hub_user_id()) or (partner_uploaded_by=public.current_partner_user_id()))
);

insert into storage.buckets(id,name,public,file_size_limit)
values('hub-chat','hub-chat',false,26214400)
on conflict(id) do update set public=false,file_size_limit=26214400;

drop policy if exists hub_chat_storage_select on storage.objects;
create policy hub_chat_storage_select on storage.objects
for select to authenticated using (
  bucket_id='hub-chat'
  and public.can_access_chat_room(public.try_uuid(split_part(name,'/',1)))
);

drop policy if exists hub_chat_storage_insert on storage.objects;
create policy hub_chat_storage_insert on storage.objects
for insert to authenticated with check (
  bucket_id='hub-chat'
  and public.can_access_chat_room(public.try_uuid(split_part(name,'/',1)))
);

drop policy if exists hub_chat_storage_delete on storage.objects;
create policy hub_chat_storage_delete on storage.objects
for delete to authenticated using (
  bucket_id='hub-chat'
  and public.can_access_chat_room(public.try_uuid(split_part(name,'/',1)))
);

revoke all on function public.open_partner_chat(uuid) from public,anon;
revoke all on function public.hub_chat_contacts() from public,anon;
revoke all on function public.hub_chat_open(text,uuid) from public,anon;
revoke all on function public.hub_chat_mark_read(uuid) from public,anon;
revoke all on function public.hub_chat_messages(uuid,integer) from public,anon;
revoke all on function public.hub_chat_send(uuid,text) from public,anon;
revoke all on function public.hub_chat_edit(uuid,text) from public,anon;
revoke all on function public.hub_chat_delete(uuid) from public,anon;
revoke all on function public.hub_chat_unread_count(uuid) from public,anon;

grant execute on function public.open_partner_chat(uuid) to authenticated;
grant execute on function public.hub_chat_contacts() to authenticated;
grant execute on function public.hub_chat_open(text,uuid) to authenticated;
grant execute on function public.hub_chat_mark_read(uuid) to authenticated;
grant execute on function public.hub_chat_messages(uuid,integer) to authenticated;
grant execute on function public.hub_chat_send(uuid,text) to authenticated;
grant execute on function public.hub_chat_edit(uuid,text) to authenticated;
grant execute on function public.hub_chat_delete(uuid) to authenticated;
grant execute on function public.hub_chat_unread_count(uuid) to authenticated;
