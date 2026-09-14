-- Phase 11 hardening: the monitoring read model must be composable from SQL/service tooling.
-- Do not call permission-checked production_capacity_between() from inside a SECURITY INVOKER view.
-- Capacity remains sourced from the canonical equipment_capacity_rules calendar.

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
dates as (
  select gs::date as work_date
  from settings s
  cross join lateral generate_series(
    (current_date-(s.lookback_days-1))::timestamp,
    current_date::timestamp,
    interval '1 day'
  ) gs
),
capacity as (
  select
    a.id as equipment_id,
    coalesce(sum(
      case when coalesce(r.is_active,true)
           then coalesce(r.available_minutes,0)
           else 0 end
    ),0)::numeric as available_minutes
  from public.equipment_assets a
  cross join dates d
  left join public.equipment_capacity_rules r
    on r.equipment_id=a.id
   and r.weekday=extract(isodow from d.work_date)::integer
  where a.status<>'WRITTEN_OFF'
  group by a.id
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
),
alerts as (
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
    ]::text[],null) as alerts
  from metrics m
)
select a.*,cardinality(a.alerts) as alert_count
from alerts a;

comment on view public.production_equipment_monitor is
  'Configurable equipment production-health monitor over OEE, canonical capacity rules, service deadlines and margin. Advisory read-only signals; no permission-checked RPC dependency.';

revoke all on public.production_equipment_monitor from public,anon;
grant select on public.production_equipment_monitor to authenticated,service_role;
