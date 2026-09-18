-- A4PRINT HUB: Production Farm Phase 38 — production job/dispatch tenant hardening.

create or replace function public.sync_order_status_from_production(p_job_id uuid)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  v_job public.production_jobs%rowtype;
  v_order public.orders%rowtype;
  v_remaining integer;
  v_status text;
begin
  perform private.assert_production_job_tenant(p_job_id);

  if not (
    public.has_role('ADMIN')
    or public.has_role('MANAGER')
    or public.has_role('PRODUCTION')
  ) then
    raise exception 'PRODUCTION_ACCESS_REQUIRED';
  end if;

  select * into v_job
  from public.production_jobs
  where id=p_job_id;

  if not found or v_job.order_id is null then
    return null;
  end if;

  perform private.assert_order_tenant(v_job.order_id,false);

  select * into v_order
  from public.orders
  where id=v_job.order_id;
  if not found then
    return null;
  end if;

  v_status:=v_order.status::text;
  if v_status in ('COMPLETED','CANCELLED') then
    return v_status;
  end if;

  if v_job.status::text='IN_PROGRESS' and v_status in ('NEW','CONFIRMED') then
    update public.orders
    set status='IN_PROGRESS',
        updated_at=now()
    where id=v_job.order_id;
  elsif v_job.status::text='DONE' then
    select count(*) into v_remaining
    from public.production_jobs
    where order_id=v_job.order_id
      and organization_id=v_job.organization_id
      and status::text not in ('DONE','CANCELLED');

    if v_remaining=0 then
      update public.orders
      set status='READY',
          updated_at=now()
      where id=v_job.order_id
        and status::text not in ('COMPLETED','CANCELLED');
    end if;
  end if;

  select status::text into v_status
  from public.orders
  where id=v_job.order_id;

  return v_status;
end
$$;

revoke all on function public.sync_order_status_from_production(uuid)
  from public,anon,authenticated;
grant execute on function public.sync_order_status_from_production(uuid)
  to authenticated;

alter function public.auto_dispatch_production_job(uuid,boolean)
  set search_path to '';

alter function public.auto_dispatch_production_queue(integer)
  set search_path to '';

alter function public.configure_production_job(uuid,uuid,uuid,text,numeric,numeric,numeric,uuid,numeric)
  set search_path to '';

alter function public.production_find_dispatch_slot(uuid,timestamptz,uuid,date,integer)
  set search_path to '';

alter function public.production_find_dispatch_slot_internal(uuid,timestamptz,uuid,date,integer)
  set search_path to '';

alter function public.production_operator_action(uuid,text,text,text,numeric,numeric,numeric)
  set search_path to '';

alter function public.production_schedule_job_internal(uuid,text,timestamptz,uuid,date,boolean,boolean)
  set search_path to '';

alter function public.schedule_production_job(uuid,uuid,timestamptz,timestamptz)
  set search_path to '';

alter function public.schedule_production_job_into_day(uuid,uuid,date)
  set search_path to '';

alter function public.set_production_dispatch_lock(uuid,boolean)
  set search_path to '';

alter function public.transition_production_job(uuid,text)
  set search_path to '';
