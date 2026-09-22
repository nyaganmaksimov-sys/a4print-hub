alter table public.staff_registration_requests
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;

update public.staff_registration_requests r
set organization_id=ou.organization_id
from public.users reviewer
join public.organization_units ou on ou.id=reviewer.organization_unit_id
where r.organization_id is null and r.reviewed_by=reviewer.id;

create index if not exists staff_registration_requests_org_status_requested_idx
  on public.staff_registration_requests(organization_id,status,requested_at desc);

drop policy if exists staff_registration_read_admin on public.staff_registration_requests;
create policy staff_registration_read_admin
  on public.staff_registration_requests
  for select
  to authenticated
  using (
    public.has_role('ADMIN')
    and organization_id=public.current_user_organization_id()
  );

create or replace function public.get_public_staff_registration_organizations()
returns table(id uuid,name text,code text)
language sql
stable
security definer
set search_path=''
as $$
  select o.id,o.name,o.code
  from public.organizations o
  where o.is_active=true
  order by o.name;
$$;

revoke execute on function public.get_public_staff_registration_organizations() from public;
grant execute on function public.get_public_staff_registration_organizations() to anon,authenticated;

create or replace function public.submit_staff_registration_v2(
  p_full_name text default null,
  p_phone text default null,
  p_provider text default null,
  p_organization_id uuid default null
)
returns public.staff_registration_requests
language plpgsql
security definer
set search_path=''
as $$
declare
  v_auth auth.users;
  v_existing public.staff_registration_requests;
  v_name text;
  v_provider text;
  v_org_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into v_auth from auth.users where id=auth.uid();
  if not found then raise exception 'AUTH_USER_NOT_FOUND'; end if;

  select id into v_org_id from public.organizations where id=p_organization_id and is_active=true;
  if v_org_id is null then raise exception 'ORGANIZATION_REQUIRED'; end if;

  if exists(select 1 from public.users u where u.auth_user_id=auth.uid() and u.is_active=true) then
    select * into v_existing from public.staff_registration_requests where auth_user_id=auth.uid();
    if found then return v_existing; end if;
    raise exception 'ALREADY_STAFF';
  end if;

  v_name:=nullif(trim(coalesce(p_full_name,'')),'');
  if v_name is null then
    v_name:=nullif(trim(coalesce(v_auth.raw_user_meta_data->>'full_name',v_auth.raw_user_meta_data->>'name','')),'');
  end if;
  if v_name is null then v_name:=split_part(coalesce(v_auth.email,'Сотрудник'),'@',1); end if;

  v_provider:=nullif(trim(coalesce(p_provider,'')),'');
  if v_provider is null then v_provider:=coalesce(v_auth.raw_app_meta_data->>'provider','email'); end if;

  insert into public.staff_registration_requests(
    auth_user_id,email,full_name,phone,provider,status,metadata,organization_id,requested_at,updated_at
  )
  values(
    auth.uid(),v_auth.email,v_name,nullif(trim(coalesce(p_phone,'')),''),
    v_provider,'PENDING',jsonb_build_object('avatar_url',v_auth.raw_user_meta_data->>'avatar_url'),
    v_org_id,now(),now()
  )
  on conflict(auth_user_id) do update set
    email=excluded.email,
    full_name=case when public.staff_registration_requests.status in ('PENDING','REJECTED') then excluded.full_name else public.staff_registration_requests.full_name end,
    phone=case when public.staff_registration_requests.status in ('PENDING','REJECTED') then excluded.phone else public.staff_registration_requests.phone end,
    provider=excluded.provider,
    organization_id=case when public.staff_registration_requests.status in ('PENDING','REJECTED') then excluded.organization_id else public.staff_registration_requests.organization_id end,
    status=case when public.staff_registration_requests.status='REJECTED' then 'PENDING' else public.staff_registration_requests.status end,
    rejection_reason=case when public.staff_registration_requests.status='REJECTED' then null else public.staff_registration_requests.rejection_reason end,
    reviewed_at=case when public.staff_registration_requests.status='REJECTED' then null else public.staff_registration_requests.reviewed_at end,
    reviewed_by=case when public.staff_registration_requests.status='REJECTED' then null else public.staff_registration_requests.reviewed_by end,
    requested_at=case when public.staff_registration_requests.status='REJECTED' then now() else public.staff_registration_requests.requested_at end,
    updated_at=now()
  returning * into v_existing;
  return v_existing;
end;
$$;

revoke execute on function public.submit_staff_registration_v2(text,text,text,uuid) from public,anon;
grant execute on function public.submit_staff_registration_v2(text,text,text,uuid) to authenticated;

create or replace function public.submit_staff_registration(
  p_full_name text default null,
  p_phone text default null,
  p_provider text default null
)
returns public.staff_registration_requests
language plpgsql
security definer
set search_path=''
as $$
declare
  v_org uuid;
  v_count integer;
begin
  select count(*)::integer into v_count from public.organizations where is_active=true;
  if v_count<>1 then raise exception 'ORGANIZATION_REQUIRED'; end if;
  select id into v_org from public.organizations where is_active=true limit 1;
  return public.submit_staff_registration_v2(p_full_name,p_phone,p_provider,v_org);
end;
$$;

create or replace function public.staff_admin_set_assignment_system(
  p_actor_user_id uuid,p_user_id uuid,p_department_id uuid,p_position_id uuid
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor_org uuid;
  v_target_org uuid;
  v_department_org uuid;
  v_position public.staff_positions;
begin
  select actor_ou.organization_id into v_actor_org
  from public.users u
  join public.organization_units actor_ou on actor_ou.id=u.organization_unit_id
  join public.user_roles ur on ur.user_id=u.id
  join public.roles r on r.id=ur.role_id
  where u.id=p_actor_user_id and u.is_active=true and r.name='ADMIN'
  limit 1;
  if v_actor_org is null then raise exception 'ADMIN_REQUIRED'; end if;

  select organization_id into v_department_org
  from public.organization_units
  where id=p_department_id and is_active=true;
  if v_department_org is null then raise exception 'DEPARTMENT_NOT_FOUND'; end if;
  if v_department_org<>v_actor_org then raise exception 'TENANT_MISMATCH'; end if;

  select * into v_position from public.staff_positions where id=p_position_id and is_active=true;
  if not found then raise exception 'POSITION_NOT_FOUND'; end if;
  if v_position.organization_unit_id<>p_department_id then raise exception 'POSITION_DEPARTMENT_MISMATCH'; end if;

  select ou.organization_id into v_target_org
  from public.users u
  left join public.organization_units ou on ou.id=u.organization_unit_id
  where u.id=p_user_id;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
  if v_target_org is distinct from v_actor_org then raise exception 'TENANT_MISMATCH'; end if;

  update public.users
  set organization_unit_id=p_department_id,position_id=p_position_id,position=v_position.name,updated_at=now()
  where id=p_user_id;
end;
$$;

create or replace function public.staff_admin_approve_registration_system(
  p_actor_user_id uuid,p_request_id uuid,p_role_ids uuid[],p_department_id uuid,p_position_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_req public.staff_registration_requests;
  v_user_id uuid;
  v_role_count integer;
  v_position public.staff_positions;
  v_actor_org uuid;
  v_department_org uuid;
  v_existing_org uuid;
begin
  select actor_ou.organization_id into v_actor_org
  from public.users u
  join public.organization_units actor_ou on actor_ou.id=u.organization_unit_id
  join public.user_roles ur on ur.user_id=u.id
  join public.roles r on r.id=ur.role_id
  where u.id=p_actor_user_id and u.is_active=true and r.name='ADMIN'
  limit 1;
  if v_actor_org is null then raise exception 'ADMIN_REQUIRED'; end if;

  if coalesce(array_length(p_role_ids,1),0)=0 then raise exception 'ROLE_REQUIRED'; end if;
  select count(*) into v_role_count from public.roles where id=any(p_role_ids);
  if v_role_count<>array_length(p_role_ids,1) then raise exception 'INVALID_ROLE'; end if;

  select organization_id into v_department_org from public.organization_units where id=p_department_id and is_active=true;
  if v_department_org is null then raise exception 'DEPARTMENT_NOT_FOUND'; end if;
  if v_department_org<>v_actor_org then raise exception 'TENANT_MISMATCH'; end if;

  select * into v_position from public.staff_positions where id=p_position_id and is_active=true;
  if not found then raise exception 'POSITION_NOT_FOUND'; end if;
  if v_position.organization_unit_id<>p_department_id then raise exception 'POSITION_DEPARTMENT_MISMATCH'; end if;

  select * into v_req
  from public.staff_registration_requests
  where id=p_request_id and organization_id=v_actor_org
  for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if v_req.status<>'PENDING' then raise exception 'REQUEST_ALREADY_REVIEWED'; end if;

  select ou.organization_id into v_existing_org
  from public.users u
  left join public.organization_units ou on ou.id=u.organization_unit_id
  where u.auth_user_id=v_req.auth_user_id;
  if found and v_existing_org is distinct from v_actor_org then raise exception 'USER_TENANT_MISMATCH'; end if;

  insert into public.users(auth_user_id,full_name,email,phone,is_active,organization_unit_id,position_id,position,created_at,updated_at)
  values(v_req.auth_user_id,v_req.full_name,v_req.email,v_req.phone,true,p_department_id,p_position_id,v_position.name,now(),now())
  on conflict(auth_user_id) do update set
    full_name=excluded.full_name,email=excluded.email,phone=excluded.phone,is_active=true,
    organization_unit_id=excluded.organization_unit_id,position_id=excluded.position_id,
    position=excluded.position,updated_at=now()
  returning id into v_user_id;

  delete from public.user_roles where user_id=v_user_id;
  insert into public.user_roles(user_id,role_id) select v_user_id,unnest(p_role_ids);

  update public.staff_registration_requests
  set status='APPROVED',reviewed_at=now(),reviewed_by=p_actor_user_id,rejection_reason=null,updated_at=now()
  where id=p_request_id;

  return v_user_id;
end;
$$;

create or replace function public.staff_admin_reject_registration_system(
  p_actor_user_id uuid,p_request_id uuid,p_reason text default null
)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor_org uuid;
begin
  select actor_ou.organization_id into v_actor_org
  from public.users u
  join public.organization_units actor_ou on actor_ou.id=u.organization_unit_id
  join public.user_roles ur on ur.user_id=u.id
  join public.roles r on r.id=ur.role_id
  where u.id=p_actor_user_id and u.is_active=true and r.name='ADMIN'
  limit 1;
  if v_actor_org is null then raise exception 'ADMIN_REQUIRED'; end if;

  update public.staff_registration_requests
  set status='REJECTED',rejection_reason=nullif(trim(coalesce(p_reason,'')),''),
      reviewed_at=now(),reviewed_by=p_actor_user_id,updated_at=now()
  where id=p_request_id and organization_id=v_actor_org and status='PENDING';

  if not found then raise exception 'REQUEST_NOT_FOUND_OR_REVIEWED'; end if;
end;
$$;

revoke execute on function public.staff_admin_set_assignment_system(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.staff_admin_set_assignment_system(uuid,uuid,uuid,uuid) to service_role;
revoke execute on function public.staff_admin_approve_registration_system(uuid,uuid,uuid[],uuid,uuid) from public,anon,authenticated;
grant execute on function public.staff_admin_approve_registration_system(uuid,uuid,uuid[],uuid,uuid) to service_role;
revoke execute on function public.staff_admin_reject_registration_system(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.staff_admin_reject_registration_system(uuid,uuid,text) to service_role;
