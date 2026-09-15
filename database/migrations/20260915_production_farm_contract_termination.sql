-- A4PRINT HUB: Production Farm Phase 14
-- Controlled early termination, financial clearance and equipment return.

create table if not exists public.equipment_contract_terminations (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.equipment_contracts(id) on delete restrict,
  partner_id uuid not null references public.partners(id) on delete restrict,
  status text not null default 'NOTICE' check(status in ('NOTICE','PREPARING','READY','COMPLETED','CANCELLED')),
  initiated_by_party text not null check(initiated_by_party in ('HUB','OWNER','MUTUAL','OTHER')),
  notice_date date not null default current_date,
  requested_end_date date not null,
  effective_end_date date not null,
  notice_waived boolean not null default false,
  waiver_reason text,
  reason text not null,
  return_reference text,
  financial_clearance_reference text,
  final_notes text,
  created_by uuid references public.users(id) on delete set null,
  completed_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check(requested_end_date >= notice_date),
  check(effective_end_date >= notice_date),
  check(not notice_waived or nullif(btrim(coalesce(waiver_reason,'')),'') is not null)
);

create unique index if not exists equipment_contract_terminations_one_open_idx
  on public.equipment_contract_terminations(contract_id)
  where status in ('NOTICE','PREPARING','READY');
create index if not exists equipment_contract_terminations_partner_idx
  on public.equipment_contract_terminations(partner_id,status,created_at desc);
create index if not exists equipment_contract_terminations_created_by_idx
  on public.equipment_contract_terminations(created_by) where created_by is not null;
create index if not exists equipment_contract_terminations_completed_by_idx
  on public.equipment_contract_terminations(completed_by) where completed_by is not null;

alter table public.equipment_contract_terminations enable row level security;
drop policy if exists equipment_contract_terminations_staff_read on public.equipment_contract_terminations;
drop policy if exists equipment_contract_terminations_partner_read on public.equipment_contract_terminations;
drop policy if exists equipment_contract_terminations_read on public.equipment_contract_terminations;
create policy equipment_contract_terminations_read on public.equipment_contract_terminations
for select to authenticated
using(
  public.has_permission('equipment.view')
  or public.has_permission('equipment.contracts.manage')
  or partner_id=public.current_partner_id()
);

revoke all on public.equipment_contract_terminations from public,anon,authenticated;
grant select on public.equipment_contract_terminations to authenticated;

drop trigger if exists trg_equipment_contract_terminations_updated_at on public.equipment_contract_terminations;
create trigger trg_equipment_contract_terminations_updated_at
before update on public.equipment_contract_terminations
for each row execute function public.touch_production_farm_updated_at();

drop trigger if exists trg_audit_equipment_contract_terminations on public.equipment_contract_terminations;
create trigger trg_audit_equipment_contract_terminations
after insert or update or delete on public.equipment_contract_terminations
for each row execute function public.audit_row_change();

create or replace view public.equipment_contract_termination_overview
with (security_invoker=true) as
select
  t.id as termination_id,
  t.contract_id,
  c.contract_number,
  c.contract_type,
  c.status as contract_status,
  c.partner_id,
  coalesce(p.legal_name,p.name,'—') as partner_name,
  c.early_termination_notice_days,
  t.status,
  t.initiated_by_party,
  t.notice_date,
  t.requested_end_date,
  t.effective_end_date,
  t.notice_waived,
  t.waiver_reason,
  t.reason,
  t.return_reference,
  t.financial_clearance_reference,
  t.final_notes,
  t.created_by,
  t.completed_by,
  t.created_at,
  t.updated_at,
  t.completed_at,
  (select count(*)::integer
     from public.equipment_contract_assets ca
    where ca.contract_id=c.id) as equipment_count,
  (select count(*)::integer
     from public.production_jobs j
    where j.equipment_id in (
      select ca.equipment_id from public.equipment_contract_assets ca where ca.contract_id=c.id
    )
      and j.status in ('NEW','QUEUED','IN_PROGRESS','PAUSED')) as open_jobs_count,
  (select count(*)::integer
     from public.equipment_incidents i
    where i.equipment_id in (
      select ca.equipment_id from public.equipment_contract_assets ca where ca.contract_id=c.id
    )
      and i.status in ('OPEN','DIAGNOSING','WAITING_PARTS','REPAIRING')) as open_incidents_count,
  (select count(*)::integer
     from public.equipment_owner_settlements s
    where s.contract_id=c.id and s.status in ('DRAFT','APPROVED')) as open_settlements_count,
  (select count(*)::integer
     from public.equipment_lease_charges lc
    where lc.contract_id=c.id and lc.status in ('DRAFT','APPROVED')) as open_lease_charges_count,
  case when c.contract_type='REVENUE_SHARE' then (
    select count(*)::integer
      from public.production_jobs j
      join public.equipment_contract_assets ca
        on ca.contract_id=c.id and ca.equipment_id=j.equipment_id
     where j.status='DONE'
       and j.completed_at is not null
       and j.completed_at::date >= greatest(c.starts_on,coalesce(ca.starts_on,c.starts_on))
       and j.completed_at::date <= least(t.effective_end_date,coalesce(ca.ends_on,t.effective_end_date))
       and not exists(
         select 1
           from public.equipment_owner_settlement_lines sl
           join public.equipment_owner_settlements s on s.id=sl.settlement_id
          where sl.production_job_id=j.id
            and s.contract_id=c.id
            and s.status='PAID'
       )
  ) else 0 end as unsettled_jobs_count
from public.equipment_contract_terminations t
join public.equipment_contracts c on c.id=t.contract_id
join public.partners p on p.id=c.partner_id;

revoke all on public.equipment_contract_termination_overview from public,anon,authenticated;
grant select on public.equipment_contract_termination_overview to authenticated;

create or replace function public.notify_equipment_contract_termination(p_termination_id uuid,p_event text)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_contract_number text;
  v_event text:=upper(btrim(coalesce(p_event,'')));
  v_title text;
  v_body text;
begin
  select c.contract_number into v_contract_number
    from public.equipment_contract_terminations t
    join public.equipment_contracts c on c.id=t.contract_id
   where t.id=p_termination_id;
  if v_contract_number is null then return; end if;

  if v_event='STARTED' then
    v_title:='Расторжение договора';
    v_body:='Запущена процедура расторжения договора '||v_contract_number;
  elsif v_event='COMPLETED' then
    v_title:='Договор расторгнут';
    v_body:='Договор '||v_contract_number||' закрыт, оборудование выведено из производственного контура';
  elsif v_event='CANCELLED' then
    v_title:='Расторжение отменено';
    v_body:='Процедура расторжения договора '||v_contract_number||' отменена';
  else
    return;
  end if;

  insert into public.notifications(user_id,title,body,type,entity_type,entity_id)
  select distinct u.id,v_title,v_body,'INFO','EQUIPMENT_CONTRACT_TERMINATION',p_termination_id
    from public.users u
    join public.user_roles ur on ur.user_id=u.id
    join public.roles r on r.id=ur.role_id
    left join public.role_permissions rp on rp.role_id=r.id
    left join public.permissions pp on pp.id=rp.permission_id
   where u.is_active=true
     and (r.name='ADMIN' or pp.code='equipment.contracts.manage');
end
$$;
revoke all on function public.notify_equipment_contract_termination(uuid,text) from public,anon,authenticated;

create or replace function public.start_equipment_contract_termination(
  p_contract_id uuid,
  p_requested_end_date date,
  p_initiated_by_party text,
  p_reason text,
  p_notice_waived boolean default false,
  p_waiver_reason text default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_contract public.equipment_contracts%rowtype;
  v_id uuid;
  v_party text:=upper(btrim(coalesce(p_initiated_by_party,'')));
  v_earliest date;
begin
  if not public.has_permission('equipment.contracts.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_contract_id is null then raise exception 'CONTRACT_REQUIRED'; end if;
  if p_requested_end_date is null then raise exception 'END_DATE_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'TERMINATION_REASON_REQUIRED'; end if;
  if v_party not in ('HUB','OWNER','MUTUAL','OTHER') then raise exception 'INVALID_INITIATOR'; end if;

  select * into v_contract
    from public.equipment_contracts
   where id=p_contract_id
   for update;
  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if v_contract.status not in ('ACTIVE','SUSPENDED') then raise exception 'CONTRACT_NOT_TERMINABLE'; end if;
  if exists(
    select 1 from public.equipment_contract_terminations
     where contract_id=p_contract_id and status in ('NOTICE','PREPARING','READY')
  ) then raise exception 'ACTIVE_TERMINATION_EXISTS'; end if;
  if p_requested_end_date<current_date then raise exception 'END_DATE_IN_PAST'; end if;

  v_earliest:=current_date+coalesce(v_contract.early_termination_notice_days,0);
  if p_requested_end_date<v_earliest and not coalesce(p_notice_waived,false) then
    raise exception 'NOTICE_PERIOD_REQUIRED:%',v_earliest;
  end if;
  if coalesce(p_notice_waived,false) and nullif(btrim(coalesce(p_waiver_reason,'')),'') is null then
    raise exception 'WAIVER_REASON_REQUIRED';
  end if;

  insert into public.equipment_contract_terminations(
    contract_id,partner_id,status,initiated_by_party,notice_date,requested_end_date,effective_end_date,
    notice_waived,waiver_reason,reason,created_by
  ) values(
    v_contract.id,v_contract.partner_id,'NOTICE',v_party,current_date,p_requested_end_date,p_requested_end_date,
    coalesce(p_notice_waived,false),nullif(btrim(coalesce(p_waiver_reason,'')),''),btrim(p_reason),public.current_staff_user_id()
  ) returning id into v_id;

  perform public.notify_equipment_contract_termination(v_id,'STARTED');
  return v_id;
end
$$;
revoke all on function public.start_equipment_contract_termination(uuid,date,text,text,boolean,text) from public,anon,authenticated;
grant execute on function public.start_equipment_contract_termination(uuid,date,text,text,boolean,text) to authenticated;

create or replace function public.set_equipment_contract_termination_status(
  p_termination_id uuid,
  p_status text,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_old text;
  v_new text:=upper(btrim(coalesce(p_status,'')));
begin
  if not public.has_permission('equipment.contracts.manage') then raise exception 'PERMISSION_DENIED'; end if;
  select status into v_old
    from public.equipment_contract_terminations
   where id=p_termination_id
   for update;
  if v_old is null then raise exception 'TERMINATION_NOT_FOUND'; end if;
  if v_old in ('COMPLETED','CANCELLED') then raise exception 'TERMINATION_FINAL'; end if;
  if v_new not in ('NOTICE','PREPARING','READY','CANCELLED') then raise exception 'INVALID_TERMINATION_STATUS'; end if;
  if v_new='NOTICE' and v_old<>'NOTICE' then raise exception 'INVALID_TERMINATION_TRANSITION'; end if;

  update public.equipment_contract_terminations
     set status=v_new,
         final_notes=case
           when nullif(btrim(coalesce(p_note,'')),'') is null then final_notes
           when final_notes is null then btrim(p_note)
           else final_notes||E'\n'||btrim(p_note)
         end
   where id=p_termination_id;

  if v_new='CANCELLED' then perform public.notify_equipment_contract_termination(p_termination_id,'CANCELLED'); end if;
  return p_termination_id;
end
$$;
revoke all on function public.set_equipment_contract_termination_status(uuid,text,text) from public,anon,authenticated;
grant execute on function public.set_equipment_contract_termination_status(uuid,text,text) to authenticated;

create or replace function public.guard_equipment_contract_termination_status()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_t public.equipment_contract_terminations%rowtype;
  v_count integer;
begin
  if old.status='TERMINATED' and new.status is distinct from old.status then
    raise exception 'TERMINATED_CONTRACT_IMMUTABLE';
  end if;
  if new.status<>'TERMINATED' or old.status='TERMINATED' then return new; end if;

  select * into v_t
    from public.equipment_contract_terminations
   where contract_id=new.id
     and status='READY'
     and effective_end_date=new.ends_on
     and nullif(btrim(coalesce(return_reference,'')),'') is not null
     and nullif(btrim(coalesce(financial_clearance_reference,'')),'') is not null
   order by created_at desc limit 1;
  if v_t.id is null then raise exception 'USE_CONTRACT_TERMINATION_WORKFLOW'; end if;
  if current_date<v_t.effective_end_date then raise exception 'TERMINATION_DATE_NOT_REACHED'; end if;

  select count(*) into v_count
    from public.production_jobs j
   where j.equipment_id in (
     select ca.equipment_id from public.equipment_contract_assets ca where ca.contract_id=new.id
   )
     and j.status in ('NEW','QUEUED','IN_PROGRESS','PAUSED');
  if v_count>0 then raise exception 'CONTRACT_TERMINATION_OPEN_JOBS:%',v_count; end if;

  select count(*) into v_count
    from public.equipment_incidents i
   where i.equipment_id in (
     select ca.equipment_id from public.equipment_contract_assets ca where ca.contract_id=new.id
   )
     and i.status in ('OPEN','DIAGNOSING','WAITING_PARTS','REPAIRING');
  if v_count>0 then raise exception 'CONTRACT_TERMINATION_OPEN_INCIDENTS:%',v_count; end if;

  select count(*) into v_count
    from public.equipment_owner_settlements s
   where s.contract_id=new.id and s.status in ('DRAFT','APPROVED');
  if v_count>0 then raise exception 'CONTRACT_TERMINATION_OPEN_SETTLEMENTS:%',v_count; end if;

  select count(*) into v_count
    from public.equipment_lease_charges lc
   where lc.contract_id=new.id and lc.status in ('DRAFT','APPROVED');
  if v_count>0 then raise exception 'CONTRACT_TERMINATION_OPEN_LEASE_CHARGES:%',v_count; end if;

  if new.contract_type='REVENUE_SHARE' then
    select count(*) into v_count
      from public.production_jobs j
      join public.equipment_contract_assets ca
        on ca.contract_id=new.id and ca.equipment_id=j.equipment_id
     where j.status='DONE'
       and j.completed_at is not null
       and j.completed_at::date >= greatest(new.starts_on,coalesce(ca.starts_on,new.starts_on))
       and j.completed_at::date <= least(v_t.effective_end_date,coalesce(ca.ends_on,v_t.effective_end_date))
       and not exists(
         select 1
           from public.equipment_owner_settlement_lines sl
           join public.equipment_owner_settlements s
             on s.id=sl.settlement_id and s.contract_id=new.id and s.status='PAID'
          where sl.production_job_id=j.id
       );
    if v_count>0 then raise exception 'CONTRACT_TERMINATION_UNSETTLED_JOBS:%',v_count; end if;
  end if;

  return new;
end
$$;
revoke all on function public.guard_equipment_contract_termination_status() from public,anon,authenticated;

drop trigger if exists trg_guard_equipment_contract_termination on public.equipment_contracts;
create trigger trg_guard_equipment_contract_termination
before update of status on public.equipment_contracts
for each row execute function public.guard_equipment_contract_termination_status();

create or replace function public.guard_closed_equipment_contract_asset()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_contract_id uuid:=case when tg_op='DELETE' then old.contract_id else new.contract_id end;
  v_status text;
begin
  select status into v_status from public.equipment_contracts where id=v_contract_id;
  if v_status in ('TERMINATED','COMPLETED') then raise exception 'CLOSED_CONTRACT_ASSET_IMMUTABLE'; end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$$;
revoke all on function public.guard_closed_equipment_contract_asset() from public,anon,authenticated;

drop trigger if exists trg_guard_closed_equipment_contract_asset on public.equipment_contract_assets;
create trigger trg_guard_closed_equipment_contract_asset
before insert or update or delete on public.equipment_contract_assets
for each row execute function public.guard_closed_equipment_contract_asset();

create or replace function public.finalize_equipment_contract_termination(
  p_termination_id uuid,
  p_return_reference text,
  p_financial_clearance_reference text,
  p_document_id uuid default null,
  p_final_notes text default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_t public.equipment_contract_terminations%rowtype;
  v_contract public.equipment_contracts%rowtype;
  v_actor uuid:=public.current_staff_user_id();
begin
  if not public.has_permission('equipment.contracts.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if nullif(btrim(coalesce(p_return_reference,'')),'') is null then raise exception 'RETURN_REFERENCE_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_financial_clearance_reference,'')),'') is null then raise exception 'FINANCIAL_CLEARANCE_REQUIRED'; end if;

  select * into v_t
    from public.equipment_contract_terminations
   where id=p_termination_id
   for update;
  if v_t.id is null then raise exception 'TERMINATION_NOT_FOUND'; end if;
  if v_t.status in ('COMPLETED','CANCELLED') then raise exception 'TERMINATION_FINAL'; end if;
  if current_date<v_t.effective_end_date then raise exception 'TERMINATION_DATE_NOT_REACHED'; end if;

  select * into v_contract
    from public.equipment_contracts
   where id=v_t.contract_id
   for update;
  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if v_contract.status not in ('ACTIVE','SUSPENDED') then raise exception 'CONTRACT_NOT_TERMINABLE'; end if;

  if p_document_id is not null
     and not exists(select 1 from public.documents where id=p_document_id)
  then raise exception 'DOCUMENT_NOT_FOUND'; end if;

  update public.equipment_contract_terminations
     set status='READY',
         return_reference=btrim(p_return_reference),
         financial_clearance_reference=btrim(p_financial_clearance_reference),
         final_notes=nullif(btrim(coalesce(p_final_notes,'')),'')
   where id=v_t.id;

  update public.equipment_contract_assets
     set ends_on=v_t.effective_end_date
   where contract_id=v_contract.id
     and (ends_on is null or ends_on>v_t.effective_end_date);

  update public.equipment_assets a
     set operational_status='OFFLINE',updated_at=clock_timestamp()
   where a.id in (
     select ca.equipment_id from public.equipment_contract_assets ca where ca.contract_id=v_contract.id
   )
     and a.current_owner_partner_id=v_contract.partner_id
     and a.ownership_type in ('PARTNER','LEASE','LEASE_BUYOUT')
     and not exists(
       select 1
         from public.equipment_contract_assets ca2
         join public.equipment_contracts c2 on c2.id=ca2.contract_id
        where ca2.equipment_id=a.id
          and c2.id<>v_contract.id
          and c2.status='ACTIVE'
          and coalesce(ca2.starts_on,c2.starts_on)<=v_t.effective_end_date
          and (ca2.ends_on is null or ca2.ends_on>=v_t.effective_end_date)
     );

  update public.equipment_contracts
     set status='TERMINATED',ends_on=v_t.effective_end_date,updated_at=clock_timestamp()
   where id=v_contract.id;

  if p_document_id is not null then
    insert into public.document_links(document_id,entity_type,entity_id,relationship)
    select p_document_id,'EQUIPMENT_CONTRACT_TERMINATION',v_t.id,'RETURN_ACT'
     where not exists(
       select 1 from public.document_links dl
        where dl.document_id=p_document_id
          and dl.entity_type='EQUIPMENT_CONTRACT_TERMINATION'
          and dl.entity_id=v_t.id
          and dl.relationship='RETURN_ACT'
     );
  end if;

  update public.equipment_contract_terminations
     set status='COMPLETED',completed_by=v_actor,completed_at=clock_timestamp()
   where id=v_t.id;

  perform public.notify_equipment_contract_termination(v_t.id,'COMPLETED');
  return v_t.id;
end
$$;
revoke all on function public.finalize_equipment_contract_termination(uuid,text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.finalize_equipment_contract_termination(uuid,text,text,uuid,text) to authenticated;
