-- Phase 13 hardening after transactional failure simulation.
-- Preserve the pre-incident state across overlapping incidents and include the
-- original failed job in impact metrics even if the dispatcher moves it away.

alter table public.equipment_incidents
  add column if not exists previous_operational_status text,
  add column if not exists previous_lifecycle_status text;

create or replace function public.sync_equipment_incident_status(p_equipment_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_target text;
  v_previous_operational text;
  v_previous_lifecycle text;
begin
  if p_equipment_id is null then return; end if;

  select case
    when bool_or(status='REPAIRING') then 'REPAIR'
    when bool_or(status='WAITING_PARTS') then 'WAITING_PARTS'
    when bool_or(status in ('OPEN','DIAGNOSING')) then 'FAULT'
    else null
  end
  into v_target
  from public.equipment_incidents
  where equipment_id=p_equipment_id
    and status in ('OPEN','DIAGNOSING','WAITING_PARTS','REPAIRING');

  if v_target is not null then
    update public.equipment_assets
       set operational_status=v_target,
           status=case when v_target='REPAIR' then 'REPAIR' else status end,
           updated_at=clock_timestamp()
     where id=p_equipment_id;
    return;
  end if;

  select previous_operational_status,previous_lifecycle_status
    into v_previous_operational,v_previous_lifecycle
  from public.equipment_incidents
  where equipment_id=p_equipment_id
    and previous_operational_status is not null
  order by coalesce(resolved_at,reported_at) desc
  limit 1;

  update public.equipment_assets
     set status=coalesce(v_previous_lifecycle,'ACTIVE'),
         operational_status=case
           when v_previous_operational in ('MAINTENANCE','REPAIR','FAULT','WAITING_PARTS','OFFLINE','RETIRED')
             then v_previous_operational
           else 'FREE'
         end,
         updated_at=clock_timestamp()
   where id=p_equipment_id;

  if coalesce(v_previous_operational,'FREE') not in ('MAINTENANCE','REPAIR','FAULT','WAITING_PARTS','OFFLINE','RETIRED') then
    perform public.refresh_equipment_operational_status(p_equipment_id);
  end if;
end
$$;
revoke all on function public.sync_equipment_incident_status(uuid) from public,anon,authenticated;

create or replace function public.report_equipment_incident(
  p_equipment_id uuid,
  p_production_job_id uuid default null,
  p_description text default null,
  p_preliminary_cause text default null,
  p_severity text default 'MEDIUM',
  p_responsible_user_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_equipment public.equipment_assets%rowtype;
  v_job public.production_jobs%rowtype;
  v_actor uuid:=public.current_staff_user_id();
  v_operator uuid;
  v_incident_id uuid;
  v_run_id uuid;
  v_severity text:=upper(btrim(coalesce(p_severity,'MEDIUM')));
  v_now timestamptz:=clock_timestamp();
  v_previous_operational text;
  v_previous_lifecycle text;
begin
  if not (public.has_permission('production.manage') or public.has_permission('equipment.repair')) then raise exception 'PERMISSION_DENIED'; end if;
  if p_equipment_id is null then raise exception 'EQUIPMENT_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_description,'')),'') is null then raise exception 'INCIDENT_DESCRIPTION_REQUIRED'; end if;
  if v_severity not in ('LOW','MEDIUM','HIGH','CRITICAL') then raise exception 'INVALID_INCIDENT_SEVERITY'; end if;

  select * into v_equipment from public.equipment_assets where id=p_equipment_id for update;
  if v_equipment.id is null then raise exception 'EQUIPMENT_NOT_FOUND'; end if;
  if v_equipment.status='WRITTEN_OFF' or v_equipment.operational_status='RETIRED' then raise exception 'EQUIPMENT_RETIRED'; end if;
  if p_responsible_user_id is not null and not exists(select 1 from public.users where id=p_responsible_user_id and is_active) then raise exception 'RESPONSIBLE_USER_NOT_FOUND'; end if;

  select previous_operational_status,previous_lifecycle_status
    into v_previous_operational,v_previous_lifecycle
  from public.equipment_incidents
  where equipment_id=p_equipment_id and status in ('OPEN','DIAGNOSING','WAITING_PARTS','REPAIRING')
  order by reported_at limit 1;
  v_previous_operational:=coalesce(v_previous_operational,v_equipment.operational_status);
  v_previous_lifecycle:=coalesce(v_previous_lifecycle,v_equipment.status);

  if p_production_job_id is not null then
    select * into v_job from public.production_jobs where id=p_production_job_id for update;
    if v_job.id is null then raise exception 'PRODUCTION_JOB_NOT_FOUND'; end if;
    if v_job.equipment_id is distinct from p_equipment_id then raise exception 'INCIDENT_JOB_EQUIPMENT_MISMATCH'; end if;
    if exists(select 1 from public.equipment_incidents where production_job_id=p_production_job_id and status in ('OPEN','DIAGNOSING','WAITING_PARTS','REPAIRING')) then raise exception 'ACTIVE_JOB_INCIDENT_EXISTS'; end if;

    select id,operator_user_id into v_run_id,v_operator from public.production_job_runs
    where production_job_id=p_production_job_id and ended_at is null
    order by started_at desc limit 1 for update;

    if v_job.status='IN_PROGRESS'::public.production_status then
      if v_run_id is not null then
        update public.production_job_runs set pause_reason='EQUIPMENT',note=left(btrim(p_description),1500) where id=v_run_id;
      end if;
      update public.production_jobs set status='PAUSED'::public.production_status,updated_at=v_now where id=p_production_job_id;
    end if;
  end if;

  insert into public.equipment_incidents(
    equipment_id,production_job_id,order_id,operator_user_id,reported_by,reported_at,
    description,preliminary_cause,severity,status,responsible_user_id,downtime_started_at,
    previous_operational_status,previous_lifecycle_status
  ) values(
    p_equipment_id,p_production_job_id,v_job.order_id,coalesce(v_operator,v_job.assigned_to,v_actor),v_actor,v_now,
    btrim(p_description),nullif(btrim(coalesce(p_preliminary_cause,'')),''),v_severity,'OPEN',
    coalesce(p_responsible_user_id,v_equipment.responsible_user_id),v_now,
    v_previous_operational,v_previous_lifecycle
  ) returning id into v_incident_id;

  update public.equipment_assets set operational_status='FAULT',updated_at=v_now where id=p_equipment_id;
  perform public.notify_equipment_incident(v_incident_id);
  return v_incident_id;
end
$$;
revoke all on function public.report_equipment_incident(uuid,uuid,text,text,text,uuid) from public,anon;
grant execute on function public.report_equipment_incident(uuid,uuid,text,text,text,uuid) to authenticated;

-- Adding columns to equipment_incidents changes i.* expansion. Rebuild this new
-- phase-13 view explicitly instead of relying on CREATE OR REPLACE column order.
drop view if exists public.equipment_incident_overview;
create view public.equipment_incident_overview
with (security_invoker=true)
as
select
  i.*,
  e.inventory_number,
  e.name as equipment_name,
  e.operational_status,
  j.title as production_job_title,
  o.order_number,
  coalesce(impact.affected_orders,0)::integer as affected_orders,
  coalesce(impact.potential_lost_revenue,0)::numeric(14,2) as potential_lost_revenue,
  round(greatest(0,extract(epoch from (coalesce(i.downtime_ended_at,clock_timestamp())-i.downtime_started_at))/60)::numeric,2) as downtime_minutes,
  coalesce(repairs.repair_count,0)::integer as repair_count,
  coalesce(repairs.repair_cost,0)::numeric(14,2) as repair_cost,
  coalesce(docs.document_count,0)::integer as document_count
from public.equipment_incidents i
join public.equipment_assets e on e.id=i.equipment_id
left join public.production_jobs j on j.id=i.production_job_id
left join public.orders o on o.id=i.order_id
left join lateral(
  select count(distinct x.order_id) filter(where x.order_id is not null) as affected_orders,
         coalesce(sum(x.operation_amount),0) as potential_lost_revenue
  from public.production_jobs x
  where x.status<>'CANCELLED'::public.production_status
    and (
      x.id=i.production_job_id
      or (
        x.equipment_id=i.equipment_id
        and x.planned_start is not null and x.planned_end is not null
        and x.planned_start<coalesce(i.downtime_ended_at,clock_timestamp())
        and x.planned_end>i.downtime_started_at
      )
    )
) impact on true
left join lateral(
  select count(*) as repair_count,coalesce(sum(s.cost),0) as repair_cost
  from public.equipment_service_log s
  where s.incident_id=i.id and s.service_type='REPAIR'
) repairs on true
left join lateral(
  select count(*) as document_count
  from public.document_links dl
  where dl.entity_type='EQUIPMENT_INCIDENT' and dl.entity_id=i.id
) docs on true;

revoke all on public.equipment_incident_overview from public,anon;
grant select on public.equipment_incident_overview to authenticated;
