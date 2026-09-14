-- Production Farm phase 11: configurable production monitoring and equipment alerts.
-- Alerts are read models over canonical production/OEE/service facts; they never mutate production history.

create table if not exists public.production_monitor_settings (
  id boolean primary key default true check(id),
  lookback_days integer not null default 30 check(lookback_days between 1 and 365),
  utilization_warn_percent numeric(5,2) not null default 85 check(utilization_warn_percent between 0 and 100),
  quality_warn_percent numeric(5,2) not null default 95 check(quality_warn_percent between 0 and 100),
  downtime_warn_percent numeric(5,2) not null default 10 check(downtime_warn_percent between 0 and 100),
  margin_warn_amount numeric(14,2) not null default 0,
  service_due_days integer not null default 14 check(service_due_days between 0 and 90),
  updated_by uuid references public.users(id) on delete set null,
  updated_at timestamptz not null default clock_timestamp()
);

insert into public.production_monitor_settings(id)
values(true)
on conflict(id) do nothing;

alter table public.production_monitor_settings enable row level security;
drop policy if exists production_monitor_settings_staff_read on public.production_monitor_settings;
create policy production_monitor_settings_staff_read on public.production_monitor_settings
for select to authenticated
using(public.has_permission('production.view') or public.has_permission('production.analytics.view'));

revoke all on public.production_monitor_settings from public,anon,authenticated;
grant select on public.production_monitor_settings to authenticated;

create or replace function public.save_production_monitor_settings(
  p_lookback_days integer,
  p_utilization_warn_percent numeric,
  p_quality_warn_percent numeric,
  p_downtime_warn_percent numeric,
  p_margin_warn_amount numeric,
  p_service_due_days integer
) returns public.production_monitor_settings
language plpgsql
security definer
set search_path=public
as $$
declare
  v_row public.production_monitor_settings%rowtype;
  v_actor uuid:=public.current_staff_user_id();
begin
  if not public.has_permission('production.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_lookback_days is null or p_lookback_days not between 1 and 365 then raise exception 'INVALID_LOOKBACK_DAYS'; end if;
  if p_utilization_warn_percent is null or p_utilization_warn_percent<0 or p_utilization_warn_percent>100 then raise exception 'INVALID_UTILIZATION_THRESHOLD'; end if;
  if p_quality_warn_percent is null or p_quality_warn_percent<0 or p_quality_warn_percent>100 then raise exception 'INVALID_QUALITY_THRESHOLD'; end if;
  if p_downtime_warn_percent is null or p_downtime_warn_percent<0 or p_downtime_warn_percent>100 then raise exception 'INVALID_DOWNTIME_THRESHOLD'; end if;
  if p_margin_warn_amount is null then raise exception 'INVALID_MARGIN_THRESHOLD'; end if;
  if p_service_due_days is null or p_service_due_days not between 0 and 90 then raise exception 'INVALID_SERVICE_DUE_DAYS'; end if;

  insert into public.production_monitor_settings(
    id,lookback_days,utilization_warn_percent,quality_warn_percent,
    downtime_warn_percent,margin_warn_amount,service_due_days,updated_by,updated_at
  ) values(
    true,p_lookback_days,p_utilization_warn_percent,p_quality_warn_percent,
    p_downtime_warn_percent,p_margin_warn_amount,p_service_due_days,v_actor,clock_timestamp()
  )
  on conflict(id) do update set
    lookback_days=excluded.lookback_days,
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

revoke all on function public.save_production_monitor_settings(integer,numeric,numeric,numeric,numeric,integer) from public,anon;
grant execute on function public.save_production_monitor_settings(integer,numeric,numeric,numeric,numeric,integer) to authenticated;

create or replace view public.production_equipment_monitor
with (security_invoker=true)
as
with settings as (
  select * from public.production_monitor_settings where id=true
),
oee as (
  select
    d.equipment_id,
    coalesce(sum(d.runtime_minutes),0)::numeric as runtime_minutes,
    coalesce(sum(d.downtime_minutes),0)::numeric as downtime_minutes,
    coalesce(sum(d.pause_events),0)::bigint as pause_events,
    coalesce(sum(d.good_quantity),0)::numeric as good_quantity,
    coalesce(sum(d.scrap_quantity),0)::numeric as scrap_quantity,
    coalesce(sum(d.rework_quantity),0)::numeric as rework_quantity,
    coalesce(sum(d.planned_machine_minutes),0)::numeric as planned_machine_minutes,
    coalesce(sum(d.actual_machine_minutes),0)::numeric as actual_machine_minutes,
    coalesce(sum(d.operation_revenue),0)::numeric as operation_revenue,
    coalesce(sum(d.production_cost),0)::numeric as production_cost
  from public.production_oee_daily d
  cross join settings s
  where d.metric_date >= current_date-(s.lookback_days-1)
    and d.metric_date <= current_date
  group by d.equipment_id
),
capacity as (
  select c.equipment_id,coalesce(sum(c.available_minutes),0)::numeric as available_minutes
  from settings s
  cross join lateral public.production_capacity_between(current_date-(s.lookback_days-1),current_date) c
  group by c.equipment_id
),
base as (
  select
    a.id as equipment_id,
    a.inventory_number,
    a.name as equipment_name,
    a.status,
    a.operational_status,
    a.next_service_date,
    s.lookback_days,
    s.utilization_warn_percent,
    s.quality_warn_percent,
    s.downtime_warn_percent,
    s.margin_warn_amount,
    s.service_due_days,
    coalesce(o.runtime_minutes,0)::numeric as runtime_minutes,
    coalesce(o.downtime_minutes,0)::numeric as downtime_minutes,
    coalesce(o.pause_events,0)::bigint as pause_events,
    coalesce(o.good_quantity,0)::numeric as good_quantity,
    coalesce(o.scrap_quantity,0)::numeric as scrap_quantity,
    coalesce(o.rework_quantity,0)::numeric as rework_quantity,
    coalesce(o.planned_machine_minutes,0)::numeric as planned_machine_minutes,
    coalesce(o.actual_machine_minutes,0)::numeric as actual_machine_minutes,
    coalesce(o.operation_revenue,0)::numeric as operation_revenue,
    coalesce(o.production_cost,0)::numeric as production_cost,
    coalesce(c.available_minutes,0)::numeric as available_minutes
  from public.equipment_assets a
  cross join settings s
  left join oee o on o.equipment_id=a.id
  left join capacity c on c.equipment_id=a.id
  where a.status<>'WRITTEN_OFF'
),
metrics as (
  select
    b.*,
    case when b.available_minutes>0 then round(b.runtime_minutes/b.available_minutes*100,2) end as utilization_percent,
    case when (b.runtime_minutes+b.downtime_minutes)>0 then round(b.downtime_minutes/(b.runtime_minutes+b.downtime_minutes)*100,2) end as downtime_percent,
    case when (b.good_quantity+b.scrap_quantity+b.rework_quantity)>0 then round(b.good_quantity/(b.good_quantity+b.scrap_quantity+b.rework_quantity)*100,2) end as quality_percent,
    (b.operation_revenue-b.production_cost)::numeric as production_margin
  from base b
)
select
  m.*,
  array_remove(array[
    case when m.next_service_date is not null and m.next_service_date<current_date then 'SERVICE_OVERDUE' end,
    case when m.next_service_date is not null and m.next_service_date>=current_date and m.next_service_date<=current_date+m.service_due_days then 'SERVICE_DUE' end,
    case when m.utilization_percent is not null and m.utilization_percent>=m.utilization_warn_percent then 'HIGH_UTILIZATION' end,
    case when m.quality_percent is not null and m.quality_percent<m.quality_warn_percent then 'LOW_QUALITY' end,
    case when m.downtime_percent is not null and m.downtime_percent>=m.downtime_warn_percent then 'HIGH_DOWNTIME' end,
    case when (m.operation_revenue<>0 or m.production_cost<>0) and m.production_margin<m.margin_warn_amount then 'LOW_MARGIN' end,
    case when m.status='REPAIR' or m.operational_status in ('FAULT','MAINTENANCE','OUT_OF_SERVICE') then 'EQUIPMENT_UNAVAILABLE' end
  ]::text[],null) as alerts,
  cardinality(array_remove(array[
    case when m.next_service_date is not null and m.next_service_date<current_date then 'SERVICE_OVERDUE' end,
    case when m.next_service_date is not null and m.next_service_date>=current_date and m.next_service_date<=current_date+m.service_due_days then 'SERVICE_DUE' end,
    case when m.utilization_percent is not null and m.utilization_percent>=m.utilization_warn_percent then 'HIGH_UTILIZATION' end,
    case when m.quality_percent is not null and m.quality_percent<m.quality_warn_percent then 'LOW_QUALITY' end,
    case when m.downtime_percent is not null and m.downtime_percent>=m.downtime_warn_percent then 'HIGH_DOWNTIME' end,
    case when (m.operation_revenue<>0 or m.production_cost<>0) and m.production_margin<m.margin_warn_amount then 'LOW_MARGIN' end,
    case when m.status='REPAIR' or m.operational_status in ('FAULT','MAINTENANCE','OUT_OF_SERVICE') then 'EQUIPMENT_UNAVAILABLE' end
  ]::text[],null)) as alert_count
from metrics m;

comment on view public.production_equipment_monitor is
  'Configurable equipment production-health monitor over OEE, capacity, service deadlines and margin. Alerts are advisory read-only signals.';

revoke all on public.production_equipment_monitor from public,anon;
grant select on public.production_equipment_monitor to authenticated,service_role;
