-- A4PRINT HUB: production farm phase 2.
-- Connect production jobs to concrete machines and keep real machine runtime.
-- Existing order <-> production sync remains the source of order lifecycle truth.

alter table public.production_jobs
  add column if not exists order_item_id uuid references public.order_items(id) on delete set null,
  add column if not exists equipment_id uuid references public.equipment_assets(id) on delete set null,
  add column if not exists operation_type text,
  add column if not exists quantity numeric(14,3) not null default 1 check(quantity>0),
  add column if not exists planned_machine_minutes numeric(12,2) check(planned_machine_minutes is null or planned_machine_minutes>=0),
  add column if not exists actual_machine_minutes numeric(12,2) not null default 0 check(actual_machine_minutes>=0),
  add column if not exists operation_amount numeric(14,2) not null default 0 check(operation_amount>=0),
  add column if not exists primary_material_id uuid references public.catalog_items(id) on delete set null,
  add column if not exists production_cost numeric(14,2) not null default 0 check(production_cost>=0);

alter table public.production_jobs drop constraint if exists production_jobs_operation_type_check;
alter table public.production_jobs add constraint production_jobs_operation_type_check check(
  operation_type is null or operation_type in (
    'PRINT_2D','PRINT_3D_FDM','PRINT_3D_RESIN','LASER_CUT','LASER_ENGRAVE',
    'CNC','LAMINATION','POSTPRESS','ASSEMBLY','OTHER'
  )
);

create index if not exists production_jobs_equipment_status_idx
  on public.production_jobs(equipment_id,status,priority desc,created_at)
  where equipment_id is not null;
create index if not exists production_jobs_order_item_idx
  on public.production_jobs(order_item_id)
  where order_item_id is not null;
create index if not exists production_jobs_primary_material_idx
  on public.production_jobs(primary_material_id)
  where primary_material_id is not null;

-- One physical machine cannot execute two jobs at the same time.
create unique index if not exists production_jobs_one_running_per_equipment_idx
  on public.production_jobs(equipment_id)
  where equipment_id is not null and status='IN_PROGRESS'::public.production_status;

create table if not exists public.production_job_runs (
  id uuid primary key default gen_random_uuid(),
  production_job_id uuid not null references public.production_jobs(id) on delete cascade,
  equipment_id uuid not null references public.equipment_assets(id) on delete restrict,
  operator_user_id uuid references public.users(id) on delete set null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  elapsed_seconds bigint check(elapsed_seconds is null or elapsed_seconds>=0),
  end_reason text check(end_reason is null or end_reason in ('PAUSED','DONE','CANCELLED','EQUIPMENT_CHANGED','STATUS_CHANGED')),
  note text,
  created_at timestamptz not null default now(),
  check(ended_at is null or ended_at>=started_at),
  check((ended_at is null and elapsed_seconds is null and end_reason is null) or ended_at is not null)
);

create index if not exists production_job_runs_job_idx
  on public.production_job_runs(production_job_id,started_at desc);
create index if not exists production_job_runs_equipment_idx
  on public.production_job_runs(equipment_id,started_at desc);
create unique index if not exists production_job_runs_one_active_per_job_idx
  on public.production_job_runs(production_job_id) where ended_at is null;
create unique index if not exists production_job_runs_one_active_per_equipment_idx
  on public.production_job_runs(equipment_id) where ended_at is null;

alter table public.production_job_runs enable row level security;
drop policy if exists production_job_runs_staff_read on public.production_job_runs;
create policy production_job_runs_staff_read on public.production_job_runs
for select to authenticated using(public.has_permission('production.view'));
grant select on public.production_job_runs to authenticated;

-- Recalculate stored completed runtime. While a segment is RUNNING the UI adds
-- the open segment duration live, so production_jobs stays stable and cheap.
create or replace function public.recalculate_production_job_machine_time(p_job_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
begin
  update public.production_jobs p
     set actual_machine_minutes=coalesce((
       select round((sum(r.elapsed_seconds)::numeric/60),2)
       from public.production_job_runs r
       where r.production_job_id=p_job_id and r.ended_at is not null
     ),0),
     updated_at=now()
   where p.id=p_job_id;
end
$$;

create or replace function public.refresh_equipment_operational_status(p_equipment_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_current text;
  v_lifecycle text;
begin
  if p_equipment_id is null then return; end if;

  select operational_status,status into v_current,v_lifecycle
    from public.equipment_assets
   where id=p_equipment_id
   for update;
  if not found then return; end if;

  if v_lifecycle='WRITTEN_OFF' then
    update public.equipment_assets set operational_status='RETIRED' where id=p_equipment_id and operational_status<>'RETIRED';
    return;
  end if;

  if exists(select 1 from public.production_jobs j where j.equipment_id=p_equipment_id and j.status='IN_PROGRESS'::public.production_status) then
    update public.equipment_assets set operational_status='WORKING' where id=p_equipment_id and operational_status<>'WORKING';
    return;
  end if;

  -- Explicit service/fault states are never cleared automatically by the queue.
  if v_current in ('MAINTENANCE','REPAIR','FAULT','WAITING_PARTS','OFFLINE','RETIRED') then
    return;
  end if;

  if exists(select 1 from public.production_jobs j where j.equipment_id=p_equipment_id and j.status in ('NEW','QUEUED','PAUSED')) then
    update public.equipment_assets set operational_status='QUEUED' where id=p_equipment_id and operational_status<>'QUEUED';
  else
    update public.equipment_assets set operational_status='FREE' where id=p_equipment_id and operational_status<>'FREE';
  end if;
end
$$;

-- This trigger makes the legacy status dropdown safe too: any transition of a
-- machine-bound job opens/closes runtime segments even if the old UI writes the
-- production_jobs row directly.
create or replace function public.sync_production_job_execution()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_now timestamptz:=now();
  v_reason text;
  v_operator uuid;
  v_machine_state text;
  v_lifecycle text;
begin
  v_operator:=public.current_staff_user_id();

  if tg_op='UPDATE' and old.status='IN_PROGRESS'::public.production_status
     and (new.status is distinct from old.status or new.equipment_id is distinct from old.equipment_id) then
    v_reason:=case
      when new.equipment_id is distinct from old.equipment_id then 'EQUIPMENT_CHANGED'
      when new.status='PAUSED'::public.production_status then 'PAUSED'
      when new.status='DONE'::public.production_status then 'DONE'
      when new.status='CANCELLED'::public.production_status then 'CANCELLED'
      else 'STATUS_CHANGED'
    end;

    update public.production_job_runs
       set ended_at=v_now,
           elapsed_seconds=greatest(0,floor(extract(epoch from (v_now-started_at)))::bigint),
           end_reason=v_reason
     where production_job_id=new.id and ended_at is null;

    perform public.recalculate_production_job_machine_time(new.id);
    perform public.refresh_equipment_operational_status(old.equipment_id);
  end if;

  if new.status='IN_PROGRESS'::public.production_status and new.equipment_id is not null
     and (tg_op='INSERT' or old.status is distinct from new.status or old.equipment_id is distinct from new.equipment_id) then
    select operational_status,status into v_machine_state,v_lifecycle
      from public.equipment_assets where id=new.equipment_id for update;
    if not found then raise exception 'EQUIPMENT_NOT_FOUND'; end if;
    if v_lifecycle='WRITTEN_OFF' or v_machine_state in ('MAINTENANCE','REPAIR','FAULT','WAITING_PARTS','OFFLINE','RETIRED') then
      raise exception 'EQUIPMENT_UNAVAILABLE: %',v_machine_state;
    end if;

    if exists(
      select 1 from public.production_job_runs r
      where r.equipment_id=new.equipment_id and r.ended_at is null and r.production_job_id<>new.id
    ) then
      raise exception 'EQUIPMENT_ALREADY_RUNNING';
    end if;

    insert into public.production_job_runs(production_job_id,equipment_id,operator_user_id,started_at)
    values(new.id,new.equipment_id,v_operator,v_now)
    on conflict do nothing;

    update public.equipment_assets set operational_status='WORKING'
     where id=new.equipment_id and operational_status<>'WORKING';
  else
    perform public.refresh_equipment_operational_status(new.equipment_id);
  end if;

  return new;
end
$$;

drop trigger if exists trg_sync_production_job_execution on public.production_jobs;
create trigger trg_sync_production_job_execution
after insert or update of status,equipment_id on public.production_jobs
for each row execute function public.sync_production_job_execution();

-- Existing IN_PROGRESS jobs have no machine assignment, so this backfill only
-- normalizes machines that already have queued jobs after this migration.
do $$
declare v_equipment_id uuid;
begin
  for v_equipment_id in select id from public.equipment_assets loop
    perform public.refresh_equipment_operational_status(v_equipment_id);
  end loop;
end $$;

-- Permission checked API for job configuration. It intentionally does not create
-- a second job/order model and updates the existing production_jobs row.
create or replace function public.configure_production_job(
  p_job_id uuid,
  p_equipment_id uuid,
  p_order_item_id uuid default null,
  p_operation_type text default null,
  p_quantity numeric default 1,
  p_planned_machine_minutes numeric default null,
  p_operation_amount numeric default 0,
  p_primary_material_id uuid default null,
  p_production_cost numeric default 0
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_order_id uuid;
  v_item_order_id uuid;
begin
  if not public.has_permission('production.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_quantity is null or p_quantity<=0 then raise exception 'INVALID_QUANTITY'; end if;
  if p_planned_machine_minutes is not null and p_planned_machine_minutes<0 then raise exception 'INVALID_PLANNED_MACHINE_TIME'; end if;
  if coalesce(p_operation_amount,0)<0 or coalesce(p_production_cost,0)<0 then raise exception 'INVALID_AMOUNT'; end if;
  if p_operation_type is not null and p_operation_type not in ('PRINT_2D','PRINT_3D_FDM','PRINT_3D_RESIN','LASER_CUT','LASER_ENGRAVE','CNC','LAMINATION','POSTPRESS','ASSEMBLY','OTHER') then raise exception 'INVALID_OPERATION_TYPE'; end if;

  select order_id into v_order_id from public.production_jobs where id=p_job_id for update;
  if not found then raise exception 'PRODUCTION_JOB_NOT_FOUND'; end if;

  if p_order_item_id is not null then
    select order_id into v_item_order_id from public.order_items where id=p_order_item_id;
    if v_item_order_id is null then raise exception 'ORDER_ITEM_NOT_FOUND'; end if;
    if v_order_id is not null and v_item_order_id<>v_order_id then raise exception 'ORDER_ITEM_JOB_MISMATCH'; end if;
  end if;

  if p_equipment_id is not null and not exists(select 1 from public.equipment_assets where id=p_equipment_id) then
    raise exception 'EQUIPMENT_NOT_FOUND';
  end if;

  update public.production_jobs set
    equipment_id=p_equipment_id,
    order_item_id=p_order_item_id,
    operation_type=p_operation_type,
    quantity=p_quantity,
    planned_machine_minutes=p_planned_machine_minutes,
    operation_amount=coalesce(p_operation_amount,0),
    primary_material_id=p_primary_material_id,
    production_cost=coalesce(p_production_cost,0),
    updated_at=now()
  where id=p_job_id;

  return p_job_id;
end
$$;

-- Explicit lifecycle API used by the enhanced UI. The DB trigger above still
-- protects direct legacy status writes.
create or replace function public.transition_production_job(p_job_id uuid,p_action text)
returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_job public.production_jobs%rowtype;
  v_action text:=upper(btrim(coalesce(p_action,'')));
  v_status public.production_status;
  v_now timestamptz:=now();
begin
  if not public.has_permission('production.manage') then raise exception 'PERMISSION_DENIED'; end if;

  select * into v_job from public.production_jobs where id=p_job_id for update;
  if v_job.id is null then raise exception 'PRODUCTION_JOB_NOT_FOUND'; end if;

  if v_action in ('START','RESUME') then
    if v_job.equipment_id is null then raise exception 'EQUIPMENT_REQUIRED'; end if;
    if v_action='RESUME' and v_job.status<>'PAUSED'::public.production_status then raise exception 'JOB_NOT_PAUSED'; end if;
    if v_action='START' and v_job.status not in ('NEW','QUEUED','PAUSED') then raise exception 'JOB_CANNOT_START'; end if;
    v_status:='IN_PROGRESS'::public.production_status;
  elsif v_action='PAUSE' then
    if v_job.status<>'IN_PROGRESS'::public.production_status then raise exception 'JOB_NOT_RUNNING'; end if;
    v_status:='PAUSED'::public.production_status;
  elsif v_action='COMPLETE' then
    if v_job.status not in ('IN_PROGRESS','PAUSED') then raise exception 'JOB_CANNOT_COMPLETE'; end if;
    v_status:='DONE'::public.production_status;
  elsif v_action='CANCEL' then
    if v_job.status in ('DONE','CANCELLED') then raise exception 'JOB_ALREADY_CLOSED'; end if;
    v_status:='CANCELLED'::public.production_status;
  else
    raise exception 'INVALID_JOB_ACTION';
  end if;

  update public.production_jobs set
    status=v_status,
    started_at=case when v_status='IN_PROGRESS'::public.production_status then coalesce(started_at,v_now) else started_at end,
    completed_at=case when v_status='DONE'::public.production_status then coalesce(completed_at,v_now) when v_job.status='DONE'::public.production_status then null else completed_at end,
    updated_at=v_now
  where id=p_job_id;

  return p_job_id;
end
$$;

-- Trigger-only helpers are not public RPCs.
revoke all on function public.recalculate_production_job_machine_time(uuid) from public,anon,authenticated;
revoke all on function public.refresh_equipment_operational_status(uuid) from public,anon,authenticated;
revoke all on function public.sync_production_job_execution() from public,anon,authenticated;

-- Deliberate authenticated RPCs, each with an internal permission check.
revoke all on function public.configure_production_job(uuid,uuid,uuid,text,numeric,numeric,numeric,uuid,numeric) from public,anon;
revoke all on function public.transition_production_job(uuid,text) from public,anon;
grant execute on function public.configure_production_job(uuid,uuid,uuid,text,numeric,numeric,numeric,uuid,numeric) to authenticated;
grant execute on function public.transition_production_job(uuid,text) to authenticated;

-- Runtime segments are immutable from the browser and are audited automatically.
drop trigger if exists trg_audit_production_job_runs on public.production_job_runs;
create trigger trg_audit_production_job_runs
after insert or update or delete on public.production_job_runs
for each row execute function public.audit_row_change();
