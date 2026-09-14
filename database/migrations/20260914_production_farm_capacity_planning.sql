-- A4PRINT HUB: production farm phase 7.
-- Real equipment capacity calendar, planning horizon and collision-safe scheduling.

create table if not exists public.equipment_capacity_rules (
  equipment_id uuid not null references public.equipment_assets(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),
  available_minutes integer not null default 0 check (available_minutes between 0 and 1440),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (equipment_id, weekday)
);

alter table public.equipment_capacity_rules enable row level security;
drop policy if exists equipment_capacity_rules_staff_read on public.equipment_capacity_rules;
create policy equipment_capacity_rules_staff_read on public.equipment_capacity_rules
for select to authenticated
using (public.has_permission('production.view') or public.has_permission('production.analytics.view'));

revoke all on public.equipment_capacity_rules from public, anon, authenticated;
grant select on public.equipment_capacity_rules to authenticated;

-- Preserve the previous 8h x weekday assumption as an explicit editable default.
insert into public.equipment_capacity_rules(equipment_id, weekday, available_minutes, is_active)
select e.id, d.weekday, case when d.weekday between 1 and 5 then 480 else 0 end, true
from public.equipment_assets e
cross join generate_series(1,7) as d(weekday)
on conflict (equipment_id, weekday) do nothing;

create or replace function public.seed_equipment_capacity_rules()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.equipment_capacity_rules(equipment_id, weekday, available_minutes, is_active)
  select new.id, d.weekday, case when d.weekday between 1 and 5 then 480 else 0 end, true
  from generate_series(1,7) as d(weekday)
  on conflict (equipment_id, weekday) do nothing;
  return new;
end
$$;

revoke all on function public.seed_equipment_capacity_rules() from public, anon, authenticated;
drop trigger if exists trg_seed_equipment_capacity_rules on public.equipment_assets;
create trigger trg_seed_equipment_capacity_rules
after insert on public.equipment_assets
for each row execute function public.seed_equipment_capacity_rules();

drop trigger if exists trg_touch_equipment_capacity_rules on public.equipment_capacity_rules;
create trigger trg_touch_equipment_capacity_rules
before update on public.equipment_capacity_rules
for each row execute function public.touch_production_farm_updated_at();

drop trigger if exists trg_audit_equipment_capacity_rules on public.equipment_capacity_rules;
create trigger trg_audit_equipment_capacity_rules
after insert or update or delete on public.equipment_capacity_rules
for each row execute function public.audit_row_change();

create or replace function public.save_equipment_capacity(
  p_equipment_id uuid,
  p_rules jsonb
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_count integer;
begin
  if not public.has_permission('production.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_equipment_id is null or not exists(select 1 from public.equipment_assets where id=p_equipment_id) then
    raise exception 'EQUIPMENT_NOT_FOUND';
  end if;
  if p_rules is null or jsonb_typeof(p_rules)<>'array' or jsonb_array_length(p_rules)<>7 then
    raise exception 'CAPACITY_REQUIRES_SEVEN_WEEKDAYS';
  end if;

  select count(distinct x.weekday)
    into v_count
  from jsonb_to_recordset(p_rules) as x(weekday integer, available_minutes integer, is_active boolean)
  where x.weekday between 1 and 7
    and x.available_minutes between 0 and 1440;
  if v_count<>7 then raise exception 'INVALID_CAPACITY_RULES'; end if;

  insert into public.equipment_capacity_rules(equipment_id, weekday, available_minutes, is_active)
  select p_equipment_id,
         x.weekday,
         x.available_minutes,
         coalesce(x.is_active,true)
  from jsonb_to_recordset(p_rules) as x(weekday integer, available_minutes integer, is_active boolean)
  on conflict (equipment_id, weekday) do update
    set available_minutes=excluded.available_minutes,
        is_active=excluded.is_active,
        updated_at=now();

  return p_equipment_id;
end
$$;

revoke all on function public.save_equipment_capacity(uuid,jsonb) from public,anon;
grant execute on function public.save_equipment_capacity(uuid,jsonb) to authenticated;

create or replace function public.validate_production_job_schedule()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.planned_start is not null and new.planned_end is not null and new.planned_end<=new.planned_start then
    raise exception 'INVALID_PRODUCTION_PLAN_RANGE';
  end if;

  if new.equipment_id is null
     or new.planned_start is null
     or new.planned_end is null
     or new.status in ('DONE','CANCELLED') then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtextextended(new.equipment_id::text,0));

  if exists(
    select 1
      from public.production_jobs j
     where j.equipment_id=new.equipment_id
       and j.id<>new.id
       and j.status in ('NEW','QUEUED','IN_PROGRESS','PAUSED')
       and j.planned_start is not null
       and j.planned_end is not null
       and tstzrange(j.planned_start,j.planned_end,'[)') && tstzrange(new.planned_start,new.planned_end,'[)')
  ) then
    raise exception 'EQUIPMENT_PLAN_OVERLAP';
  end if;

  return new;
end
$$;

revoke all on function public.validate_production_job_schedule() from public,anon,authenticated;
drop trigger if exists trg_validate_production_job_schedule on public.production_jobs;
create trigger trg_validate_production_job_schedule
before insert or update of equipment_id,planned_start,planned_end,status on public.production_jobs
for each row execute function public.validate_production_job_schedule();

create index if not exists production_jobs_equipment_plan_idx
on public.production_jobs(equipment_id,planned_start,planned_end)
where equipment_id is not null
  and planned_start is not null
  and planned_end is not null
  and status in ('NEW','QUEUED','IN_PROGRESS','PAUSED');

create or replace function public.schedule_production_job(
  p_job_id uuid,
  p_equipment_id uuid,
  p_planned_start timestamptz,
  p_planned_end timestamptz
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_job public.production_jobs%rowtype;
  v_machine public.equipment_assets%rowtype;
  v_minutes numeric;
begin
  if not public.has_permission('production.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_equipment_id is null then raise exception 'EQUIPMENT_REQUIRED'; end if;
  if p_planned_start is null or p_planned_end is null or p_planned_end<=p_planned_start then
    raise exception 'INVALID_PRODUCTION_PLAN_RANGE';
  end if;

  select * into v_job from public.production_jobs where id=p_job_id for update;
  if v_job.id is null then raise exception 'PRODUCTION_JOB_NOT_FOUND'; end if;
  if v_job.status not in ('NEW','QUEUED','PAUSED') then raise exception 'JOB_CANNOT_BE_SCHEDULED'; end if;

  select * into v_machine from public.equipment_assets where id=p_equipment_id for update;
  if v_machine.id is null then raise exception 'EQUIPMENT_NOT_FOUND'; end if;
  if v_machine.status='WRITTEN_OFF' or v_machine.operational_status in ('MAINTENANCE','REPAIR','FAULT','WAITING_PARTS','OFFLINE','RETIRED') then
    raise exception 'EQUIPMENT_UNAVAILABLE: %',coalesce(v_machine.operational_status,v_machine.status);
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_equipment_id::text,0));
  if exists(
    select 1 from public.production_jobs j
     where j.equipment_id=p_equipment_id
       and j.id<>p_job_id
       and j.status in ('NEW','QUEUED','IN_PROGRESS','PAUSED')
       and j.planned_start is not null
       and j.planned_end is not null
       and tstzrange(j.planned_start,j.planned_end,'[)') && tstzrange(p_planned_start,p_planned_end,'[)')
  ) then
    raise exception 'EQUIPMENT_PLAN_OVERLAP';
  end if;

  v_minutes=round((extract(epoch from (p_planned_end-p_planned_start))/60)::numeric,2);
  update public.production_jobs
     set equipment_id=p_equipment_id,
         planned_start=p_planned_start,
         planned_end=p_planned_end,
         planned_machine_minutes=case when coalesce(planned_machine_minutes,0)>0 then planned_machine_minutes else v_minutes end,
         status=case when status='NEW'::public.production_status then 'QUEUED'::public.production_status else status end,
         updated_at=now()
   where id=p_job_id;

  return p_job_id;
end
$$;

revoke all on function public.schedule_production_job(uuid,uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.schedule_production_job(uuid,uuid,timestamptz,timestamptz) to authenticated;

create or replace function public.production_capacity_between(
  p_from date,
  p_to date
) returns table(
  equipment_id uuid,
  inventory_number text,
  equipment_name text,
  work_date date,
  available_minutes integer,
  planned_minutes numeric,
  load_percent numeric,
  planned_jobs integer,
  overloaded boolean
)
language plpgsql
security invoker
set search_path=public
as $$
begin
  if not (public.has_permission('production.view') or public.has_permission('production.analytics.view')) then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_from is null or p_to is null or p_to<p_from then raise exception 'INVALID_CAPACITY_RANGE'; end if;
  if p_to-p_from>400 then raise exception 'CAPACITY_RANGE_TOO_LARGE'; end if;

  return query
  with dates as (
    select gs::date as work_date
    from generate_series(p_from::timestamp,p_to::timestamp,interval '1 day') gs
  )
  select e.id,
         e.inventory_number,
         e.name,
         d.work_date,
         case when coalesce(r.is_active,true) then coalesce(r.available_minutes,0) else 0 end as available_minutes,
         coalesce(p.planned_minutes,0)::numeric as planned_minutes,
         case
           when (case when coalesce(r.is_active,true) then coalesce(r.available_minutes,0) else 0 end)>0
           then round((coalesce(p.planned_minutes,0) / (case when coalesce(r.is_active,true) then r.available_minutes else 0 end) * 100)::numeric,1)
           else case when coalesce(p.planned_minutes,0)>0 then 999::numeric else 0::numeric end
         end as load_percent,
         coalesce(p.planned_jobs,0)::integer as planned_jobs,
         (coalesce(p.planned_minutes,0) > (case when coalesce(r.is_active,true) then coalesce(r.available_minutes,0) else 0 end)) as overloaded
  from public.equipment_assets e
  cross join dates d
  left join public.equipment_capacity_rules r
    on r.equipment_id=e.id and r.weekday=extract(isodow from d.work_date)::integer
  left join lateral (
    select count(*)::integer as planned_jobs,
           round(coalesce(sum(
             extract(epoch from (
               least(j.planned_end, ((d.work_date+1)::timestamp at time zone 'UTC'))
               - greatest(j.planned_start, (d.work_date::timestamp at time zone 'UTC'))
             ))/60
           ),0)::numeric,2) as planned_minutes
      from public.production_jobs j
     where j.equipment_id=e.id
       and j.status in ('NEW','QUEUED','IN_PROGRESS','PAUSED')
       and j.planned_start is not null
       and j.planned_end is not null
       and j.planned_start < ((d.work_date+1)::timestamp at time zone 'UTC')
       and j.planned_end > (d.work_date::timestamp at time zone 'UTC')
  ) p on true
  where e.status<>'WRITTEN_OFF'
  order by d.work_date,e.inventory_number,e.name;
end
$$;

revoke all on function public.production_capacity_between(date,date) from public,anon;
grant execute on function public.production_capacity_between(date,date) to authenticated;
