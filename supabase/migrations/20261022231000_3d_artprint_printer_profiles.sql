-- 3D-ARTPRINT printer slicer profiles, one physical asset may own many profiles.
-- Apply only after review and tenant regression checks.
create table if not exists public.production_printer_profiles (
 id uuid primary key default gen_random_uuid(),
 organization_id uuid not null references public.organizations(id) on delete restrict,
 equipment_id uuid not null references public.equipment_assets(id) on delete cascade,
 name text not null check (length(btrim(name)) between 1 and 160),
 slicer text not null default 'OrcaSlicer',
 nozzle_mm numeric(5,2) check (nozzle_mm is null or nozzle_mm > 0),
 machine_lifetime_hours numeric(12,2) check (machine_lifetime_hours is null or machine_lifetime_hours > 0),
 operation_cost_per_hour numeric(12,2) check (operation_cost_per_hour is null or operation_cost_per_hour >= 0),
 is_active boolean not null default true,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(equipment_id,name)
);
create index if not exists production_printer_profiles_org_equipment_idx on public.production_printer_profiles(organization_id,equipment_id);
create or replace function public.production_printer_profile_guard()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare actual_org uuid; current_org uuid;
begin
 select a.organization_id into actual_org from public.equipment_assets a where a.id=new.equipment_id;
 current_org:=public.current_user_organization_id();
 if current_org is null or actual_org is null or actual_org<>current_org or new.organization_id<>actual_org
 then raise exception 'PRINTER_PROFILE_TENANT_MISMATCH'; end if;
 if not exists(select 1 from public.organizations o where o.id=actual_org and o.code='3DARTPRINT')
 then raise exception 'PRINTER_PROFILE_ORGANIZATION_MISMATCH'; end if;
 new.updated_at=now();
 return new;
end $$;
revoke all on function public.production_printer_profile_guard() from public,anon,authenticated;
drop trigger if exists trg_production_printer_profile_guard on public.production_printer_profiles;
create trigger trg_production_printer_profile_guard before insert or update
on public.production_printer_profiles for each row execute function public.production_printer_profile_guard();
alter table public.production_printer_profiles enable row level security;
drop policy if exists printer_profiles_read on public.production_printer_profiles;
create policy printer_profiles_read on public.production_printer_profiles for select to authenticated
using(organization_id=(select public.current_user_organization_id()) and (select public.is_hub_staff()));
drop policy if exists printer_profiles_insert on public.production_printer_profiles;
create policy printer_profiles_insert on public.production_printer_profiles for insert to authenticated
with check(organization_id=(select public.current_user_organization_id()) and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('PRODUCTION')));
drop policy if exists printer_profiles_update on public.production_printer_profiles;
create policy printer_profiles_update on public.production_printer_profiles for update to authenticated
using(organization_id=(select public.current_user_organization_id()) and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('PRODUCTION')))
with check(organization_id=(select public.current_user_organization_id()) and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('PRODUCTION')));
revoke all on public.production_printer_profiles from public,anon;
grant select,insert,update on public.production_printer_profiles to authenticated;
grant all on public.production_printer_profiles to service_role;
