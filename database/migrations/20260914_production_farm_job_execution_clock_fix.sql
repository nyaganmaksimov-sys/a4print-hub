-- Machine runtime must use wall-clock time. PostgreSQL now() is fixed at the
-- transaction start and would undercount sessions changed inside one transaction.

create or replace function public.sync_production_job_execution()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_now timestamptz:=clock_timestamp();
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
  v_now timestamptz:=clock_timestamp();
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
    completed_at=case when v_status='DONE'::public.production_status then coalesce(completed_at,v_now) else completed_at end,
    updated_at=v_now
  where id=p_job_id;

  return p_job_id;
end
$$;

revoke all on function public.sync_production_job_execution() from public,anon,authenticated;
revoke all on function public.transition_production_job(uuid,text) from public,anon;
grant execute on function public.transition_production_job(uuid,text) to authenticated;
