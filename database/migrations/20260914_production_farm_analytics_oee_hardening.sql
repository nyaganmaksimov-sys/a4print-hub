-- Phase 10 hardening: PostgreSQL LEAST/GREATEST ignore NULL arguments.
-- With a LEFT JOIN and no matching job that made an empty machine look planned for
-- the entire requested range. Count planned overlap only when a real job row exists.

create or replace function public.production_equipment_analytics(
  p_from date,
  p_to date
) returns table(
  equipment_id uuid,
  inventory_number text,
  equipment_name text,
  operational_status text,
  available_minutes numeric,
  planned_minutes numeric,
  run_minutes numeric,
  downtime_minutes numeric,
  idle_minutes numeric,
  overtime_minutes numeric,
  planned_load_percent numeric,
  capacity_utilization_percent numeric,
  runtime_availability_percent numeric,
  good_quantity numeric,
  scrap_quantity numeric,
  rework_quantity numeric,
  quality_percent numeric,
  standard_run_minutes numeric,
  standard_coverage_percent numeric,
  performance_percent numeric,
  oee_percent numeric,
  completed_jobs integer,
  late_jobs integer,
  production_cost numeric
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_tz text;
  v_range_start timestamptz;
  v_range_end timestamptz;
begin
  if not (
    public.has_permission('production.view')
    or public.has_permission('production.analytics.view')
    or public.has_permission('production.manage')
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if p_from is null or p_to is null or p_to<p_from then raise exception 'INVALID_ANALYTICS_RANGE'; end if;
  if p_to-p_from>400 then raise exception 'ANALYTICS_RANGE_TOO_LARGE'; end if;

  select coalesce(timezone,'Asia/Yekaterinburg') into v_tz
  from public.production_dispatch_settings where id=1;
  v_tz:=coalesce(v_tz,'Asia/Yekaterinburg');
  v_range_start:=p_from::timestamp at time zone v_tz;
  v_range_end:=(p_to+1)::timestamp at time zone v_tz;

  return query
  with dates as (
    select gs::date as work_date
    from generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') gs
  ), capacity as (
    select e.id as equipment_id,
           coalesce(sum(case when coalesce(r.is_active,true) then coalesce(r.available_minutes,0) else 0 end),0)::numeric as available_minutes
    from public.equipment_assets e
    cross join dates d
    left join public.equipment_capacity_rules r
      on r.equipment_id=e.id and r.weekday=extract(isodow from d.work_date)::integer
    where e.status<>'WRITTEN_OFF'
    group by e.id
  ), planned as (
    select e.id as equipment_id,
           round(coalesce(sum(
             extract(epoch from (least(j.planned_end,v_range_end)-greatest(j.planned_start,v_range_start)))/60
           ) filter(where j.id is not null),0)::numeric,2) as planned_minutes
    from public.equipment_assets e
    left join public.production_jobs j
      on j.equipment_id=e.id
     and j.status<>'CANCELLED'::public.production_status
     and j.planned_start is not null
     and j.planned_end is not null
     and j.planned_start<v_range_end
     and j.planned_end>v_range_start
    where e.status<>'WRITTEN_OFF'
    group by e.id
  ), runs as (
    select e.id as equipment_id,
           round(coalesce(sum(
             extract(epoch from (least(coalesce(r.ended_at,clock_timestamp()),v_range_end)-greatest(r.started_at,v_range_start)))
           ) filter(
             where r.started_at<v_range_end
               and coalesce(r.ended_at,clock_timestamp())>v_range_start
           ),0)::numeric/60,2) as run_minutes,
           round(coalesce(sum(
             extract(epoch from (least(coalesce(r.ended_at,clock_timestamp()),v_range_end)-greatest(r.started_at,v_range_start)))
           ) filter(
             where r.started_at<v_range_end
               and coalesce(r.ended_at,clock_timestamp())>v_range_start
               and s.equipment_id is not null
           ),0)::numeric/60,2) as standard_run_minutes
    from public.equipment_assets e
    left join public.production_job_runs r on r.equipment_id=e.id
    left join public.production_jobs j on j.id=r.production_job_id
    left join public.production_equipment_standards s
      on s.equipment_id=r.equipment_id
     and s.operation_type=upper(btrim(coalesce(j.operation_type,'')))
     and s.is_active
    where e.status<>'WRITTEN_OFF'
    group by e.id
  ), pauses as (
    select e.id as equipment_id,
           round(coalesce(sum(
             extract(epoch from (
               least(
                 case when pe.duration_seconds is null then clock_timestamp()
                      else pe.created_at+make_interval(secs=>pe.duration_seconds::double precision) end,
                 v_range_end
               )-greatest(pe.created_at,v_range_start)
             ))
           ) filter(
             where pe.event_type='PAUSE'
               and pe.created_at<v_range_end
               and (case when pe.duration_seconds is null then clock_timestamp()
                         else pe.created_at+make_interval(secs=>pe.duration_seconds::double precision) end)>v_range_start
           ),0)::numeric/60,2) as downtime_minutes
    from public.equipment_assets e
    left join public.production_job_events pe on pe.equipment_id=e.id
    where e.status<>'WRITTEN_OFF'
    group by e.id
  ), quality as (
    select e.id as equipment_id,
           coalesce(sum(pe.good_quantity) filter(where pe.created_at>=v_range_start and pe.created_at<v_range_end),0)::numeric as good_quantity,
           coalesce(sum(pe.scrap_quantity) filter(where pe.created_at>=v_range_start and pe.created_at<v_range_end),0)::numeric as scrap_quantity,
           coalesce(sum(pe.rework_quantity) filter(where pe.created_at>=v_range_start and pe.created_at<v_range_end),0)::numeric as rework_quantity,
           coalesce(sum(
             (coalesce(pe.good_quantity,0)+coalesce(pe.scrap_quantity,0))*s.ideal_cycle_seconds_per_unit
           ) filter(
             where pe.created_at>=v_range_start
               and pe.created_at<v_range_end
               and s.equipment_id is not null
           ),0)::numeric as ideal_seconds
    from public.equipment_assets e
    left join public.production_job_events pe on pe.equipment_id=e.id
    left join public.production_jobs j on j.id=pe.production_job_id
    left join public.production_equipment_standards s
      on s.equipment_id=e.id
     and s.operation_type=upper(btrim(coalesce(j.operation_type,'')))
     and s.is_active
    where e.status<>'WRITTEN_OFF'
    group by e.id
  ), jobs as (
    select e.id as equipment_id,
           count(j.id) filter(where j.completed_at>=v_range_start and j.completed_at<v_range_end)::integer as completed_jobs,
           count(j.id) filter(
             where j.completed_at>=v_range_start
               and j.completed_at<v_range_end
               and j.deadline_at is not null
               and j.completed_at>j.deadline_at
           )::integer as late_jobs,
           coalesce(sum(j.production_cost) filter(where j.completed_at>=v_range_start and j.completed_at<v_range_end),0)::numeric as production_cost
    from public.equipment_assets e
    left join public.production_jobs j on j.equipment_id=e.id
    where e.status<>'WRITTEN_OFF'
    group by e.id
  ), metrics as (
    select e.id,e.inventory_number,e.name,e.operational_status,
           coalesce(c.available_minutes,0)::numeric as available_minutes,
           coalesce(pn.planned_minutes,0)::numeric as planned_minutes,
           coalesce(rn.run_minutes,0)::numeric as run_minutes,
           coalesce(ps.downtime_minutes,0)::numeric as downtime_minutes,
           greatest(coalesce(c.available_minutes,0)-coalesce(rn.run_minutes,0),0)::numeric as idle_minutes,
           greatest(coalesce(rn.run_minutes,0)-coalesce(c.available_minutes,0),0)::numeric as overtime_minutes,
           q.good_quantity,q.scrap_quantity,q.rework_quantity,q.ideal_seconds,
           coalesce(rn.standard_run_minutes,0)::numeric as standard_run_minutes,
           j.completed_jobs,j.late_jobs,j.production_cost
    from public.equipment_assets e
    left join capacity c on c.equipment_id=e.id
    left join planned pn on pn.equipment_id=e.id
    left join runs rn on rn.equipment_id=e.id
    left join pauses ps on ps.equipment_id=e.id
    left join quality q on q.equipment_id=e.id
    left join jobs j on j.equipment_id=e.id
    where e.status<>'WRITTEN_OFF'
  )
  select m.id,
         m.inventory_number,
         m.name,
         m.operational_status,
         round(m.available_minutes,2),
         round(m.planned_minutes,2),
         round(m.run_minutes,2),
         round(m.downtime_minutes,2),
         round(m.idle_minutes,2),
         round(m.overtime_minutes,2),
         case when m.available_minutes>0 then round(m.planned_minutes/m.available_minutes*100,1) else null end,
         case when m.available_minutes>0 then round(m.run_minutes/m.available_minutes*100,1) else null end,
         case when m.run_minutes+m.downtime_minutes>0 then round(m.run_minutes/(m.run_minutes+m.downtime_minutes)*100,1) else null end,
         m.good_quantity,
         m.scrap_quantity,
         m.rework_quantity,
         case when m.good_quantity+m.scrap_quantity>0 then round(m.good_quantity/(m.good_quantity+m.scrap_quantity)*100,1) else null end,
         round(m.standard_run_minutes,2),
         case when m.run_minutes>0 then round(m.standard_run_minutes/m.run_minutes*100,1) else null end,
         case when m.standard_run_minutes>0 and m.ideal_seconds>0 then round((m.ideal_seconds/(m.standard_run_minutes*60))*100,1) else null end,
         case
           when m.available_minutes>0
            and m.run_minutes>0
            and m.standard_run_minutes/nullif(m.run_minutes,0)>=0.99
            and m.standard_run_minutes>0
            and m.ideal_seconds>0
            and m.good_quantity+m.scrap_quantity>0
           then round(
             least(1,m.run_minutes/m.available_minutes)
             * least(1,m.ideal_seconds/(m.standard_run_minutes*60))
             * (m.good_quantity/(m.good_quantity+m.scrap_quantity))
             * 100,1
           )
           else null
         end,
         coalesce(m.completed_jobs,0),
         coalesce(m.late_jobs,0),
         round(coalesce(m.production_cost,0),2)
    from metrics m
    order by m.inventory_number,m.name;
end
$$;
