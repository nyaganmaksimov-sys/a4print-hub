-- PHASE 2 CORE MULTI-COMPANY
-- Tenant ownership for production jobs and explicit shared warehouses.

create schema if not exists private;

alter table public.production_jobs
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;

create index if not exists idx_production_jobs_organization_id
  on public.production_jobs(organization_id);

update public.production_jobs pj
set organization_id=o.organization_id
from public.orders o
where pj.order_id=o.id
  and pj.organization_id is null
  and o.organization_id is not null;

create or replace function private.assign_production_job_organization()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_order_org uuid;
begin
  if new.order_id is null then
    return new;
  end if;

  select organization_id into v_order_org
  from public.orders
  where id=new.order_id;

  if v_order_org is null then
    return new;
  end if;

  if new.organization_id is not null and new.organization_id<>v_order_org then
    raise exception 'PRODUCTION_JOB_ORGANIZATION_MISMATCH';
  end if;

  new.organization_id:=v_order_org;
  return new;
end;
$$;

revoke all on function private.assign_production_job_organization() from public,anon,authenticated;

drop trigger if exists trg_production_jobs_assign_organization on public.production_jobs;
create trigger trg_production_jobs_assign_organization
before insert or update of order_id,organization_id
on public.production_jobs
for each row
execute function private.assign_production_job_organization();

alter table public.warehouses
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict,
  add column if not exists is_shared boolean not null default false;

create index if not exists idx_warehouses_organization_id
  on public.warehouses(organization_id);

update public.warehouses w
set organization_id=o.id,is_shared=false
from public.organizations o
where w.organization_id is null
  and (
    (w.business_unit::text='A4_PRINT' and o.code='A4PRINT')
    or
    (w.business_unit::text='3D_ARTPRINT' and o.code='3DARTPRINT')
  );

update public.warehouses
set organization_id=null,is_shared=true
where business_unit::text='COMMON';

create or replace function private.assign_warehouse_organization()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  if new.business_unit::text='COMMON' then
    new.organization_id:=null;
    new.is_shared:=true;
    return new;
  end if;

  if new.business_unit::text='A4_PRINT' then
    select id into new.organization_id from public.organizations where code='A4PRINT' limit 1;
    new.is_shared:=false;
  elsif new.business_unit::text='3D_ARTPRINT' then
    select id into new.organization_id from public.organizations where code='3DARTPRINT' limit 1;
    new.is_shared:=false;
  end if;

  return new;
end;
$$;

revoke all on function private.assign_warehouse_organization() from public,anon,authenticated;

drop trigger if exists trg_warehouses_assign_organization on public.warehouses;
create trigger trg_warehouses_assign_organization
before insert or update of business_unit
on public.warehouses
for each row
execute function private.assign_warehouse_organization();

comment on column public.production_jobs.organization_id is
  'Tenant organization inherited from the linked order when available.';

comment on column public.warehouses.organization_id is
  'Owning organization for company-specific warehouses; null for explicitly shared warehouses.';

comment on column public.warehouses.is_shared is
  'True only for warehouses intentionally shared across organizations.';
