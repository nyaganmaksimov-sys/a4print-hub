create table if not exists public.staff_positions (
  id uuid primary key default gen_random_uuid(),
  organization_unit_id uuid not null references public.organization_units(id) on delete cascade,
  name text not null,
  code text null,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(organization_unit_id,name)
);

alter table public.staff_positions enable row level security;

drop policy if exists staff_positions_read on public.staff_positions;
create policy staff_positions_read on public.staff_positions
for select to authenticated using (public.is_hub_staff());

drop policy if exists staff_positions_admin_write on public.staff_positions;
create policy staff_positions_admin_write on public.staff_positions
for all to authenticated using (public.has_role('ADMIN')) with check (public.has_role('ADMIN'));

alter table public.users add column if not exists position_id uuid null references public.staff_positions(id) on delete set null;

create or replace function public.admin_set_staff_assignment_v2(p_user_id uuid,p_department_id uuid,p_position_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare v_position public.staff_positions;
begin
  if not public.has_role('ADMIN') then raise exception 'ADMIN_REQUIRED'; end if;
  select * into v_position from public.staff_positions where id=p_position_id and is_active=true;
  if not found then raise exception 'POSITION_NOT_FOUND'; end if;
  if v_position.organization_unit_id<>p_department_id then raise exception 'POSITION_DEPARTMENT_MISMATCH'; end if;
  update public.users set organization_unit_id=p_department_id,position_id=p_position_id,position=v_position.name,updated_at=now() where id=p_user_id;
  if not found then raise exception 'USER_NOT_FOUND'; end if;
end;$$;

grant execute on function public.admin_set_staff_assignment_v2(uuid,uuid,uuid) to authenticated;

create or replace function public.approve_staff_registration_v3(p_request_id uuid,p_role_ids uuid[],p_department_id uuid,p_position_id uuid)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_admin public.users; v_req public.staff_registration_requests; v_user_id uuid; v_role_count int; v_position public.staff_positions;
begin
  select u.* into v_admin from public.users u join public.user_roles ur on ur.user_id=u.id join public.roles r on r.id=ur.role_id where u.auth_user_id=auth.uid() and u.is_active=true and r.name='ADMIN' limit 1;
  if not found then raise exception 'ADMIN_REQUIRED'; end if;
  if coalesce(array_length(p_role_ids,1),0)=0 then raise exception 'ROLE_REQUIRED'; end if;
  select count(*) into v_role_count from public.roles where id=any(p_role_ids);
  if v_role_count<>array_length(p_role_ids,1) then raise exception 'INVALID_ROLE'; end if;
  select * into v_position from public.staff_positions where id=p_position_id and is_active=true;
  if not found then raise exception 'POSITION_NOT_FOUND'; end if;
  if v_position.organization_unit_id<>p_department_id then raise exception 'POSITION_DEPARTMENT_MISMATCH'; end if;
  select * into v_req from public.staff_registration_requests where id=p_request_id for update;
  if not found then raise exception 'REQUEST_NOT_FOUND'; end if;
  if v_req.status<>'PENDING' then raise exception 'REQUEST_ALREADY_REVIEWED'; end if;
  insert into public.users(auth_user_id,full_name,email,phone,is_active,organization_unit_id,position_id,position,created_at,updated_at)
  values(v_req.auth_user_id,v_req.full_name,v_req.email,v_req.phone,true,p_department_id,p_position_id,v_position.name,now(),now())
  on conflict(auth_user_id) do update set full_name=excluded.full_name,email=excluded.email,phone=excluded.phone,is_active=true,organization_unit_id=excluded.organization_unit_id,position_id=excluded.position_id,position=excluded.position,updated_at=now()
  returning id into v_user_id;
  delete from public.user_roles where user_id=v_user_id;
  insert into public.user_roles(user_id,role_id) select v_user_id,unnest(p_role_ids);
  update public.staff_registration_requests set status='APPROVED',reviewed_at=now(),reviewed_by=v_admin.id,rejection_reason=null,updated_at=now() where id=p_request_id;
  return v_user_id;
end;$$;

grant execute on function public.approve_staff_registration_v3(uuid,uuid[],uuid,uuid) to authenticated;

create or replace function public.admin_create_department(p_organization_id uuid,p_name text,p_code text default null)
returns uuid language plpgsql security definer set search_path='' as $$declare v_id uuid; begin if not public.has_role('ADMIN') then raise exception 'ADMIN_REQUIRED'; end if; if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'NAME_REQUIRED'; end if; insert into public.organization_units(organization_id,name,code,is_active,created_at) values(p_organization_id,trim(p_name),nullif(upper(trim(coalesce(p_code,''))),''),true,now()) returning id into v_id; return v_id; end;$$;
grant execute on function public.admin_create_department(uuid,text,text) to authenticated;

create or replace function public.admin_update_department(p_department_id uuid,p_name text,p_code text,p_is_active boolean)
returns void language plpgsql security definer set search_path='' as $$begin if not public.has_role('ADMIN') then raise exception 'ADMIN_REQUIRED'; end if; update public.organization_units set name=trim(p_name),code=nullif(upper(trim(coalesce(p_code,''))),''),is_active=p_is_active where id=p_department_id; if not found then raise exception 'DEPARTMENT_NOT_FOUND'; end if; end;$$;
grant execute on function public.admin_update_department(uuid,text,text,boolean) to authenticated;

create or replace function public.admin_create_position(p_department_id uuid,p_name text,p_code text default null)
returns uuid language plpgsql security definer set search_path='' as $$declare v_id uuid; begin if not public.has_role('ADMIN') then raise exception 'ADMIN_REQUIRED'; end if; if nullif(trim(coalesce(p_name,'')),'') is null then raise exception 'NAME_REQUIRED'; end if; insert into public.staff_positions(organization_unit_id,name,code,is_active) values(p_department_id,trim(p_name),nullif(upper(trim(coalesce(p_code,''))),''),true) returning id into v_id; return v_id; end;$$;
grant execute on function public.admin_create_position(uuid,text,text) to authenticated;

create or replace function public.admin_update_position(p_position_id uuid,p_name text,p_code text,p_is_active boolean)
returns void language plpgsql security definer set search_path='' as $$begin if not public.has_role('ADMIN') then raise exception 'ADMIN_REQUIRED'; end if; update public.staff_positions set name=trim(p_name),code=nullif(upper(trim(coalesce(p_code,''))),''),is_active=p_is_active,updated_at=now() where id=p_position_id; if not found then raise exception 'POSITION_NOT_FOUND'; end if; update public.users set position=trim(p_name),updated_at=now() where position_id=p_position_id; end;$$;
grant execute on function public.admin_update_position(uuid,text,text,boolean) to authenticated;