-- Production Farm phase 10: equipment analytics, downtime Pareto and honest OEE.
-- OEE is returned only when speed standards cover practically all run time and
-- quality output exists. Until then the UI shows the individual factual metrics.

create table if not exists public.production_equipment_standards (
  equipment_id uuid not null references public.equipment_assets(id) on delete cascade,
  operation_type text not null check(length(btrim(operation_type)) between 1 and 120),
  ideal_cycle_seconds_per_unit numeric(14,4) not null check(ideal_cycle_seconds_per_unit>0),
  target_scrap_percent numeric(6,3) not null default 0 check(target_scrap_percent between 0 and 100),
  notes text,
  is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null,
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(equipment_id,operation_type)
);

create index if not exists production_equipment_standards_operation_idx
  on public.production_equipment_standards(operation_type,equipment_id)
  where is_active;

alter table public.production_equipment_standards enable row level security;
drop policy if exists production_equipment_standards_read on public.production_equipment_standards;
create policy production_equipment_standards_read
on public.production_equipment_standards for select to authenticated
using(
  public.has_permission('production.view')
  or public.has_permission('production.analytics.view')
  or public.has_permission('production.manage')
);

revoke all on public.production_equipment_standards from public,anon,authenticated;
grant select on public.production_equipment_standards to authenticated;

drop trigger if exists trg_touch_production_equipment_standards on public.production_equipment_standards;
create trigger trg_touch_production_equipment_standards
before update on public.production_equipment_standards
for each row execute function public.touch_production_farm_updated_at();

drop trigger if exists trg_audit_production_equipment_standards on public.production_equipment_standards;
create trigger trg_audit_production_equipment_standards
after insert or update or delete on public.production_equipment_standards
for each row execute function public.audit_row_change();

create or replace function public.save_production_equipment_standard(
  p_equipment_id uuid,
  p_operation_type text,
  p_ideal_cycle_seconds_per_unit numeric,
  p_target_scrap_percent numeric default 0,
  p_notes text default null,
  p_is_active boolean default true
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_operation text:=upper(btrim(coalesce(p_operation_type,'')));
  v_actor uuid:=public.current_hub_user_id();
begin
  if not public.has_permission('production.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_equipment_id is null or not exists(select 1 from public.equipment_assets where id=p_equipment_id) then
    raise exception 'EQUIPMENT_NOT_FOUND';
  end if;
  if length(v_operation) not between 1 and 120 then raise exception 'OPERATION_TYPE_REQUIRED'; end if;
  if coalesce(p_ideal_cycle_seconds_per_unit,0)<=0 then raise exception 'INVALID_IDEAL_CYCLE'; end if;
  if coalesce(p_target_scrap_percent,0) not between 0 and 100 then raise exception 'INVALID_TARGET_SCRAP'; end if;

  insert into public.production_equipment_standards(
    equipment_id,operation_type,ideal_cycle_seconds_per_unit,target_scrap_percent,
    notes,is_active,created_by,updated_by,updated_at
  ) values(
    p_equipment_id,v_operation,p_ideal_cycle_seconds_per_unit,coalesce(p_target_scrap_percent,0),
    nullif(btrim(coalesce(p_notes,'')),''),coalesce(p_is_active,true),v_actor,v_actor,clock_timestamp()
  )
  on conflict(equipment_id,operation_type) do update
    set ideal_cycle_seconds_per_unit=excluded.ideal_cycle_seconds_per_unit,
        target_scrap_percent=excluded.target_scrap_percent,
        notes=excluded.notes,
        is_active=excluded.is_active,
        updated_by=excluded.updated_by,
        updated_at=clock_timestamp();

  return p_equipment_id;
end
$$;

revoke all on function public.save_production_equipment_standard(uuid,text,numeric,numeric,text,boolean) from public,anon;
grant execute on function public.save_production_equipment_standard(uuid,text,numeric,numeric,text,boolean) to authenticated;

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
             extract(epoch from (
               least(j.planned_end,v_range_end)-greatest(j.planned_start,v_range_start)
             ))/60
           ),0)::numeric,2) as planned_minutes
    from public.equipment_assets e
    left join public.production_jobs j
      on j.equipment_id=e.id
     and j.status<>'CANCELLED'::public.production_status
     and j.planned_start is not null and j.planned_end is not null
     and j.planned_start<v_range_end and j.planned_end>v_range_start
    where e.status<>'WRITTEN_OFF'
    group by e.id
  ), runs as (
    select e.id as equipment_id,
           round(coalesce(sum(
             extract(epoch from (
               least(coalesce(r.ended_at,clock_timestamp()),v_range_end)-greatest(r.started_at,v_range_start)
             ))
           ) filter(where r.started_at<v_range_end and coalesce(r.ended_at,clock_timestamp())>v_range_start),0)::numeric/60,2) as run_minutes,
           round(coalesce(sum(
             extract(epoch from (
               least(coalesce(r.ended_at,clock_timestamp()),v_range_end)-greatest(r.started_at,v_range_start)
             ))
           ) filter(
             where r.started_at<v_range_end
               and coalesce(r.ended_at,clock_timestamp())>v_range_start
               and s.equipment_id is not null
           ),0)::numeric/60,2) as standard_run_minutes
    from public.equipment_assets e
    left join public.production_job_runs r on r.equipment_id=e.id
    left join public.production_jobs j on j.id=r.production_job_id
    left join public.production_equipment_standards s
      on s.equipment_id=r.equipment_id and s.operation_type=upper(btrim(coalesce(j.operation_type,''))) and s.is_active
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
               ) - greatest(pe.created_at,v_range_start)
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
             where pe.created_at>=v_range_start and pe.created_at<v_range_end
               and s.equipment_id is not null
           ),0)::numeric as ideal_seconds
    from public.equipment_assets e
    left join public.production_job_events pe on pe.equipment_id=e.id
    left join public.production_jobs j on j.id=pe.production_job_id
    left join public.production_equipment_standards s
      on s.equipment_id=e.id and s.operation_type=upper(btrim(coalesce(j.operation_type,''))) and s.is_active
    where e.status<>'WRITTEN_OFF'
    group by e.id
  ), jobs as (
    select e.id as equipment_id,
           count(j.id) filter(where j.completed_at>=v_range_start and j.completed_at<v_range_end)::integer as completed_jobs,
           count(j.id) filter(
             where j.completed_at>=v_range_start and j.completed_at<v_range_end
               and j.deadline_at is not null and j.completed_at>j.deadline_at
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
            and m.standard_run_minutes/m.run_minutes>=0.99
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

revoke all on function public.production_equipment_analytics(date,date) from public,anon;
grant execute on function public.production_equipment_analytics(date,date) to authenticated;

create or replace function public.production_downtime_pareto(
  p_from date,
  p_to date
) returns table(
  reason_code text,
  event_count integer,
  downtime_minutes numeric,
  share_percent numeric
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
  with rows as (
    select coalesce(nullif(pe.reason_code,''),'OTHER') as reason_code,
           count(*)::integer as event_count,
           sum(extract(epoch from (
             least(
               case when pe.duration_seconds is null then clock_timestamp()
                    else pe.created_at+make_interval(secs=>pe.duration_seconds::double precision) end,
               v_range_end
             )-greatest(pe.created_at,v_range_start)
           ))/60::numeric as downtime_minutes
    from public.production_job_events pe
    where pe.event_type='PAUSE'
      and pe.created_at<v_range_end
      and (case when pe.duration_seconds is null then clock_timestamp()
                else pe.created_at+make_interval(secs=>pe.duration_seconds::double precision) end)>v_range_start
    group by coalesce(nullif(pe.reason_code,''),'OTHER')
  ), total as (
    select coalesce(sum(r.downtime_minutes),0)::numeric as minutes from rows r
  )
  select r.reason_code,r.event_count,round(r.downtime_minutes,2),
         case when t.minutes>0 then round(r.downtime_minutes/t.minutes*100,1) else 0 end
  from rows r cross join total t
  order by r.downtime_minutes desc,r.reason_code;
end
$$;

revoke all on function public.production_downtime_pareto(date,date) from public,anon;
grant execute on function public.production_downtime_pareto(date,date) to authenticated;

create or replace function public.production_analytics_summary(
  p_from date,
  p_to date
) returns jsonb
language plpgsql
security definer
set search_path=public
as $$
declare
  v_result jsonb;
begin
  if not (
    public.has_permission('production.view')
    or public.has_permission('production.analytics.view')
    or public.has_permission('production.manage')
  ) then raise exception 'PERMISSION_DENIED'; end if;

  with a as (
    select * from public.production_equipment_analytics(p_from,p_to)
  ), sums as (
    select
      coalesce(sum(available_minutes),0) as available_minutes,
      coalesce(sum(planned_minutes),0) as planned_minutes,
      coalesce(sum(run_minutes),0) as run_minutes,
      coalesce(sum(downtime_minutes),0) as downtime_minutes,
      coalesce(sum(good_quantity),0) as good_quantity,
      coalesce(sum(scrap_quantity),0) as scrap_quantity,
      coalesce(sum(rework_quantity),0) as rework_quantity,
      coalesce(sum(standard_run_minutes),0) as standard_run_minutes,
      coalesce(sum(completed_jobs),0) as completed_jobs,
      coalesce(sum(late_jobs),0) as late_jobs,
      coalesce(sum(production_cost),0) as production_cost
    from a
  )
  select jsonb_build_object(
    'available_minutes',round(s.available_minutes,2),
    'planned_minutes',round(s.planned_minutes,2),
    'run_minutes',round(s.run_minutes,2),
    'downtime_minutes',round(s.downtime_minutes,2),
    'planned_load_percent',case when s.available_minutes>0 then round(s.planned_minutes/s.available_minutes*100,1) else null end,
    'capacity_utilization_percent',case when s.available_minutes>0 then round(s.run_minutes/s.available_minutes*100,1) else null end,
    'runtime_availability_percent',case when s.run_minutes+s.downtime_minutes>0 then round(s.run_minutes/(s.run_minutes+s.downtime_minutes)*100,1) else null end,
    'good_quantity',s.good_quantity,
    'scrap_quantity',s.scrap_quantity,
    'rework_quantity',s.rework_quantity,
    'quality_percent',case when s.good_quantity+s.scrap_quantity>0 then round(s.good_quantity/(s.good_quantity+s.scrap_quantity)*100,1) else null end,
    'standard_coverage_percent',case when s.run_minutes>0 then round(s.standard_run_minutes/s.run_minutes*100,1) else null end,
    'completed_jobs',s.completed_jobs,
    'late_jobs',s.late_jobs,
    'production_cost',round(s.production_cost,2),
    'oee_percent',(
      select case
        when sum(run_minutes)>0
         and sum(standard_run_minutes)/sum(run_minutes)>=0.99
         and count(*) filter(where run_minutes>0 and oee_percent is null)=0
        then round(sum(coalesce(oee_percent,0)*available_minutes)/nullif(sum(available_minutes) filter(where oee_percent is not null),0),1)
        else null end
      from a
    )
  ) into v_result from sums s;

  return coalesce(v_result,'{}'::jsonb);
end
$$;

revoke all on function public.production_analytics_summary(date,date) from public,anon;
grant execute on function public.production_analytics_summary(date,date) to authenticated;
