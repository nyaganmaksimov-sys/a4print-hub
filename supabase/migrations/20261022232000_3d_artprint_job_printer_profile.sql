-- Printer profile assignment to production job: optional 1:1 mapping.
create table if not exists public.production_job_printer_profiles (
 production_job_id uuid primary key references public.production_jobs(id) on delete cascade,
 organization_id uuid not null references public.organizations(id),
 printer_profile_id uuid not null references public.production_printer_profiles(id),
 assigned_at timestamptz not null default now()
);
create or replace function public.validate_production_job_printer_profile()
returns trigger language plpgsql security invoker set search_path = ''
as $$
declare job_org uuid; job_asset uuid; profile_org uuid; profile_asset uuid; profile_active boolean;
begin
 select j.organization_id,j.equipment_id into job_org,job_asset from public.production_jobs j where j.id=new.production_job_id;
 select p.organization_id,p.equipment_id,p.is_active into profile_org,profile_asset,profile_active from public.production_printer_profiles p where p.id=new.printer_profile_id;
 if job_org is null or job_asset is null or profile_org is null or not coalesce(profile_active,false)
 or new.organization_id<>job_org or job_org<>profile_org or job_asset<>profile_asset
 or job_org is distinct from public.current_user_organization_id()
 then raise exception 'PRINTER_PROFILE_JOB_MISMATCH'; end if;
 return new;
end $$;
revoke all on function public.validate_production_job_printer_profile() from public,anon,authenticated;
drop trigger if exists trg_validate_production_job_printer_profile on public.production_job_printer_profiles;
create trigger trg_validate_production_job_printer_profile
before insert or update on public.production_job_printer_profiles
for each row execute function public.validate_production_job_printer_profile();
alter table public.production_job_printer_profiles enable row level security;
create policy job_printer_profile_read on public.production_job_printer_profiles
for select to authenticated using(organization_id=(select public.current_user_organization_id()) and (select public.is_hub_staff()));
create policy job_printer_profile_insert on public.production_job_printer_profiles
for insert to authenticated with check(organization_id=(select public.current_user_organization_id()) and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('PRODUCTION')));
create policy job_printer_profile_update on public.production_job_printer_profiles
for update to authenticated using(organization_id=(select public.current_user_organization_id()) and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('PRODUCTION')))
with check(organization_id=(select public.current_user_organization_id()) and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('PRODUCTION')));
create policy job_printer_profile_delete on public.production_job_printer_profiles
for delete to authenticated using(organization_id=(select public.current_user_organization_id()) and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('PRODUCTION')));
revoke all on public.production_job_printer_profiles from public,anon;
grant select,insert,update,delete on public.production_job_printer_profiles to authenticated;
grant all on public.production_job_printer_profiles to service_role;
