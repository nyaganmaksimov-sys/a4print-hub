-- Staff organization structure: department + position
alter table public.users add column if not exists organization_unit_id uuid references public.organization_units(id) on delete set null;
alter table public.users add column if not exists position text;

create unique index if not exists organization_units_org_code_uidx
  on public.organization_units(organization_id,code);

insert into public.organization_units(organization_id,name,code,is_active)
select o.id,v.name,v.code,true
from public.organizations o
cross join (values
  ('Руководство','MANAGEMENT'),
  ('Менеджеры и продажи','SALES'),
  ('Производство','PRODUCTION'),
  ('Дизайн','DESIGN'),
  ('Склад','WAREHOUSE'),
  ('Бухгалтерия','ACCOUNTING')
) as v(name,code)
where o.code in ('A4PRINT','3DARTPRINT')
on conflict(organization_id,code) do update set name=excluded.name,is_active=true;

create or replace function public.approve_staff_registration_v2(
  p_request_id uuid,
  p_role_ids uuid[],
  p_department_id uuid,
  p_position text
) returns uuid
language plpgsql security definer set search_path=''
as $$
declare
  v_admin public.users;
  v_req public.staff_registration_requests;
  v_user_id uuid;
  v_role_count int;
  v_position text;
begin
  select u.* into v_admin
  from public.users u
  join public.user_roles ur on ur.user_id=u.id
  join public.roles r on r.id=ur.role_id
  where u.auth_user_id=auth.uid() and u.is_active=true and r.name='ADMIN'
  limit 1;
  if not found then raise exception 'ADMIN_REQUIRED'; end if;

  if coalesce(array_length(p_role_ids,1),0)=0 then raise exception 'ROLE_REQUIRED'; end if;
  select count(*) into v_role_count from public.roles where id=any(p_role_ids);
  if v_role_count<>array_length(p_role_ids,1) then raise exception 'INVALID_ROLE'; end if;

  if p_department_id is null or not exists(
    select 1 from public.organization_units ou where ou.id=p_department_id and ou.is_active=true
  ) then raise exception 'DEPARTMENT_REQUIRED'; end if;

  v_position:=nullif(trim(coalesce(p_position,'')),'');
  if v_position is null then raise exception 'POSITION_REQUIRED'; end if;

  select * into v_req from public.staff_registration_requests where id=p_request_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if v_req.status<>'PENDING' then raise exception 'REQUEST_ALREADY_REVIEWED'; end if;

  insert into public.users(auth_user_id,full_name,email,phone,is_active,organization_unit_id,position,created_at,updated_at)
  values(v_req.auth_user_id,v_req.full_name,v_req.email,v_req.phone,true,p_department_id,v_position,now(),now())
  on conflict(auth_user_id) do update set
    full_name=excluded.full_name,email=excluded.email,phone=excluded.phone,is_active=true,
    organization_unit_id=excluded.organization_unit_id,position=excluded.position,updated_at=now()
  returning id into v_user_id;

  delete from public.user_roles where user_id=v_user_id;
  insert into public.user_roles(user_id,role_id) select v_user_id,unnest(p_role_ids);

  update public.staff_registration_requests
  set status='APPROVED',reviewed_at=now(),reviewed_by=v_admin.id,rejection_reason=null,updated_at=now()
  where id=p_request_id;
  return v_user_id;
end;
$$;
grant execute on function public.approve_staff_registration_v2(uuid,uuid[],uuid,text) to authenticated;

create or replace function public.admin_set_staff_assignment(
  p_user_id uuid,
  p_department_id uuid,
  p_position text
) returns void
language plpgsql security definer set search_path=''
as $$
begin
  if not public.has_role('ADMIN') then raise exception 'ADMIN_REQUIRED'; end if;
  if p_department_id is null or not exists(
    select 1 from public.organization_units ou where ou.id=p_department_id and ou.is_active=true
  ) then raise exception 'DEPARTMENT_REQUIRED'; end if;
  if nullif(trim(coalesce(p_position,'')),'') is null then raise exception 'POSITION_REQUIRED'; end if;
  update public.users
  set organization_unit_id=p_department_id,position=trim(p_position),updated_at=now()
  where id=p_user_id;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
end;
$$;
grant execute on function public.admin_set_staff_assignment(uuid,uuid,text) to authenticated;
