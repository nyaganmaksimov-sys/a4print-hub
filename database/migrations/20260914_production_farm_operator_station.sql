-- Production Farm phase 9: operator station, downtime reasons and quality accounting.
-- Runtime remains canonical in production_job_runs. This migration adds an immutable
-- operator journal around the existing machine run segments instead of inventing a second timer.

alter table public.production_jobs
  add column if not exists good_quantity numeric(14,3) not null default 0 check(good_quantity>=0),
  add column if not exists scrap_quantity numeric(14,3) not null default 0 check(scrap_quantity>=0),
  add column if not exists rework_quantity numeric(14,3) not null default 0 check(rework_quantity>=0),
  add column if not exists downtime_minutes numeric(14,2) not null default 0 check(downtime_minutes>=0);

alter table public.production_job_runs
  add column if not exists pause_reason text;

alter table public.production_job_runs drop constraint if exists production_job_runs_pause_reason_check;
alter table public.production_job_runs add constraint production_job_runs_pause_reason_check check(
  pause_reason is null or pause_reason in (
    'EQUIPMENT','MATERIAL','QUALITY','OPERATOR','MAINTENANCE',
    'WAITING_APPROVAL','BREAK','POWER','SOFTWARE','OTHER'
  )
);

create table if not exists public.production_job_events (
  id uuid primary key default gen_random_uuid(),
  production_job_id uuid not null references public.production_jobs(id) on delete cascade,
  equipment_id uuid references public.equipment_assets(id) on delete set null,
  run_id uuid references public.production_job_runs(id) on delete set null,
  operator_user_id uuid references public.users(id) on delete set null,
  event_type text not null check(event_type in (
    'START','RESUME','PAUSE','COMPLETE','CANCEL','EQUIPMENT_CHANGED','STATUS_CHANGED',
    'OUTPUT','SCRAP','REWORK','NOTE'
  )),
  reason_code text,
  note text,
  good_quantity numeric(14,3) not null default 0 check(good_quantity>=0),
  scrap_quantity numeric(14,3) not null default 0 check(scrap_quantity>=0),
  rework_quantity numeric(14,3) not null default 0 check(rework_quantity>=0),
  duration_seconds bigint check(duration_seconds is null or duration_seconds>=0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default clock_timestamp()
);

create index if not exists production_job_events_job_created_idx
  on public.production_job_events(production_job_id,created_at desc);
create index if not exists production_job_events_equipment_created_idx
  on public.production_job_events(equipment_id,created_at desc)
  where equipment_id is not null;
create index if not exists production_job_events_operator_created_idx
  on public.production_job_events(operator_user_id,created_at desc)
  where operator_user_id is not null;
create index if not exists production_job_events_open_pause_idx
  on public.production_job_events(production_job_id,created_at desc)
  where event_type='PAUSE' and duration_seconds is null;

alter table public.production_job_events enable row level security;
drop policy if exists production_job_events_staff_read on public.production_job_events;
create policy production_job_events_staff_read on public.production_job_events
for select to authenticated using(public.has_permission('production.view'));

revoke all on public.production_job_events from public,anon,authenticated;
grant select on public.production_job_events to authenticated;

create or replace function public.recalculate_production_job_operator_totals(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_good numeric;
  v_scrap numeric;
  v_rework numeric;
  v_downtime numeric;
begin
  select
    coalesce(sum(good_quantity),0),
    coalesce(sum(scrap_quantity),0),
    coalesce(sum(rework_quantity),0),
    coalesce(round(sum(case when event_type='PAUSE' then coalesce(duration_seconds,0) else 0 end)::numeric/60,2),0)
  into v_good,v_scrap,v_rework,v_downtime
  from public.production_job_events
  where production_job_id=p_job_id;

  update public.production_jobs
     set good_quantity=v_good,
         scrap_quantity=v_scrap,
         rework_quantity=v_rework,
         downtime_minutes=v_downtime,
         updated_at=clock_timestamp()
   where id=p_job_id;
end
$$;

create or replace function public.production_job_events_recalculate()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='DELETE' then
    perform public.recalculate_production_job_operator_totals(old.production_job_id);
    return old;
  end if;
  perform public.recalculate_production_job_operator_totals(new.production_job_id);
  if tg_op='UPDATE' and old.production_job_id is distinct from new.production_job_id then
    perform public.recalculate_production_job_operator_totals(old.production_job_id);
  end if;
  return new;
end
$$;

drop trigger if exists trg_production_job_events_recalculate on public.production_job_events;
create trigger trg_production_job_events_recalculate
after insert or update or delete on public.production_job_events
for each row execute function public.production_job_events_recalculate();

create or replace function public.close_production_job_pause(p_job_id uuid,p_at timestamptz default null)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_event_id uuid;
  v_started timestamptz;
  v_at timestamptz:=coalesce(p_at,clock_timestamp());
begin
  select id,created_at into v_event_id,v_started
  from public.production_job_events
  where production_job_id=p_job_id
    and event_type='PAUSE'
    and duration_seconds is null
  order by created_at desc
  limit 1
  for update;

  if v_event_id is not null then
    update public.production_job_events
       set duration_seconds=greatest(0,floor(extract(epoch from (v_at-v_started)))::bigint)
     where id=v_event_id;
  end if;
end
$$;

-- Every physical run automatically creates lifecycle journal entries. This also
-- covers legacy/admin status changes that still write production_jobs directly.
create or replace function public.log_production_job_run_event()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_type text;
  v_actor uuid;
  v_now timestamptz:=clock_timestamp();
begin
  v_actor:=coalesce(new.operator_user_id,public.current_staff_user_id());

  if tg_op='INSERT' then
    perform public.close_production_job_pause(new.production_job_id,new.started_at);
    if exists(
      select 1 from public.production_job_runs r
      where r.production_job_id=new.production_job_id and r.id<>new.id
    ) then v_type:='RESUME'; else v_type:='START'; end if;

    insert into public.production_job_events(
      production_job_id,equipment_id,run_id,operator_user_id,event_type,created_at
    ) values(
      new.production_job_id,new.equipment_id,new.id,v_actor,v_type,new.started_at
    );
    return new;
  end if;

  if tg_op='UPDATE' and old.ended_at is null and new.ended_at is not null then
    v_type:=case new.end_reason
      when 'PAUSED' then 'PAUSE'
      when 'DONE' then 'COMPLETE'
      when 'CANCELLED' then 'CANCEL'
      when 'EQUIPMENT_CHANGED' then 'EQUIPMENT_CHANGED'
      else 'STATUS_CHANGED'
    end;

    insert into public.production_job_events(
      production_job_id,equipment_id,run_id,operator_user_id,event_type,
      reason_code,note,created_at
    ) values(
      new.production_job_id,new.equipment_id,new.id,v_actor,v_type,
      case when v_type='PAUSE' then new.pause_reason else null end,
      nullif(btrim(new.note),''),new.ended_at
    );
  end if;
  return new;
end
$$;

drop trigger if exists trg_log_production_job_run_event on public.production_job_runs;
create trigger trg_log_production_job_run_event
after insert or update of ended_at on public.production_job_runs
for each row execute function public.log_production_job_run_event();

-- If a paused/queued job is completed or cancelled without an active run there is
-- no production_job_runs update to observe, so record that lifecycle transition here.
create or replace function public.log_production_job_status_without_run()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_type text;
  v_actor uuid:=public.current_staff_user_id();
  v_now timestamptz:=clock_timestamp();
begin
  if old.status is not distinct from new.status then return new; end if;

  -- IN_PROGRESS transitions are journaled by production_job_runs insert/update.
  if old.status='IN_PROGRESS'::public.production_status or new.status='IN_PROGRESS'::public.production_status then
    return new;
  end if;

  if new.status='DONE'::public.production_status then v_type:='COMPLETE';
  elsif new.status='CANCELLED'::public.production_status then v_type:='CANCEL';
  elsif new.status='PAUSED'::public.production_status then v_type:='PAUSE';
  else return new;
  end if;

  if old.status='PAUSED'::public.production_status then
    perform public.close_production_job_pause(new.id,v_now);
  end if;

  insert into public.production_job_events(
    production_job_id,equipment_id,operator_user_id,event_type,reason_code,note,created_at
  ) values(
    new.id,new.equipment_id,v_actor,v_type,
    case when v_type='PAUSE' then 'OTHER' else null end,
    case when v_type='PAUSE' then 'Статус изменён без операторской причины' else null end,
    v_now
  );
  return new;
end
$$;

drop trigger if exists trg_log_production_job_status_without_run on public.production_jobs;
create trigger trg_log_production_job_status_without_run
after update of status on public.production_jobs
for each row execute function public.log_production_job_status_without_run();

create or replace function public.production_operator_action(
  p_job_id uuid,
  p_action text,
  p_reason_code text default null,
  p_note text default null,
  p_good_quantity numeric default 0,
  p_scrap_quantity numeric default 0,
  p_rework_quantity numeric default 0
) returns public.production_jobs
language plpgsql
security definer
set search_path=public
as $$
declare
  v_job public.production_jobs%rowtype;
  v_action text:=upper(btrim(coalesce(p_action,'')));
  v_reason text:=upper(btrim(coalesce(p_reason_code,'')));
  v_actor uuid:=public.current_staff_user_id();
  v_run_id uuid;
  v_now timestamptz:=clock_timestamp();
begin
  if not public.has_permission('production.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if coalesce(p_good_quantity,0)<0 or coalesce(p_scrap_quantity,0)<0 or coalesce(p_rework_quantity,0)<0 then
    raise exception 'INVALID_QUANTITY';
  end if;

  select * into v_job from public.production_jobs where id=p_job_id for update;
  if v_job.id is null then raise exception 'PRODUCTION_JOB_NOT_FOUND'; end if;

  if v_action in ('START','RESUME') then
    if v_action='RESUME' then perform public.close_production_job_pause(p_job_id,v_now); end if;
    perform public.transition_production_job(p_job_id,v_action);

  elsif v_action='PAUSE' then
    if v_reason not in ('EQUIPMENT','MATERIAL','QUALITY','OPERATOR','MAINTENANCE','WAITING_APPROVAL','BREAK','POWER','SOFTWARE','OTHER') then
      raise exception 'PAUSE_REASON_REQUIRED';
    end if;
    select id into v_run_id from public.production_job_runs
     where production_job_id=p_job_id and ended_at is null
     order by started_at desc limit 1 for update;
    if v_run_id is null then raise exception 'ACTIVE_RUN_NOT_FOUND'; end if;
    update public.production_job_runs
       set pause_reason=v_reason,
           note=nullif(btrim(coalesce(p_note,'')),'')
     where id=v_run_id;
    perform public.transition_production_job(p_job_id,'PAUSE');

  elsif v_action='COMPLETE' then
    if v_job.status='PAUSED'::public.production_status then
      perform public.close_production_job_pause(p_job_id,v_now);
    end if;
    perform public.transition_production_job(p_job_id,'COMPLETE');
    if coalesce(p_good_quantity,0)>0 or coalesce(p_scrap_quantity,0)>0 or coalesce(p_rework_quantity,0)>0 or nullif(btrim(coalesce(p_note,'')),'') is not null then
      insert into public.production_job_events(
        production_job_id,equipment_id,operator_user_id,event_type,note,
        good_quantity,scrap_quantity,rework_quantity,created_at
      ) values(
        p_job_id,v_job.equipment_id,v_actor,'OUTPUT',nullif(btrim(coalesce(p_note,'')),''),
        coalesce(p_good_quantity,0),coalesce(p_scrap_quantity,0),coalesce(p_rework_quantity,0),v_now
      );
    end if;

  elsif v_action='OUTPUT' then
    if coalesce(p_good_quantity,0)<=0 then raise exception 'GOOD_QUANTITY_REQUIRED'; end if;
    if v_job.status='CANCELLED'::public.production_status then raise exception 'JOB_ALREADY_CLOSED'; end if;
    insert into public.production_job_events(
      production_job_id,equipment_id,operator_user_id,event_type,note,good_quantity,created_at
    ) values(
      p_job_id,v_job.equipment_id,v_actor,'OUTPUT',nullif(btrim(coalesce(p_note,'')),''),p_good_quantity,v_now
    );

  elsif v_action='SCRAP' then
    if coalesce(p_scrap_quantity,0)<=0 then raise exception 'SCRAP_QUANTITY_REQUIRED'; end if;
    if v_job.status='CANCELLED'::public.production_status then raise exception 'JOB_ALREADY_CLOSED'; end if;
    insert into public.production_job_events(
      production_job_id,equipment_id,operator_user_id,event_type,reason_code,note,scrap_quantity,created_at
    ) values(
      p_job_id,v_job.equipment_id,v_actor,'SCRAP',nullif(v_reason,''),nullif(btrim(coalesce(p_note,'')),''),p_scrap_quantity,v_now
    );

  elsif v_action='REWORK' then
    if coalesce(p_rework_quantity,0)<=0 then raise exception 'REWORK_QUANTITY_REQUIRED'; end if;
    if v_job.status='CANCELLED'::public.production_status then raise exception 'JOB_ALREADY_CLOSED'; end if;
    insert into public.production_job_events(
      production_job_id,equipment_id,operator_user_id,event_type,reason_code,note,rework_quantity,created_at
    ) values(
      p_job_id,v_job.equipment_id,v_actor,'REWORK',nullif(v_reason,''),nullif(btrim(coalesce(p_note,'')),''),p_rework_quantity,v_now
    );

  elsif v_action='NOTE' then
    if nullif(btrim(coalesce(p_note,'')),'') is null then raise exception 'NOTE_REQUIRED'; end if;
    insert into public.production_job_events(
      production_job_id,equipment_id,operator_user_id,event_type,note,created_at
    ) values(
      p_job_id,v_job.equipment_id,v_actor,'NOTE',btrim(p_note),v_now
    );
  else
    raise exception 'INVALID_OPERATOR_ACTION';
  end if;

  select * into v_job from public.production_jobs where id=p_job_id;
  return v_job;
end
$$;

create or replace view public.production_operator_overview
with (security_invoker=true)
as
select
  j.id,
  j.order_id,
  j.assigned_to,
  j.status,
  j.title,
  j.priority,
  j.equipment_id,
  j.operation_type,
  j.quantity,
  j.planned_machine_minutes,
  j.actual_machine_minutes,
  j.good_quantity,
  j.scrap_quantity,
  j.rework_quantity,
  j.downtime_minutes,
  j.deadline_at,
  j.planned_start,
  j.planned_end,
  j.started_at,
  j.completed_at,
  e.inventory_number,
  e.name as equipment_name,
  e.operational_status,
  case when (j.good_quantity+j.scrap_quantity)>0
       then round((j.good_quantity/(j.good_quantity+j.scrap_quantity))*100,2)
       else null end as yield_percent,
  r.id as active_run_id,
  r.started_at as active_run_started_at,
  p.id as open_pause_event_id,
  p.created_at as paused_at,
  p.reason_code as pause_reason,
  p.note as pause_note
from public.production_jobs j
left join public.equipment_assets e on e.id=j.equipment_id
left join lateral (
  select rr.id,rr.started_at
  from public.production_job_runs rr
  where rr.production_job_id=j.id and rr.ended_at is null
  order by rr.started_at desc limit 1
) r on true
left join lateral (
  select pe.id,pe.created_at,pe.reason_code,pe.note
  from public.production_job_events pe
  where pe.production_job_id=j.id and pe.event_type='PAUSE' and pe.duration_seconds is null
  order by pe.created_at desc limit 1
) p on true;

grant select on public.production_operator_overview to authenticated;

-- Helper/trigger functions are internal only.
revoke all on function public.recalculate_production_job_operator_totals(uuid) from public,anon,authenticated;
revoke all on function public.production_job_events_recalculate() from public,anon,authenticated;
revoke all on function public.close_production_job_pause(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.log_production_job_run_event() from public,anon,authenticated;
revoke all on function public.log_production_job_status_without_run() from public,anon,authenticated;

-- The operator RPC is the only browser write path for journal/quality data.
revoke all on function public.production_operator_action(uuid,text,text,text,numeric,numeric,numeric) from public,anon;
grant execute on function public.production_operator_action(uuid,text,text,text,numeric,numeric,numeric) to authenticated;

-- Audit journal changes just like machine run segments.
drop trigger if exists trg_audit_production_job_events on public.production_job_events;
create trigger trg_audit_production_job_events
after insert or update or delete on public.production_job_events
for each row execute function public.audit_row_change();

-- Backfill aggregate columns from any events if this migration is reapplied.
do $$
declare v_job_id uuid;
begin
  for v_job_id in select distinct production_job_id from public.production_job_events loop
    perform public.recalculate_production_job_operator_totals(v_job_id);
  end loop;
end $$;
