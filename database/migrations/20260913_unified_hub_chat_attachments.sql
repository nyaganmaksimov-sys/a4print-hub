-- Unified HUB chat attachment helpers for staff and partners.

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

create or replace function public.hub_chat_attach(
  p_message_id uuid,
  p_storage_path text,
  p_file_name text,
  p_mime_type text,
  p_file_size bigint
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_staff uuid := public.current_hub_user_id();
  v_partner_user uuid := public.current_partner_user_id();
  v_room uuid;
  v_id uuid;
begin
  if p_message_id is null or nullif(trim(coalesce(p_storage_path,'')),'') is null then raise exception 'INVALID_ATTACHMENT'; end if;
  if nullif(trim(coalesce(p_file_name,'')),'') is null then raise exception 'INVALID_FILE_NAME'; end if;
  if coalesce(p_file_size,0)<0 or coalesce(p_file_size,0)>26214400 then raise exception 'FILE_TOO_LARGE'; end if;

  select m.room_id into v_room
  from public.messages m
  where m.id=p_message_id and m.deleted_at is null
    and ((m.sender_kind='STAFF' and m.sender_id=v_staff)
      or (m.sender_kind='PARTNER' and m.partner_user_id=v_partner_user));

  if v_room is null or not public.can_access_chat_room(v_room) then raise exception 'ACCESS_DENIED'; end if;
  if split_part(p_storage_path,'/',1) <> v_room::text then raise exception 'INVALID_STORAGE_PATH'; end if;

  insert into public.message_attachments(
    message_id,room_id,uploaded_by,partner_uploaded_by,drive_file_id,file_name,mime_type,file_size,storage_path,provider
  ) values(
    p_message_id,v_room,
    case when v_staff is not null then v_staff else null end,
    case when v_partner_user is not null then v_partner_user else null end,
    null,trim(p_file_name),nullif(trim(coalesce(p_mime_type,'')),''),coalesce(p_file_size,0),p_storage_path,'HUB_STORAGE'
  ) returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.hub_chat_attach(uuid,text,text,text,bigint) from public,anon;
grant execute on function public.hub_chat_attach(uuid,text,text,text,bigint) to authenticated;
