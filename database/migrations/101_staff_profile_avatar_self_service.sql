alter table public.users add column if not exists avatar_url text;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('staff-avatars','staff-avatars',true,3145728,array['image/jpeg','image/png','image/webp'])
on conflict (id) do update set public=true,file_size_limit=3145728,allowed_mime_types=array['image/jpeg','image/png','image/webp'];

drop policy if exists staff_avatars_public_read on storage.objects;
create policy staff_avatars_public_read on storage.objects for select using (bucket_id='staff-avatars');
drop policy if exists staff_avatars_owner_insert on storage.objects;
create policy staff_avatars_owner_insert on storage.objects for insert to authenticated with check (bucket_id='staff-avatars' and auth.uid() is not null and (storage.foldername(name))[1]=(auth.uid())::text);
drop policy if exists staff_avatars_owner_update on storage.objects;
create policy staff_avatars_owner_update on storage.objects for update to authenticated using (bucket_id='staff-avatars' and auth.uid() is not null and name like (auth.uid())::text || '/%') with check (bucket_id='staff-avatars' and auth.uid() is not null and name like (auth.uid())::text || '/%');
drop policy if exists staff_avatars_owner_delete on storage.objects;
create policy staff_avatars_owner_delete on storage.objects for delete to authenticated using (bucket_id='staff-avatars' and auth.uid() is not null and name like (auth.uid())::text || '/%');

create or replace function public.update_my_staff_avatar(p_avatar_url text)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare v_url text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  v_url:=nullif(trim(coalesce(p_avatar_url,'')),'');
  if v_url is not null and v_url !~ '^https://[^/]+/storage/v1/object/public/staff-avatars/' then
    raise exception 'INVALID_AVATAR_URL';
  end if;
  update public.users set avatar_url=v_url,updated_at=now()
  where auth_user_id=auth.uid() and is_active=true;
  if not found then raise exception 'STAFF_NOT_FOUND'; end if;
  return v_url;
end;
$$;
revoke all on function public.update_my_staff_avatar(text) from public,anon;
grant execute on function public.update_my_staff_avatar(text) to authenticated;

create or replace function public.sync_staff_email_from_auth()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.email is distinct from old.email then
    update public.users set email=new.email,updated_at=now() where auth_user_id=new.id;
  end if;
  return new;
end;
$$;
drop trigger if exists on_auth_user_email_updated on auth.users;
create trigger on_auth_user_email_updated after update of email on auth.users for each row execute function public.sync_staff_email_from_auth();

create or replace function public.get_my_staff_profile()
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user public.users;
  v_roles jsonb;
  v_request public.staff_registration_requests;
  v_auth auth.users;
  v_department jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_auth from auth.users where id=auth.uid();
  select * into v_user from public.users where auth_user_id=auth.uid();
  if found then
    select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'description',r.description) order by r.name),'[]'::jsonb)
      into v_roles
    from public.user_roles ur join public.roles r on r.id=ur.role_id
    where ur.user_id=v_user.id;

    select jsonb_build_object('id',ou.id,'name',ou.name,'code',ou.code,'organization',jsonb_build_object('id',o.id,'name',o.name,'code',o.code))
      into v_department
    from public.organization_units ou join public.organizations o on o.id=ou.organization_id
    where ou.id=v_user.organization_unit_id;

    return jsonb_build_object(
      'status',case when v_user.is_active then 'ACTIVE' else 'DISABLED' end,
      'user',jsonb_build_object('id',v_user.id,'full_name',v_user.full_name,'email',coalesce(v_auth.email,v_user.email),'phone',v_user.phone,'is_active',v_user.is_active,'created_at',v_user.created_at,'position',v_user.position,'organization_unit_id',v_user.organization_unit_id,'avatar_url',v_user.avatar_url),
      'department',v_department,
      'roles',v_roles,
      'provider',coalesce(v_auth.raw_app_meta_data->>'provider','email'),
      'avatar_url',coalesce(v_user.avatar_url,v_auth.raw_user_meta_data->>'avatar_url')
    );
  end if;

  select * into v_request from public.staff_registration_requests where auth_user_id=auth.uid();
  if found then
    return jsonb_build_object('status',v_request.status,'request',to_jsonb(v_request)-'metadata','provider',v_request.provider,'avatar_url',v_request.metadata->>'avatar_url');
  end if;
  return jsonb_build_object('status','UNREGISTERED','provider',coalesce(v_auth.raw_app_meta_data->>'provider','email'),'email',v_auth.email,'avatar_url',v_auth.raw_user_meta_data->>'avatar_url');
end;
$$;
