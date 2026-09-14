-- A4PRINT HUB: production farm phase 8.
-- Automatic dispatcher, deadlines, drag/drop day scheduling and fault re-planning.

alter table public.production_jobs
  add column if not exists deadline_at timestamptz,
  add column if not exists dispatch_locked boolean not null default false,
  add column if not exists dispatch_source text,
  add column if not exists dispatch_note text,
  add column if not exists last_dispatched_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname='production_jobs_dispatch_source_check'
      and conrelid='public.production_jobs'::regclass
  ) then
    alter table public.production_jobs
      add constraint production_jobs_dispatch_source_check
      check (dispatch_source is null or dispatch_source in ('LEGACY','MANUAL','AUTO','FAULT_REPLAN'));
  end if;
end
$$;

-- Separate customer/order deadline from the physical machine reservation window.
update public.production_jobs j
   set deadline_at=coalesce(o.due_at,case when j.planned_start is null then j.planned_end end)
  from public.orders o
 where o.id=j.order_id
   and j.deadline_at is null;

update public.production_jobs
   set deadline_at=planned_end
 where deadline_at is null
   and planned_start is null
   and planned_end is not null;

-- Preserve existing complete schedules as manually pinned so phase 8 never moves them silently.
update public.production_jobs
   set dispatch_locked=true,
       dispatch_source=coalesce(dispatch_source,'LEGACY')
 where equipment_id is not null
   and planned_start is not null
   and planned_end is not null;

create index if not exists production_jobs_dispatch_queue_idx
on public.production_jobs(status,dispatch_locked,deadline_at,priority desc,created_at)
where status in ('NEW','QUEUED','PAUSED');

create table if not exists public.production_dispatch_settings (
  id smallint primary key default 1 check (id=1),
  timezone text not null default 'Asia/Yekaterinburg',
  workday_start time not null default '09:00',
  planning_horizon_days integer not null default 30 check (planning_horizon_days between 1 and 120),
  setup_gap_minutes integer not null default 10 check (setup_gap_minutes between 0 and 240),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

insert into public.production_dispatch_settings(id)
values(1)
on conflict (id) do nothing;

alter table public.production_dispatch_settings enable row level security;
drop policy if exists production_dispatch_settings_read on public.production_dispatch_settings;
create policy production_dispatch_settings_read on public.production_dispatch_settings
for select to authenticated
using (
  public.has_permission('production.view')
  or public.has_permission('production.analytics.view')
  or public.has_permission('production.manage')
);

revoke all on public.production_dispatch_settings from public,anon,authenticated;
grant select on public.production_dispatch_settings to authenticated;

create table if not exists public.production_equipment_capabilities (
  equipment_id uuid not null references public.equipment_assets(id) on delete cascade,
  operation_type text not null check (length(btrim(operation_type)) between 1 and 120),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (equipment_id,operation_type)
);

create index if not exists production_equipment_capabilities_operation_idx
on public.production_equipment_capabilities(operation_type,equipment_id)
where is_active;

alter table public.production_equipment_capabilities enable row level security;
drop policy if exists production_equipment_capabilities_read on public.production_equipment_capabilities;
create policy production_equipment_capabilities_read on public.production_equipment_capabilities
for select to authenticated
using (
  public.has_permission('production.view')
  or public.has_permission('production.analytics.view')
  or public.has_permission('production.manage')
);

revoke all on public.production_equipment_capabilities from public,anon,authenticated;
grant select on public.production_equipment_capabilities to authenticated;

drop trigger if exists trg_touch_production_equipment_capabilities on public.production_equipment_capabilities;
create trigger trg_touch_production_equipment_capabilities
before update on public.production_equipment_capabilities
for each row execute function public.touch_production_farm_updated_at();

drop trigger if exists trg_audit_production_equipment_capabilities on public.production_equipment_capabilities;
create trigger trg_audit_production_equipment_capabilities
after insert or update or delete on public.production_equipment_capabilities
for each row execute function public.audit_row_change();

create or replace function public.save_production_dispatch_settings(
  p_timezone text,
  p_workday_start time,
  p_planning_horizon_days integer,
  p_setup_gap_minutes integer
) returns smallint
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.has_permission('production.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_timezone is null or not exists(select 1 from pg_timezone_names where name=p_timezone) then
    raise exception 'INVALID_TIMEZONE';
  end if;
  if p_workday_start is null then raise exception 'WORKDAY_START_REQUIRED'; end if;
  if p_planning_horizon_days not between 1 and 120 then raise exception 'INVALID_PLANNING_HORIZON'; end if;
  if p_setup_gap_minutes not between 0 and 240 then raise exception 'INVALID_SETUP_GAP'; end if;

  insert into public.production_dispatch_settings(
    id,timezone,workday_start,planning_horizon_days,setup_gap_minutes,updated_at,updated_by
  ) values(
    1,p_timezone,p_workday_start,p_planning_horizon_days,p_setup_gap_minutes,now(),auth.uid()
  )
  on conflict (id) do update
    set timezone=excluded.timezone,
        workday_start=excluded.workday_start,
        planning_horizon_days=excluded.planning_horizon_days,
        setup_gap_minutes=excluded.setup_gap_minutes,
        updated_at=now(),
        updated_by=auth.uid();
  return 1;
end
$$;

revoke all on function public.save_production_dispatch_settings(text,time,integer,integer) from public,anon;
grant execute on function public.save_production_dispatch_settings(text,time,integer,integer) to authenticated;

create or replace function public.save_production_equipment_capabilities(
  p_equipment_id uuid,
  p_operation_types text[]
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.has_permission('production.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_equipment_id is null or not exists(select 1 from public.equipment_assets where id=p_equipment_id) then
    raise exception 'EQUIPMENT_NOT_FOUND';
  end if;

  delete from public.production_equipment_capabilities
   where equipment_id=p_equipment_id;

  insert into public.production_equipment_capabilities(equipment_id,operation_type,is_active)
  select p_equipment_id,btrim(x),true
    from unnest(coalesce(p_operation_types,array[]::text[])) x
   where length(btrim(x)) between 1 and 120
  on conflict (equipment_id,operation_type) do update
    set is_active=true,updated_at=now();

  return p_equipment_id;
end
$$;

revoke all on function public.save_production_equipment_capabilities(uuid,text[]) from public,anon;
grant execute on function public.save_production_equipment_capabilities(uuid,text[]) to authenticated;

create or replace function public.production_find_dispatch_slot_internal(
  p_job_id uuid,
  p_not_before timestamptz default now(),
  p_preferred_equipment_id uuid default null,
  p_target_date date default null,
  p_horizon_days integer default null
) returns table(
  equipment_id uuid,
  inventory_number text,
  equipment_name text,
  slot_start timestamptz,
  slot_end timestamptz,
  deadline_at timestamptz,
  predicted_late boolean,
  lateness_minutes integer,
  compatibility_mode text
)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_job public.production_jobs%rowtype;
  v_settings public.production_dispatch_settings%rowtype;
  v_deadline timestamptz;
  v_horizon integer;
  v_start_date date;
  v_end_date date;
  v_date date;
  v_machine record;
  v_busy record;
  v_available integer;
  v_duration_minutes numeric;
  v_duration interval;
  v_gap interval;
  v_day_start timestamptz;
  v_day_end timestamptz;
  v_cursor timestamptz;
  v_candidate_start timestamptz;
  v_candidate_end timestamptz;
  v_block_start timestamptz;
  v_block_end timestamptz;
  v_best_equipment uuid;
  v_best_inventory text;
  v_best_name text;
  v_best_start timestamptz;
  v_best_end timestamptz;
  v_has_mapping boolean;
  v_compat text;
begin
  select * into v_job from public.production_jobs j where j.id=p_job_id;
  if v_job.id is null then raise exception 'PRODUCTION_JOB_NOT_FOUND'; end if;

  select * into v_settings from public.production_dispatch_settings s where s.id=1;
  if v_settings.id is null then
    v_settings.id=1;
    v_settings.timezone='Asia/Yekaterinburg';
    v_settings.workday_start='09:00';
    v_settings.planning_horizon_days=30;
    v_settings.setup_gap_minutes=10;
  end if;

  select coalesce(v_job.deadline_at,o.due_at)
    into v_deadline
    from public.orders o
   where o.id=v_job.order_id;
  if not found then v_deadline:=v_job.deadline_at; end if;

  v_duration_minutes:=greatest(1,coalesce(v_job.planned_machine_minutes,60));
  v_duration:=v_duration_minutes * interval '1 minute';
  v_gap:=greatest(0,v_settings.setup_gap_minutes) * interval '1 minute';
  v_horizon:=greatest(1,least(120,coalesce(p_horizon_days,v_settings.planning_horizon_days,30)));
  v_start_date:=coalesce(p_target_date,(coalesce(p_not_before,now()) at time zone v_settings.timezone)::date);
  v_end_date:=case when p_target_date is not null then p_target_date else v_start_date+(v_horizon-1) end;

  select exists(
    select 1
      from public.production_equipment_capabilities c
     where c.is_active
       and v_job.operation_type is not null
       and c.operation_type=v_job.operation_type
  ) into v_has_mapping;

  v_compat:=case
    when v_job.operation_type is null then 'ANY_UNTYPED'
    when v_has_mapping then 'MAPPED'
    else 'FALLBACK_UNMAPPED'
  end;

  v_date:=v_start_date;
  while v_date<=v_end_date loop
    for v_machine in
      select e.id,e.inventory_number,e.name,e.status,e.operational_status
        from public.equipment_assets e
       where e.status<>'WRITTEN_OFF'
         and coalesce(e.operational_status,'READY') not in ('MAINTENANCE','REPAIR','FAULT','WAITING_PARTS','OFFLINE','RETIRED')
         and (p_preferred_equipment_id is null or e.id=p_preferred_equipment_id)
         and (
           not v_has_mapping
           or exists(
             select 1 from public.production_equipment_capabilities c
              where c.equipment_id=e.id
                and c.operation_type=v_job.operation_type
                and c.is_active
           )
         )
       order by e.inventory_number nulls last,e.name,e.id
    loop
      select case when r.is_active then r.available_minutes else 0 end
        into v_available
        from public.equipment_capacity_rules r
       where r.equipment_id=v_machine.id
         and r.weekday=extract(isodow from v_date)::integer;

      if v_available is null then
        v_available:=case when extract(isodow from v_date)::integer between 1 and 5 then 480 else 0 end;
      end if;
      if v_available<=0 then continue; end if;

      v_day_start:=(v_date::timestamp+v_settings.workday_start) at time zone v_settings.timezone;
      v_day_end:=v_day_start+(v_available*interval '1 minute');
      v_cursor:=greatest(v_day_start,coalesce(p_not_before,now()));
      v_candidate_start:=null;
      v_candidate_end:=null;
      if v_cursor>=v_day_end then continue; end if;

      for v_busy in
        select j.planned_start,j.planned_end
          from public.production_jobs j
         where j.id<>v_job.id
           and j.equipment_id=v_machine.id
           and j.status in ('NEW','QUEUED','IN_PROGRESS','PAUSED')
           and j.planned_start is not null
           and j.planned_end is not null
           and tstzrange(j.planned_start,j.planned_end,'[)') && tstzrange(v_day_start,v_day_end,'[)')
         order by j.planned_start,j.planned_end,j.id
      loop
        v_block_start:=v_busy.planned_start-v_gap;
        v_block_end:=v_busy.planned_end+v_gap;
        if v_cursor+v_duration<=least(v_block_start,v_day_end) then
          v_candidate_start:=v_cursor;
          v_candidate_end:=v_cursor+v_duration;
          exit;
        end if;
        if v_cursor<v_block_end then v_cursor:=v_block_end; end if;
        if v_cursor>=v_day_end then exit; end if;
      end loop;

      if v_candidate_start is null and v_cursor+v_duration<=v_day_end then
        v_candidate_start:=v_cursor;
        v_candidate_end:=v_cursor+v_duration;
      end if;

      if v_candidate_start is not null
         and (v_best_start is null or v_candidate_start<v_best_start
              or (v_candidate_start=v_best_start and coalesce(v_machine.inventory_number,'')<coalesce(v_best_inventory,''))) then
        v_best_equipment:=v_machine.id;
        v_best_inventory:=v_machine.inventory_number;
        v_best_name:=v_machine.name;
        v_best_start:=v_candidate_start;
        v_best_end:=v_candidate_end;
      end if;
    end loop;

    -- Dates are scanned in order; after checking every machine, the first date with a slot is globally earliest.
    if v_best_start is not null then exit; end if;
    v_date:=v_date+1;
  end loop;

  if v_best_equipment is null then return; end if;

  equipment_id:=v_best_equipment;
  inventory_number:=v_best_inventory;
  equipment_name:=v_best_name;
  slot_start:=v_best_start;
  slot_end:=v_best_end;
  deadline_at:=v_deadline;
  predicted_late:=v_deadline is not null and v_best_end>v_deadline;
  lateness_minutes:=case when v_deadline is not null and v_best_end>v_deadline then ceil(extract(epoch from (v_best_end-v_deadline))/60)::integer else 0 end;
  compatibility_mode:=v_compat;
  return next;
end
$$;

revoke all on function public.production_find_dispatch_slot_internal(uuid,timestamptz,uuid,date,integer) from public,anon,authenticated;

create or replace function public.production_find_dispatch_slot(
  p_job_id uuid,
  p_not_before timestamptz default now(),
  p_preferred_equipment_id uuid default null,
  p_target_date date default null,
  p_horizon_days integer default null
) returns table(
  equipment_id uuid,
  inventory_number text,
  equipment_name text,
  slot_start timestamptz,
  slot_end timestamptz,
  deadline_at timestamptz,
  predicted_late boolean,
  lateness_minutes integer,
  compatibility_mode text
)
language plpgsql
security definer
set search_path=public
as $$
begin
  if not (
    public.has_permission('production.view')
    or public.has_permission('production.analytics.view')
    or public.has_permission('production.manage')
  ) then raise exception 'PERMISSION_DENIED'; end if;

  return query
  select * from public.production_find_dispatch_slot_internal(
    p_job_id,p_not_before,p_preferred_equipment_id,p_target_date,p_horizon_days
  );
end
$$;

revoke all on function public.production_find_dispatch_slot(uuid,timestamptz,uuid,date,integer) from public,anon;
grant execute on function public.production_find_dispatch_slot(uuid,timestamptz,uuid,date,integer) to authenticated;

create or replace function public.production_schedule_job_internal(
  p_job_id uuid,
  p_source text,
  p_not_before timestamptz default now(),
  p_preferred_equipment_id uuid default null,
  p_target_date date default null,
  p_force boolean default false,
  p_lock boolean default false
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_job public.production_jobs%rowtype;
  v_slot record;
  v_try integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended('production-dispatch-job:'||p_job_id::text,0));
  select * into v_job from public.production_jobs j where j.id=p_job_id for update;
  if v_job.id is null then raise exception 'PRODUCTION_JOB_NOT_FOUND'; end if;
  if v_job.status not in ('NEW','QUEUED','PAUSED') then raise exception 'JOB_CANNOT_BE_SCHEDULED'; end if;
  if v_job.dispatch_locked and not p_force then raise exception 'JOB_DISPATCH_LOCKED'; end if;

  while v_try<3 loop
    v_try:=v_try+1;
    select * into v_slot
      from public.production_find_dispatch_slot_internal(
        p_job_id,coalesce(p_not_before,now()),p_preferred_equipment_id,p_target_date,null
      ) limit 1;
    if v_slot.equipment_id is null then raise exception 'NO_DISPATCH_SLOT'; end if;

    perform pg_advisory_xact_lock(hashtextextended(v_slot.equipment_id::text,0));
    if exists(
      select 1 from public.production_jobs j
       where j.id<>p_job_id
         and j.equipment_id=v_slot.equipment_id
         and j.status in ('NEW','QUEUED','IN_PROGRESS','PAUSED')
         and j.planned_start is not null
         and j.planned_end is not null
         and tstzrange(j.planned_start,j.planned_end,'[)') && tstzrange(v_slot.slot_start,v_slot.slot_end,'[)')
    ) then
      p_not_before:=v_slot.slot_end;
      continue;
    end if;

    update public.production_jobs
       set equipment_id=v_slot.equipment_id,
           planned_start=v_slot.slot_start,
           planned_end=v_slot.slot_end,
           planned_machine_minutes=coalesce(nullif(planned_machine_minutes,0),extract(epoch from (v_slot.slot_end-v_slot.slot_start))/60),
           status=case when status='NEW'::public.production_status then 'QUEUED'::public.production_status else status end,
           dispatch_locked=p_lock,
           dispatch_source=case when p_source in ('LEGACY','MANUAL','AUTO','FAULT_REPLAN') then p_source else 'AUTO' end,
           dispatch_note=null,
           last_dispatched_at=now(),
           updated_at=now()
     where id=p_job_id;
    return p_job_id;
  end loop;

  raise exception 'DISPATCH_RETRY_EXHAUSTED';
end
$$;

revoke all on function public.production_schedule_job_internal(uuid,text,timestamptz,uuid,date,boolean,boolean) from public,anon,authenticated;

create or replace function public.auto_dispatch_production_job(
  p_job_id uuid,
  p_force boolean default false
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.has_permission('production.manage') then raise exception 'PERMISSION_DENIED'; end if;
  return public.production_schedule_job_internal(p_job_id,'AUTO',now(),null,null,p_force,false);
end
$$;

revoke all on function public.auto_dispatch_production_job(uuid,boolean) from public,anon;
grant execute on function public.auto_dispatch_production_job(uuid,boolean) to authenticated;

create or replace function public.auto_dispatch_production_queue(
  p_limit integer default 50
) returns table(scheduled_count integer,failed_count integer)
language plpgsql
security definer
set search_path=public
as $$
declare
  v_job record;
begin
  if not public.has_permission('production.manage') then raise exception 'PERMISSION_DENIED'; end if;
  scheduled_count:=0;
  failed_count:=0;

  for v_job in
    select j.id
      from public.production_jobs j
      left join public.orders o on o.id=j.order_id
     where j.status in ('NEW','QUEUED','PAUSED')
       and not j.dispatch_locked
       and (j.equipment_id is null or j.planned_start is null or j.planned_end is null)
     order by coalesce(j.deadline_at,o.due_at) asc nulls last,
              j.priority desc,
              j.created_at asc
     limit greatest(1,least(200,coalesce(p_limit,50)))
  loop
    begin
      perform public.production_schedule_job_internal(v_job.id,'AUTO',now(),null,null,false,false);
      scheduled_count:=scheduled_count+1;
    exception when others then
      failed_count:=failed_count+1;
      update public.production_jobs
         set dispatch_note=left('Автопланирование: '||sqlerrm,500),
             updated_at=now()
       where id=v_job.id;
    end;
  end loop;

  return next;
end
$$;

revoke all on function public.auto_dispatch_production_queue(integer) from public,anon;
grant execute on function public.auto_dispatch_production_queue(integer) to authenticated;

create or replace function public.schedule_production_job_into_day(
  p_job_id uuid,
  p_equipment_id uuid,
  p_work_date date
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.has_permission('production.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_work_date is null then raise exception 'WORK_DATE_REQUIRED'; end if;
  return public.production_schedule_job_internal(p_job_id,'MANUAL',now(),p_equipment_id,p_work_date,true,true);
end
$$;

revoke all on function public.schedule_production_job_into_day(uuid,uuid,date) from public,anon;
grant execute on function public.schedule_production_job_into_day(uuid,uuid,date) to authenticated;

create or replace function public.set_production_dispatch_lock(
  p_job_id uuid,
  p_locked boolean
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
begin
  if not public.has_permission('production.manage') then raise exception 'PERMISSION_DENIED'; end if;
  update public.production_jobs
     set dispatch_locked=coalesce(p_locked,false),
         dispatch_source=case when coalesce(p_locked,false) then coalesce(dispatch_source,'MANUAL') else dispatch_source end,
         updated_at=now()
   where id=p_job_id;
  if not found then raise exception 'PRODUCTION_JOB_NOT_FOUND'; end if;
  return p_job_id;
end
$$;

revoke all on function public.set_production_dispatch_lock(uuid,boolean) from public,anon;
grant execute on function public.set_production_dispatch_lock(uuid,boolean) to authenticated;

-- Keep the phase-7 manual scheduler, but mark manual windows as pinned.
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
         dispatch_locked=true,
         dispatch_source='MANUAL',
         dispatch_note=null,
         last_dispatched_at=now(),
         updated_at=now()
   where id=p_job_id;

  return p_job_id;
end
$$;

revoke all on function public.schedule_production_job(uuid,uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.schedule_production_job(uuid,uuid,timestamptz,timestamptz) to authenticated;

create or replace function public.replan_production_jobs_after_equipment_fault()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_was_unavailable boolean;
  v_is_unavailable boolean;
  v_job record;
  v_reason text;
begin
  v_was_unavailable:=coalesce(old.status,'')='WRITTEN_OFF'
    or coalesce(old.operational_status,'') in ('MAINTENANCE','REPAIR','FAULT','WAITING_PARTS','OFFLINE','RETIRED');
  v_is_unavailable:=coalesce(new.status,'')='WRITTEN_OFF'
    or coalesce(new.operational_status,'') in ('MAINTENANCE','REPAIR','FAULT','WAITING_PARTS','OFFLINE','RETIRED');

  if v_was_unavailable or not v_is_unavailable then return new; end if;
  v_reason:='Оборудование '||coalesce(new.inventory_number,new.name,new.id::text)||' стало недоступно: '||coalesce(new.operational_status,new.status,'UNKNOWN');

  for v_job in
    select j.id
      from public.production_jobs j
     where j.equipment_id=new.id
       and j.status in ('NEW','QUEUED','PAUSED')
       and not j.dispatch_locked
     order by j.planned_start nulls first,j.priority desc,j.created_at
  loop
    update public.production_jobs
       set equipment_id=null,
           planned_start=null,
           planned_end=null,
           dispatch_source='FAULT_REPLAN',
           dispatch_note=left(v_reason||'. Ищу новый слот.',500),
           last_dispatched_at=now(),
           updated_at=now()
     where id=v_job.id;

    begin
      perform public.production_schedule_job_internal(v_job.id,'FAULT_REPLAN',now(),null,null,true,false);
    exception when others then
      update public.production_jobs
         set dispatch_note=left(v_reason||'. Свободный альтернативный слот не найден: '||sqlerrm,500),
             updated_at=now()
       where id=v_job.id;
    end;
  end loop;

  return new;
end
$$;

revoke all on function public.replan_production_jobs_after_equipment_fault() from public,anon,authenticated;
drop trigger if exists trg_replan_production_jobs_after_equipment_fault on public.equipment_assets;
create trigger trg_replan_production_jobs_after_equipment_fault
after update of status,operational_status on public.equipment_assets
for each row execute function public.replan_production_jobs_after_equipment_fault();
