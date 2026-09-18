-- A4PRINT HUB: Production Farm Phase 39 — tenant-scoped production settings.

alter table public.production_dispatch_settings
  add column organization_id uuid references public.organizations(id) on delete restrict;

alter table public.production_dispatch_settings
  drop constraint production_dispatch_settings_pkey;

insert into public.production_dispatch_settings(
  id,organization_id,timezone,workday_start,planning_horizon_days,
  setup_gap_minutes,updated_at,updated_by
)
select
  s.id,o.id,s.timezone,s.workday_start,s.planning_horizon_days,
  s.setup_gap_minutes,s.updated_at,s.updated_by
from public.production_dispatch_settings s
cross join public.organizations o
where s.organization_id is null
  and o.is_active=true;

delete from public.production_dispatch_settings
where organization_id is null;

alter table public.production_dispatch_settings
  alter column organization_id set not null;

alter table public.production_dispatch_settings
  add constraint production_dispatch_settings_pkey primary key(organization_id);

drop policy if exists production_dispatch_settings_read
  on public.production_dispatch_settings;
create policy production_dispatch_settings_read
on public.production_dispatch_settings
for select to authenticated
using(
  organization_id=public.current_user_organization_id()
  and (
    public.has_permission('production.view')
    or public.has_permission('production.analytics.view')
    or public.has_permission('production.manage')
  )
);

alter table public.production_monitor_settings
  add column organization_id uuid references public.organizations(id) on delete restrict;

alter table public.production_monitor_settings
  drop constraint production_monitor_settings_pkey;

insert into public.production_monitor_settings(
  id,organization_id,lookback_days,utilization_warn_percent,
  quality_warn_percent,downtime_warn_percent,margin_warn_amount,
  service_due_days,updated_by,updated_at
)
select
  s.id,o.id,s.lookback_days,s.utilization_warn_percent,
  s.quality_warn_percent,s.downtime_warn_percent,s.margin_warn_amount,
  s.service_due_days,s.updated_by,s.updated_at
from public.production_monitor_settings s
cross join public.organizations o
where s.organization_id is null
  and o.is_active=true;

delete from public.production_monitor_settings
where organization_id is null;

alter table public.production_monitor_settings
  alter column organization_id set not null;

alter table public.production_monitor_settings
  add constraint production_monitor_settings_pkey primary key(organization_id);

drop policy if exists production_monitor_settings_staff_read
  on public.production_monitor_settings;
create policy production_monitor_settings_staff_read
on public.production_monitor_settings
for select to authenticated
using(
  organization_id=public.current_user_organization_id()
  and (
    public.has_permission('production.view')
    or public.has_permission('production.analytics.view')
  )
);

create or replace function public.save_production_dispatch_settings(
  p_timezone text,
  p_workday_start time without time zone,
  p_planning_horizon_days integer,
  p_setup_gap_minutes integer
)
returns smallint
language plpgsql
security definer
set search_path=''
as $$
declare
  v_org uuid:=public.current_user_organization_id();
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_org is null then raise exception 'ORGANIZATION_CONTEXT_REQUIRED'; end if;
  if not public.has_permission('production.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_timezone is null or not exists(
    select 1 from pg_catalog.pg_timezone_names where name=p_timezone
  ) then raise exception 'INVALID_TIMEZONE'; end if;
  if p_workday_start is null then raise exception 'WORKDAY_START_REQUIRED'; end if;
  if p_planning_horizon_days not between 1 and 120 then raise exception 'INVALID_PLANNING_HORIZON'; end if;
  if p_setup_gap_minutes not between 0 and 240 then raise exception 'INVALID_SETUP_GAP'; end if;

  insert into public.production_dispatch_settings(
    id,organization_id,timezone,workday_start,planning_horizon_days,
    setup_gap_minutes,updated_at,updated_by
  ) values(
    1,v_org,p_timezone,p_workday_start,p_planning_horizon_days,
    p_setup_gap_minutes,now(),auth.uid()
  )
  on conflict(organization_id) do update
  set timezone=excluded.timezone,
      workday_start=excluded.workday_start,
      planning_horizon_days=excluded.planning_horizon_days,
      setup_gap_minutes=excluded.setup_gap_minutes,
      updated_at=now(),
      updated_by=auth.uid();

  return 1;
end
$$;

revoke all on function public.save_production_dispatch_settings(text,time without time zone,integer,integer)
  from public,anon,authenticated;
grant execute on function public.save_production_dispatch_settings(text,time without time zone,integer,integer)
  to authenticated;

create or replace function public.save_production_monitor_settings(
  p_lookback_days integer,
  p_utilization_warn_percent numeric,
  p_quality_warn_percent numeric,
  p_downtime_warn_percent numeric,
  p_margin_warn_amount numeric,
  p_service_due_days integer
)
returns public.production_monitor_settings
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row public.production_monitor_settings%rowtype;
  v_actor uuid:=public.current_staff_user_id();
  v_org uuid:=public.current_user_organization_id();
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_org is null then raise exception 'ORGANIZATION_CONTEXT_REQUIRED'; end if;
  if not public.has_permission('production.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_lookback_days is null or p_lookback_days not between 1 and 365 then raise exception 'INVALID_LOOKBACK_DAYS'; end if;
  if p_utilization_warn_percent is null or p_utilization_warn_percent<0 or p_utilization_warn_percent>100 then raise exception 'INVALID_UTILIZATION_THRESHOLD'; end if;
  if p_quality_warn_percent is null or p_quality_warn_percent<0 or p_quality_warn_percent>100 then raise exception 'INVALID_QUALITY_THRESHOLD'; end if;
  if p_downtime_warn_percent is null or p_downtime_warn_percent<0 or p_downtime_warn_percent>100 then raise exception 'INVALID_DOWNTIME_THRESHOLD'; end if;
  if p_margin_warn_amount is null then raise exception 'INVALID_MARGIN_THRESHOLD'; end if;
  if p_service_due_days is null or p_service_due_days not between 0 and 90 then raise exception 'INVALID_SERVICE_DUE_DAYS'; end if;

  insert into public.production_monitor_settings(
    id,organization_id,lookback_days,utilization_warn_percent,
    quality_warn_percent,downtime_warn_percent,margin_warn_amount,
    service_due_days,updated_by,updated_at
  ) values(
    true,v_org,p_lookback_days,p_utilization_warn_percent,
    p_quality_warn_percent,p_downtime_warn_percent,p_margin_warn_amount,
    p_service_due_days,v_actor,clock_timestamp()
  )
  on conflict(organization_id) do update
  set lookback_days=excluded.lookback_days,
      utilization_warn_percent=excluded.utilization_warn_percent,
      quality_warn_percent=excluded.quality_warn_percent,
      downtime_warn_percent=excluded.downtime_warn_percent,
      margin_warn_amount=excluded.margin_warn_amount,
      service_due_days=excluded.service_due_days,
      updated_by=excluded.updated_by,
      updated_at=excluded.updated_at
  returning * into v_row;

  return v_row;
end
$$;

revoke all on function public.save_production_monitor_settings(integer,numeric,numeric,numeric,numeric,integer)
  from public,anon,authenticated;
grant execute on function public.save_production_monitor_settings(integer,numeric,numeric,numeric,numeric,integer)
  to authenticated;

do $$
declare
  v_oid oid;
  v_def text;
begin
  v_oid:=to_regprocedure(
    'public.production_find_dispatch_slot_internal(uuid,timestamptz,uuid,date,integer)'
  );
  if v_oid is null then raise exception 'RPC_NOT_FOUND:production_find_dispatch_slot_internal'; end if;

  select pg_get_functiondef(v_oid) into v_def;

  v_def:=replace(
    v_def,
    'select * into v_settings from public.production_dispatch_settings s where s.id=1;',
    'select * into v_settings from public.production_dispatch_settings s where s.id=1 and s.organization_id=v_job.organization_id;'
  );

  execute v_def;
end
$$;
