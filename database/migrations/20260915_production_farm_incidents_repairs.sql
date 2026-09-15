-- Production Farm phase 13: incidents, repairs and machine downtime.
-- Reuse the existing equipment/service/production/notification/document models.

insert into public.permissions(code,description)
values('equipment.repair','Управление неисправностями, ремонтами и инцидентами оборудования')
on conflict(code) do update set description=excluded.description;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id
from public.roles r
cross join public.permissions p
where r.name in ('ADMIN','MANAGER') and p.code='equipment.repair'
on conflict do nothing;

create table if not exists public.equipment_incidents (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment_assets(id) on delete restrict,
  production_job_id uuid references public.production_jobs(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  operator_user_id uuid references public.users(id) on delete set null,
  reported_by uuid references public.users(id) on delete set null,
  reported_at timestamptz not null default clock_timestamp(),
  description text not null check(length(btrim(description)) between 3 and 5000),
  preliminary_cause text,
  severity text not null default 'MEDIUM' check(severity in ('LOW','MEDIUM','HIGH','CRITICAL')),
  status text not null default 'OPEN' check(status in ('OPEN','DIAGNOSING','WAITING_PARTS','REPAIRING','RESOLVED','CANCELLED')),
  responsible_user_id uuid references public.users(id) on delete set null,
  resolution text,
  downtime_started_at timestamptz not null default clock_timestamp(),
  downtime_ended_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check(downtime_ended_at is null or downtime_ended_at>=downtime_started_at),
  check(resolved_at is null or status in ('RESOLVED','CANCELLED'))
);

create index if not exists equipment_incidents_equipment_status_idx
  on public.equipment_incidents(equipment_id,status,reported_at desc);
create index if not exists equipment_incidents_job_idx
  on public.equipment_incidents(production_job_id,reported_at desc)
  where production_job_id is not null;
create index if not exists equipment_incidents_order_idx
  on public.equipment_incidents(order_id,reported_at desc)
  where order_id is not null;
create index if not exists equipment_incidents_responsible_idx
  on public.equipment_incidents(responsible_user_id,status)
  where responsible_user_id is not null;
create unique index if not exists equipment_incidents_one_active_job_fault_idx
  on public.equipment_incidents(production_job_id)
  where production_job_id is not null and status in ('OPEN','DIAGNOSING','WAITING_PARTS','REPAIRING');

alter table public.equipment_incidents enable row level security;
drop policy if exists equipment_incidents_staff_read on public.equipment_incidents;
create policy equipment_incidents_staff_read on public.equipment_incidents
for select to authenticated using(
  public.has_permission('equipment.view')
  or public.has_permission('equipment.repair')
  or public.has_permission('production.view')
);

revoke all on public.equipment_incidents from public,anon,authenticated;
grant select on public.equipment_incidents to authenticated;

alter table public.equipment_service_log
  add column if not exists incident_id uuid references public.equipment_incidents(id) on delete set null,
  add column if not exists production_job_id uuid references public.production_jobs(id) on delete set null,
  add column if not exists repair_cause text,
  add column if not exists payer_type text,
  add column if not exists contract_id uuid references public.equipment_contracts(id) on delete set null,
  add column if not exists parts jsonb not null default '[]'::jsonb,
  add column if not exists resolution text;

alter table public.equipment_service_log drop constraint if exists equipment_service_log_payer_type_check;
alter table public.equipment_service_log add constraint equipment_service_log_payer_type_check
check(payer_type is null or payer_type in ('HUB','OWNER','SPLIT','WARRANTY','INSURANCE','OTHER'));

create index if not exists equipment_service_log_incident_idx
  on public.equipment_service_log(incident_id,serviced_at desc)
  where incident_id is not null;
create index if not exists equipment_service_log_production_job_idx
  on public.equipment_service_log(production_job_id)
  where production_job_id is not null;
create index if not exists equipment_service_log_contract_idx
  on public.equipment_service_log(contract_id)
  where contract_id is not null;

create or replace function public.sync_equipment_incident_status(p_equipment_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_target text;
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
     where id=p_equipment_id
       and operational_status is distinct from v_target;
  else
    -- Preserve lifecycle status, but return REPAIR lifecycle back to ACTIVE after
    -- the final incident is closed. Operational queue/running state is then derived
    -- by the existing canonical helper from production jobs.
    update public.equipment_assets
       set status='ACTIVE',updated_at=clock_timestamp()
     where id=p_equipment_id and status='REPAIR';
    perform public.refresh_equipment_operational_status(p_equipment_id);
  end if;
end
$$;

create or replace function public.equipment_incident_status_trigger()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  if tg_op='DELETE' then
    perform public.sync_equipment_incident_status(old.equipment_id);
    return old;
  end if;
  perform public.sync_equipment_incident_status(new.equipment_id);
  if tg_op='UPDATE' and old.equipment_id is distinct from new.equipment_id then
    perform public.sync_equipment_incident_status(old.equipment_id);
  end if;
  return new;
end
$$;

revoke all on function public.sync_equipment_incident_status(uuid) from public,anon,authenticated;
revoke all on function public.equipment_incident_status_trigger() from public,anon,authenticated;

drop trigger if exists trg_equipment_incident_status on public.equipment_incidents;
create trigger trg_equipment_incident_status
after insert or update of status,equipment_id or delete on public.equipment_incidents
for each row execute function public.equipment_incident_status_trigger();

drop trigger if exists trg_touch_equipment_incidents on public.equipment_incidents;
create trigger trg_touch_equipment_incidents
before update on public.equipment_incidents
for each row execute function public.touch_production_farm_updated_at();

drop trigger if exists trg_audit_equipment_incidents on public.equipment_incidents;
create trigger trg_audit_equipment_incidents
after insert or update or delete on public.equipment_incidents
for each row execute function public.audit_row_change();

create or replace function public.notify_equipment_incident(p_incident_id uuid)
returns void
language plpgsql
security definer
set search_path=public
as $$
declare
  v_inc public.equipment_incidents%rowtype;
  v_machine public.equipment_assets%rowtype;
  v_title text;
  v_body text;
begin
  select * into v_inc from public.equipment_incidents where id=p_incident_id;
  if v_inc.id is null then return; end if;
  select * into v_machine from public.equipment_assets where id=v_inc.equipment_id;

  v_title:='Неисправность оборудования · '||coalesce(v_machine.inventory_number,'')||' '||coalesce(v_machine.name,'');
  v_body:=left(v_inc.description,700);

  insert into public.notifications(user_id,title,body,type,entity_type,entity_id)
  select distinct u.id,v_title,v_body,'EQUIPMENT_INCIDENT','EQUIPMENT_INCIDENT',v_inc.id
  from public.users u
  where u.is_active
    and (
      u.id=v_machine.responsible_user_id
      or u.id=v_inc.responsible_user_id
      or exists(
        select 1
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id=ur.role_id
        join public.permissions p on p.id=rp.permission_id
        where ur.user_id=u.id and p.code='equipment.repair'
      )
    )
    and not exists(
      select 1 from public.notifications n
      where n.user_id=u.id and n.type='EQUIPMENT_INCIDENT'
        and n.entity_type='EQUIPMENT_INCIDENT' and n.entity_id=v_inc.id
    );
end
$$;
revoke all on function public.notify_equipment_incident(uuid) from public,anon,authenticated;

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
begin
  if not (public.has_permission('production.manage') or public.has_permission('equipment.repair')) then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_equipment_id is null then raise exception 'EQUIPMENT_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_description,'')),'') is null then raise exception 'INCIDENT_DESCRIPTION_REQUIRED'; end if;
  if v_severity not in ('LOW','MEDIUM','HIGH','CRITICAL') then raise exception 'INVALID_INCIDENT_SEVERITY'; end if;

  select * into v_equipment from public.equipment_assets where id=p_equipment_id for update;
  if v_equipment.id is null then raise exception 'EQUIPMENT_NOT_FOUND'; end if;
  if v_equipment.status='WRITTEN_OFF' or v_equipment.operational_status='RETIRED' then raise exception 'EQUIPMENT_RETIRED'; end if;

  if p_responsible_user_id is not null and not exists(select 1 from public.users where id=p_responsible_user_id and is_active) then
    raise exception 'RESPONSIBLE_USER_NOT_FOUND';
  end if;

  if p_production_job_id is not null then
    select * into v_job from public.production_jobs where id=p_production_job_id for update;
    if v_job.id is null then raise exception 'PRODUCTION_JOB_NOT_FOUND'; end if;
    if v_job.equipment_id is distinct from p_equipment_id then raise exception 'INCIDENT_JOB_EQUIPMENT_MISMATCH'; end if;

    if exists(
      select 1 from public.equipment_incidents
      where production_job_id=p_production_job_id
        and status in ('OPEN','DIAGNOSING','WAITING_PARTS','REPAIRING')
    ) then raise exception 'ACTIVE_JOB_INCIDENT_EXISTS'; end if;

    select id,operator_user_id into v_run_id,v_operator
    from public.production_job_runs
    where production_job_id=p_production_job_id and ended_at is null
    order by started_at desc limit 1 for update;

    if v_job.status='IN_PROGRESS'::public.production_status then
      if v_run_id is not null then
        update public.production_job_runs
           set pause_reason='EQUIPMENT',note=left(btrim(p_description),1500)
         where id=v_run_id;
      end if;
      update public.production_jobs
         set status='PAUSED'::public.production_status,updated_at=v_now
       where id=p_production_job_id;
    end if;
  end if;

  insert into public.equipment_incidents(
    equipment_id,production_job_id,order_id,operator_user_id,reported_by,reported_at,
    description,preliminary_cause,severity,status,responsible_user_id,downtime_started_at
  ) values(
    p_equipment_id,p_production_job_id,v_job.order_id,coalesce(v_operator,v_job.assigned_to,v_actor),v_actor,v_now,
    btrim(p_description),nullif(btrim(coalesce(p_preliminary_cause,'')),''),v_severity,'OPEN',
    coalesce(p_responsible_user_id,v_equipment.responsible_user_id),v_now
  ) returning id into v_incident_id;

  update public.equipment_assets
     set operational_status='FAULT',updated_at=v_now
   where id=p_equipment_id;

  perform public.notify_equipment_incident(v_incident_id);
  return v_incident_id;
end
$$;

revoke all on function public.report_equipment_incident(uuid,uuid,text,text,text,uuid) from public,anon;
grant execute on function public.report_equipment_incident(uuid,uuid,text,text,text,uuid) to authenticated;

create or replace function public.update_equipment_incident(
  p_incident_id uuid,
  p_status text,
  p_responsible_user_id uuid default null,
  p_preliminary_cause text default null,
  p_resolution text default null
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_inc public.equipment_incidents%rowtype;
  v_status text:=upper(btrim(coalesce(p_status,'')));
  v_now timestamptz:=clock_timestamp();
begin
  if not public.has_permission('equipment.repair') then raise exception 'PERMISSION_DENIED'; end if;
  if v_status not in ('OPEN','DIAGNOSING','WAITING_PARTS','REPAIRING','RESOLVED','CANCELLED') then
    raise exception 'INVALID_INCIDENT_STATUS';
  end if;
  select * into v_inc from public.equipment_incidents where id=p_incident_id for update;
  if v_inc.id is null then raise exception 'INCIDENT_NOT_FOUND'; end if;
  if v_inc.status in ('RESOLVED','CANCELLED') and v_status<>v_inc.status then raise exception 'INCIDENT_ALREADY_CLOSED'; end if;
  if p_responsible_user_id is not null and not exists(select 1 from public.users where id=p_responsible_user_id and is_active) then
    raise exception 'RESPONSIBLE_USER_NOT_FOUND';
  end if;
  if v_status='RESOLVED' and nullif(btrim(coalesce(p_resolution,v_inc.resolution,'')),'') is null then
    raise exception 'RESOLUTION_REQUIRED';
  end if;

  update public.equipment_incidents
     set status=v_status,
         responsible_user_id=coalesce(p_responsible_user_id,responsible_user_id),
         preliminary_cause=coalesce(nullif(btrim(coalesce(p_preliminary_cause,'')),''),preliminary_cause),
         resolution=coalesce(nullif(btrim(coalesce(p_resolution,'')),''),resolution),
         downtime_ended_at=case when v_status in ('RESOLVED','CANCELLED') then coalesce(downtime_ended_at,v_now) else null end,
         resolved_at=case when v_status in ('RESOLVED','CANCELLED') then coalesce(resolved_at,v_now) else null end,
         updated_at=v_now
   where id=p_incident_id;

  return p_incident_id;
end
$$;

revoke all on function public.update_equipment_incident(uuid,text,uuid,text,text) from public,anon;
grant execute on function public.update_equipment_incident(uuid,text,uuid,text,text) to authenticated;

create or replace function public.record_equipment_incident_repair(
  p_incident_id uuid,
  p_description text,
  p_cause text default null,
  p_provider text default null,
  p_cost numeric default 0,
  p_payer_type text default 'HUB',
  p_contract_id uuid default null,
  p_parts jsonb default '[]'::jsonb,
  p_resolution text default null,
  p_complete_incident boolean default false
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_inc public.equipment_incidents%rowtype;
  v_id uuid;
  v_actor uuid:=public.current_staff_user_id();
  v_payer text:=upper(btrim(coalesce(p_payer_type,'HUB')));
begin
  if not public.has_permission('equipment.repair') then raise exception 'PERMISSION_DENIED'; end if;
  if nullif(btrim(coalesce(p_description,'')),'') is null then raise exception 'REPAIR_DESCRIPTION_REQUIRED'; end if;
  if coalesce(p_cost,0)<0 then raise exception 'INVALID_REPAIR_COST'; end if;
  if v_payer not in ('HUB','OWNER','SPLIT','WARRANTY','INSURANCE','OTHER') then raise exception 'INVALID_REPAIR_PAYER'; end if;
  if p_parts is null or jsonb_typeof(p_parts)<>'array' then raise exception 'INVALID_REPAIR_PARTS'; end if;

  select * into v_inc from public.equipment_incidents where id=p_incident_id for update;
  if v_inc.id is null then raise exception 'INCIDENT_NOT_FOUND'; end if;
  if v_inc.status in ('RESOLVED','CANCELLED') then raise exception 'INCIDENT_ALREADY_CLOSED'; end if;

  if p_contract_id is not null and not exists(
    select 1 from public.equipment_contract_assets ca
    where ca.contract_id=p_contract_id and ca.equipment_id=v_inc.equipment_id
  ) then raise exception 'CONTRACT_EQUIPMENT_MISMATCH'; end if;

  insert into public.equipment_service_log(
    equipment_id,service_type,serviced_at,description,cost,provider,created_by,
    incident_id,production_job_id,repair_cause,payer_type,contract_id,parts,resolution
  ) values(
    v_inc.equipment_id,'REPAIR',current_date,btrim(p_description),coalesce(p_cost,0),
    nullif(btrim(coalesce(p_provider,'')),''),v_actor,p_incident_id,v_inc.production_job_id,
    nullif(btrim(coalesce(p_cause,'')),''),v_payer,p_contract_id,coalesce(p_parts,'[]'::jsonb),
    nullif(btrim(coalesce(p_resolution,'')),'')
  ) returning id into v_id;

  update public.equipment_incidents
     set status=case when p_complete_incident then 'RESOLVED' else 'REPAIRING' end,
         preliminary_cause=coalesce(nullif(btrim(coalesce(p_cause,'')),''),preliminary_cause),
         resolution=coalesce(nullif(btrim(coalesce(p_resolution,'')),''),resolution),
         downtime_ended_at=case when p_complete_incident then coalesce(downtime_ended_at,clock_timestamp()) else downtime_ended_at end,
         resolved_at=case when p_complete_incident then coalesce(resolved_at,clock_timestamp()) else resolved_at end,
         updated_at=clock_timestamp()
   where id=p_incident_id;

  if p_complete_incident and nullif(btrim(coalesce(p_resolution,v_inc.resolution,'')),'') is null then
    raise exception 'RESOLUTION_REQUIRED';
  end if;

  return v_id;
end
$$;

revoke all on function public.record_equipment_incident_repair(uuid,text,text,text,numeric,text,uuid,jsonb,text,boolean) from public,anon;
grant execute on function public.record_equipment_incident_repair(uuid,text,text,text,numeric,text,uuid,jsonb,text,boolean) to authenticated;

create or replace function public.link_equipment_incident_document(
  p_incident_id uuid,
  p_document_id uuid,
  p_relationship text default 'INCIDENT_ATTACHMENT'
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare v_id uuid;
begin
  if not public.has_permission('equipment.repair') then raise exception 'PERMISSION_DENIED'; end if;
  if not exists(select 1 from public.equipment_incidents where id=p_incident_id) then raise exception 'INCIDENT_NOT_FOUND'; end if;
  if not exists(select 1 from public.documents where id=p_document_id) then raise exception 'DOCUMENT_NOT_FOUND'; end if;

  select id into v_id from public.document_links
  where document_id=p_document_id and entity_type='EQUIPMENT_INCIDENT' and entity_id=p_incident_id
  limit 1;
  if v_id is null then
    insert into public.document_links(document_id,entity_type,entity_id,relationship)
    values(p_document_id,'EQUIPMENT_INCIDENT',p_incident_id,coalesce(nullif(btrim(p_relationship),''),'INCIDENT_ATTACHMENT'))
    returning id into v_id;
  end if;
  return v_id;
end
$$;

revoke all on function public.link_equipment_incident_document(uuid,uuid,text) from public,anon;
grant execute on function public.link_equipment_incident_document(uuid,uuid,text) to authenticated;

create or replace view public.equipment_incident_overview
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
  where x.equipment_id=i.equipment_id
    and x.status<>'CANCELLED'::public.production_status
    and (
      x.id=i.production_job_id
      or (
        x.planned_start is not null and x.planned_end is not null
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

-- Audit repair-enriched service rows as well. Existing legacy service writes remain
-- compatible; incident-specific writes use the protected RPC above.
drop trigger if exists trg_audit_equipment_service_log on public.equipment_service_log;
create trigger trg_audit_equipment_service_log
after insert or update or delete on public.equipment_service_log
for each row execute function public.audit_row_change();
