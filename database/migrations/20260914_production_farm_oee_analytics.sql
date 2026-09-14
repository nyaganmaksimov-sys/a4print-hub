-- Production Farm phase 10: OEE / efficiency analytics.
-- The read models below are SECURITY INVOKER so source-table RLS stays authoritative.
-- No second runtime or quality ledger is introduced: production_job_runs and
-- production_job_events remain the canonical facts created by phase 9.

create or replace view public.production_oee_daily
with (security_invoker=true)
as
with run_segments as (
  select
    r.equipment_id,
    day_start::date as metric_date,
    greatest(
      0,
      extract(epoch from (
        least(coalesce(r.ended_at,clock_timestamp()),day_start+interval '1 day')
        - greatest(r.started_at,day_start)
      ))/60
    )::numeric as runtime_minutes
  from public.production_job_runs r
  cross join lateral generate_series(
    date_trunc('day',r.started_at),
    date_trunc('day',coalesce(r.ended_at,clock_timestamp())),
    interval '1 day'
  ) day_start
  where r.equipment_id is not null
    and coalesce(r.ended_at,clock_timestamp())>r.started_at
),
run_daily as (
  select equipment_id,metric_date,coalesce(sum(runtime_minutes),0)::numeric as runtime_minutes
  from run_segments
  group by equipment_id,metric_date
),
pause_daily as (
  select
    e.equipment_id,
    e.created_at::date as metric_date,
    count(*)::bigint as pause_events,
    coalesce(sum(e.duration_seconds),0)::numeric/60 as downtime_minutes
  from public.production_job_events e
  where e.event_type='PAUSE'
    and e.equipment_id is not null
    and e.duration_seconds is not null
  group by e.equipment_id,e.created_at::date
),
quality_daily as (
  select
    e.equipment_id,
    e.created_at::date as metric_date,
    coalesce(sum(e.good_quantity),0)::numeric as good_quantity,
    coalesce(sum(e.scrap_quantity),0)::numeric as scrap_quantity,
    coalesce(sum(e.rework_quantity),0)::numeric as rework_quantity
  from public.production_job_events e
  where e.equipment_id is not null
    and e.event_type in ('OUTPUT','SCRAP','REWORK')
  group by e.equipment_id,e.created_at::date
),
job_daily as (
  select
    j.equipment_id,
    j.completed_at::date as metric_date,
    count(*)::bigint as completed_jobs,
    coalesce(sum(j.planned_machine_minutes),0)::numeric as planned_machine_minutes,
    coalesce(sum(j.actual_machine_minutes),0)::numeric as actual_machine_minutes,
    coalesce(sum(j.operation_amount),0)::numeric as operation_revenue,
    coalesce(sum(j.production_cost),0)::numeric as production_cost
  from public.production_jobs j
  where j.status='DONE'
    and j.equipment_id is not null
    and j.completed_at is not null
  group by j.equipment_id,j.completed_at::date
),
keys as (
  select equipment_id,metric_date from run_daily
  union
  select equipment_id,metric_date from pause_daily
  union
  select equipment_id,metric_date from quality_daily
  union
  select equipment_id,metric_date from job_daily
),
base as (
  select
    k.metric_date,
    a.id as equipment_id,
    a.inventory_number,
    a.name as equipment_name,
    coalesce(r.runtime_minutes,0)::numeric as runtime_minutes,
    coalesce(p.downtime_minutes,0)::numeric as downtime_minutes,
    coalesce(p.pause_events,0)::bigint as pause_events,
    coalesce(q.good_quantity,0)::numeric as good_quantity,
    coalesce(q.scrap_quantity,0)::numeric as scrap_quantity,
    coalesce(q.rework_quantity,0)::numeric as rework_quantity,
    coalesce(j.completed_jobs,0)::bigint as completed_jobs,
    coalesce(j.planned_machine_minutes,0)::numeric as planned_machine_minutes,
    coalesce(j.actual_machine_minutes,0)::numeric as actual_machine_minutes,
    coalesce(j.operation_revenue,0)::numeric as operation_revenue,
    coalesce(j.production_cost,0)::numeric as production_cost
  from keys k
  join public.equipment_assets a on a.id=k.equipment_id
  left join run_daily r on r.equipment_id=k.equipment_id and r.metric_date=k.metric_date
  left join pause_daily p on p.equipment_id=k.equipment_id and p.metric_date=k.metric_date
  left join quality_daily q on q.equipment_id=k.equipment_id and q.metric_date=k.metric_date
  left join job_daily j on j.equipment_id=k.equipment_id and j.metric_date=k.metric_date
)
select
  b.*,
  case when (b.runtime_minutes+b.downtime_minutes)>0
       then round((b.runtime_minutes/(b.runtime_minutes+b.downtime_minutes))*100,2)
       else null end as availability_percent,
  case when b.actual_machine_minutes>0 and b.planned_machine_minutes>0
       then round(least(1,b.planned_machine_minutes/b.actual_machine_minutes)*100,2)
       else null end as performance_percent,
  case when (b.good_quantity+b.scrap_quantity+b.rework_quantity)>0
       then round((b.good_quantity/(b.good_quantity+b.scrap_quantity+b.rework_quantity))*100,2)
       else null end as quality_percent,
  case when (b.runtime_minutes+b.downtime_minutes)>0
          and b.actual_machine_minutes>0 and b.planned_machine_minutes>0
          and (b.good_quantity+b.scrap_quantity+b.rework_quantity)>0
       then round(
         (b.runtime_minutes/(b.runtime_minutes+b.downtime_minutes))
         * least(1,b.planned_machine_minutes/b.actual_machine_minutes)
         * (b.good_quantity/(b.good_quantity+b.scrap_quantity+b.rework_quantity))
         * 100,
         2
       )
       else null end as oee_percent,
  (b.operation_revenue-b.production_cost)::numeric as production_margin
from base b;

comment on view public.production_oee_daily is
  'Daily production efficiency facts and management OEE components. Availability uses runtime vs recorded pause time; performance is plan-vs-fact proxy capped at 100%; quality treats scrap and rework as first-pass loss.';

revoke all on public.production_oee_daily from public,anon;
grant select on public.production_oee_daily to authenticated,service_role;

create or replace view public.production_downtime_pareto_daily
with (security_invoker=true)
as
select
  e.created_at::date as metric_date,
  e.equipment_id,
  a.inventory_number,
  a.name as equipment_name,
  coalesce(nullif(e.reason_code,''),'OTHER') as reason_code,
  count(*)::bigint as pause_events,
  round(coalesce(sum(e.duration_seconds),0)::numeric/60,2) as downtime_minutes
from public.production_job_events e
left join public.equipment_assets a on a.id=e.equipment_id
where e.event_type='PAUSE'
  and e.equipment_id is not null
  and e.duration_seconds is not null
group by e.created_at::date,e.equipment_id,a.inventory_number,a.name,coalesce(nullif(e.reason_code,''),'OTHER');

comment on view public.production_downtime_pareto_daily is
  'Daily downtime Pareto facts by equipment and pause reason, sourced from closed PAUSE events.';

revoke all on public.production_downtime_pareto_daily from public,anon;
grant select on public.production_downtime_pareto_daily to authenticated,service_role;
