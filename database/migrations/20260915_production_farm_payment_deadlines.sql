-- A4PRINT HUB: Production Farm Phase 18 — payment deadlines and overdue control.

alter table public.equipment_owner_settlements
  add column if not exists payment_due_date date,
  add column if not exists deadline_source text;

alter table public.equipment_lease_charges
  add column if not exists payment_due_date date,
  add column if not exists deadline_source text;

do $$ begin
  alter table public.equipment_owner_settlements
    add constraint equipment_owner_settlements_deadline_source_check
    check (deadline_source is null or deadline_source in ('CONTRACT_DAY','MANUAL'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table public.equipment_lease_charges
    add constraint equipment_lease_charges_deadline_source_check
    check (deadline_source is null or deadline_source in ('CONTRACT_DAY','MANUAL'));
exception when duplicate_object then null; end $$;

create index if not exists equipment_owner_settlements_due_idx
  on public.equipment_owner_settlements(payment_due_date,status)
  where payment_due_date is not null and status<>'PAID';
create index if not exists equipment_lease_charges_due_idx
  on public.equipment_lease_charges(payment_due_date,status)
  where payment_due_date is not null and status<>'PAID';

create or replace function public.equipment_payment_default_due_date(p_contract_id uuid,p_period_end date)
returns date
language plpgsql
security definer
stable
set search_path=''
as $$
declare
  v_day integer;
  v_month date;
  v_last_day integer;
  v_candidate date;
begin
  if p_contract_id is null or p_period_end is null then return null; end if;
  select c.settlement_day into v_day from public.equipment_contracts c where c.id=p_contract_id;
  if v_day is null then return null; end if;
  v_month:=date_trunc('month',p_period_end)::date;
  v_last_day:=extract(day from (v_month+interval '1 month - 1 day'))::integer;
  v_candidate:=make_date(extract(year from v_month)::integer,extract(month from v_month)::integer,least(v_day,v_last_day));
  if v_candidate<=p_period_end then
    v_month:=(v_month+interval '1 month')::date;
    v_last_day:=extract(day from (v_month+interval '1 month - 1 day'))::integer;
    v_candidate:=make_date(extract(year from v_month)::integer,extract(month from v_month)::integer,least(v_day,v_last_day));
  end if;
  return v_candidate;
end
$$;
revoke all on function public.equipment_payment_default_due_date(uuid,date) from public,anon,authenticated;

create or replace function public.default_equipment_payment_deadline()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if new.payment_due_date is null then
    new.payment_due_date:=public.equipment_payment_default_due_date(new.contract_id,new.period_end);
    if new.payment_due_date is not null then new.deadline_source:='CONTRACT_DAY'; end if;
  end if;
  if new.payment_due_date is not null and new.payment_due_date<new.period_end then raise exception 'PAYMENT_DUE_BEFORE_PERIOD_END'; end if;
  return new;
end
$$;
revoke all on function public.default_equipment_payment_deadline() from public,anon,authenticated;

drop trigger if exists trg_owner_settlement_default_deadline on public.equipment_owner_settlements;
create trigger trg_owner_settlement_default_deadline before insert on public.equipment_owner_settlements
for each row execute function public.default_equipment_payment_deadline();
drop trigger if exists trg_lease_charge_default_deadline on public.equipment_lease_charges;
create trigger trg_lease_charge_default_deadline before insert on public.equipment_lease_charges
for each row execute function public.default_equipment_payment_deadline();

create table if not exists public.equipment_payment_deadline_events (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check(entity_type in ('OWNER_SETTLEMENT','LEASE_CHARGE')),
  entity_id uuid not null,
  partner_id uuid not null references public.partners(id) on delete restrict,
  due_date date not null,
  notice_kind text not null check(notice_kind in ('DUE_SOON','DUE_TODAY','OVERDUE')),
  emitted_at timestamptz not null default clock_timestamp(),
  unique(entity_type,entity_id,due_date,notice_kind)
);
create index if not exists equipment_payment_deadline_events_partner_idx
  on public.equipment_payment_deadline_events(partner_id,emitted_at desc);

alter table public.equipment_payment_deadline_events enable row level security;
drop policy if exists equipment_payment_deadline_events_staff_read on public.equipment_payment_deadline_events;
create policy equipment_payment_deadline_events_staff_read on public.equipment_payment_deadline_events
for select to authenticated
using(public.has_permission('production.settlements.view') or public.has_permission('production.settlements.manage') or public.has_permission('equipment.contracts.manage'));
revoke all on public.equipment_payment_deadline_events from public,anon,authenticated;
grant select on public.equipment_payment_deadline_events to authenticated;

drop trigger if exists trg_audit_equipment_payment_deadline_events on public.equipment_payment_deadline_events;
create trigger trg_audit_equipment_payment_deadline_events
after insert or update or delete on public.equipment_payment_deadline_events
for each row execute function public.audit_row_change();

create or replace function public.set_equipment_payment_due_date(p_entity_type text,p_entity_id uuid,p_due_date date)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_type text:=upper(btrim(coalesce(p_entity_type,'')));
  v_period_end date;
  v_status text;
begin
  if not (public.has_permission('production.settlements.manage') or public.has_permission('equipment.contracts.manage')) then raise exception 'PERMISSION_DENIED'; end if;
  if v_type not in ('OWNER_SETTLEMENT','LEASE_CHARGE') then raise exception 'INVALID_ENTITY_TYPE'; end if;
  if p_entity_id is null then raise exception 'ENTITY_REQUIRED'; end if;
  if p_due_date is null then raise exception 'DUE_DATE_REQUIRED'; end if;
  if v_type='OWNER_SETTLEMENT' then
    select period_end,status into v_period_end,v_status from public.equipment_owner_settlements where id=p_entity_id for update;
    if v_period_end is null then raise exception 'ENTITY_NOT_FOUND'; end if;
    if v_status='PAID' then raise exception 'PAYMENT_ALREADY_PAID'; end if;
    if p_due_date<v_period_end then raise exception 'PAYMENT_DUE_BEFORE_PERIOD_END'; end if;
    update public.equipment_owner_settlements set payment_due_date=p_due_date,deadline_source='MANUAL' where id=p_entity_id;
  else
    select period_end,status into v_period_end,v_status from public.equipment_lease_charges where id=p_entity_id for update;
    if v_period_end is null then raise exception 'ENTITY_NOT_FOUND'; end if;
    if v_status='PAID' then raise exception 'PAYMENT_ALREADY_PAID'; end if;
    if p_due_date<v_period_end then raise exception 'PAYMENT_DUE_BEFORE_PERIOD_END'; end if;
    update public.equipment_lease_charges set payment_due_date=p_due_date,deadline_source='MANUAL' where id=p_entity_id;
  end if;
  return p_entity_id;
end
$$;
revoke all on function public.set_equipment_payment_due_date(text,uuid,date) from public,anon,authenticated;
grant execute on function public.set_equipment_payment_due_date(text,uuid,date) to authenticated;

create or replace function public.list_equipment_payment_obligations(p_include_paid boolean default false)
returns jsonb
language plpgsql
security definer
stable
set search_path=''
as $$
declare v_result jsonb;
begin
  if not (public.has_permission('production.settlements.view') or public.has_permission('production.settlements.manage') or public.has_permission('equipment.contracts.manage')) then raise exception 'PERMISSION_DENIED'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.payment_due_date nulls last,x.period_end desc),'[]'::jsonb) into v_result
  from (
    select 'OWNER_SETTLEMENT'::text entity_type,s.id entity_id,s.partner_id,coalesce(p.legal_name,p.name) partner_name,s.contract_id,c.contract_number,s.period_start,s.period_end,s.owner_amount amount,s.currency,s.status,s.payment_due_date,s.deadline_source,
      case when s.status='PAID' then 'PAID' when s.payment_due_date is null then 'NO_DUE_DATE' when s.payment_due_date<current_date then 'OVERDUE' when s.payment_due_date=current_date then 'DUE_TODAY' when s.payment_due_date<=current_date+3 then 'DUE_SOON' else 'UPCOMING' end due_state,
      case when s.status<>'PAID' and s.payment_due_date<current_date then current_date-s.payment_due_date else 0 end days_overdue,s.paid_at,s.payment_reference
    from public.equipment_owner_settlements s join public.equipment_contracts c on c.id=s.contract_id join public.partners p on p.id=s.partner_id
    where coalesce(p_include_paid,false) or s.status<>'PAID'
    union all
    select 'LEASE_CHARGE'::text,l.id,l.partner_id,coalesce(p.legal_name,p.name),l.contract_id,c.contract_number,l.period_start,l.period_end,l.amount,l.currency,l.status,l.payment_due_date,l.deadline_source,
      case when l.status='PAID' then 'PAID' when l.payment_due_date is null then 'NO_DUE_DATE' when l.payment_due_date<current_date then 'OVERDUE' when l.payment_due_date=current_date then 'DUE_TODAY' when l.payment_due_date<=current_date+3 then 'DUE_SOON' else 'UPCOMING' end due_state,
      case when l.status<>'PAID' and l.payment_due_date<current_date then current_date-l.payment_due_date else 0 end days_overdue,l.paid_at,l.payment_reference
    from public.equipment_lease_charges l join public.equipment_contracts c on c.id=l.contract_id join public.partners p on p.id=l.partner_id
    where coalesce(p_include_paid,false) or l.status<>'PAID'
  ) x;
  return v_result;
end
$$;
revoke all on function public.list_equipment_payment_obligations(boolean) from public,anon,authenticated;
grant execute on function public.list_equipment_payment_obligations(boolean) to authenticated;

create or replace function public.get_my_equipment_payment_obligations()
returns jsonb
language plpgsql
security definer
stable
set search_path=''
as $$
declare v_partner_id uuid; v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  v_partner_id:=public.current_partner_id();
  if v_partner_id is null then raise exception 'PARTNER_ACCESS_REQUIRED'; end if;
  select coalesce(jsonb_agg(to_jsonb(x) order by x.payment_due_date nulls last,x.period_end desc),'[]'::jsonb) into v_result
  from (
    select 'OWNER_SETTLEMENT'::text entity_type,s.id entity_id,c.contract_number,s.period_start,s.period_end,s.owner_amount amount,s.currency,s.status,s.payment_due_date,
      case when s.status='PAID' then 'PAID' when s.payment_due_date is null then 'NO_DUE_DATE' when s.payment_due_date<current_date then 'OVERDUE' when s.payment_due_date=current_date then 'DUE_TODAY' when s.payment_due_date<=current_date+3 then 'DUE_SOON' else 'UPCOMING' end due_state,
      case when s.status<>'PAID' and s.payment_due_date<current_date then current_date-s.payment_due_date else 0 end days_overdue,s.paid_at,s.payment_reference
    from public.equipment_owner_settlements s join public.equipment_contracts c on c.id=s.contract_id
    where s.partner_id=v_partner_id and c.partner_id=v_partner_id and s.status in ('APPROVED','PAID')
    union all
    select 'LEASE_CHARGE'::text,l.id entity_id,c.contract_number,l.period_start,l.period_end,l.amount,l.currency,l.status,l.payment_due_date,
      case when l.status='PAID' then 'PAID' when l.payment_due_date is null then 'NO_DUE_DATE' when l.payment_due_date<current_date then 'OVERDUE' when l.payment_due_date=current_date then 'DUE_TODAY' when l.payment_due_date<=current_date+3 then 'DUE_SOON' else 'UPCOMING' end due_state,
      case when l.status<>'PAID' and l.payment_due_date<current_date then current_date-l.payment_due_date else 0 end days_overdue,l.paid_at,l.payment_reference
    from public.equipment_lease_charges l join public.equipment_contracts c on c.id=l.contract_id
    where l.partner_id=v_partner_id and c.partner_id=v_partner_id and l.status in ('APPROVED','PAID')
  ) x;
  return v_result;
end
$$;
revoke all on function public.get_my_equipment_payment_obligations() from public,anon,authenticated;
grant execute on function public.get_my_equipment_payment_obligations() to authenticated;

create or replace function public.emit_equipment_payment_deadline_notifications()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  r record;
  v_kind text;
  v_event_id uuid;
  v_count integer:=0;
  v_title text;
  v_body text;
begin
  for r in
    select * from (
      select 'OWNER_SETTLEMENT'::text entity_type,s.id entity_id,s.partner_id,coalesce(p.legal_name,p.name) partner_name,c.contract_number,s.payment_due_date,s.owner_amount amount,s.currency
      from public.equipment_owner_settlements s join public.equipment_contracts c on c.id=s.contract_id join public.partners p on p.id=s.partner_id
      where s.status='APPROVED' and s.payment_due_date is not null and s.payment_due_date<=current_date+3
      union all
      select 'LEASE_CHARGE'::text,l.id,l.partner_id,coalesce(p.legal_name,p.name),c.contract_number,l.payment_due_date,l.amount,l.currency
      from public.equipment_lease_charges l join public.equipment_contracts c on c.id=l.contract_id join public.partners p on p.id=l.partner_id
      where l.status='APPROVED' and l.payment_due_date is not null and l.payment_due_date<=current_date+3
    ) q
  loop
    v_kind:=case when r.payment_due_date<current_date then 'OVERDUE' when r.payment_due_date=current_date then 'DUE_TODAY' else 'DUE_SOON' end;
    insert into public.equipment_payment_deadline_events(entity_type,entity_id,partner_id,due_date,notice_kind)
    values(r.entity_type,r.entity_id,r.partner_id,r.payment_due_date,v_kind)
    on conflict(entity_type,entity_id,due_date,notice_kind) do nothing
    returning id into v_event_id;
    if v_event_id is null then continue; end if;
    v_count:=v_count+1;
    v_title:=case v_kind when 'OVERDUE' then 'Просрочена выплата владельцу' when 'DUE_TODAY' then 'Сегодня срок выплаты владельцу' else 'Приближается срок выплаты владельцу' end;
    v_body:=r.partner_name||' · договор '||r.contract_number||' · срок '||to_char(r.payment_due_date,'DD.MM.YYYY')||' · '||trim(to_char(r.amount,'FM9999999990D00'))||' '||r.currency;
    insert into public.notifications(user_id,title,body,type,entity_type,entity_id)
    select distinct u.id,v_title,v_body,case when v_kind='OVERDUE' then 'WARNING' else 'INFO' end,'EQUIPMENT_PAYMENT_DEADLINE',v_event_id
    from public.users u join public.user_roles ur on ur.user_id=u.id join public.roles ro on ro.id=ur.role_id
    left join public.role_permissions rp on rp.role_id=ro.id left join public.permissions pp on pp.id=rp.permission_id
    where u.is_active=true and (ro.name='ADMIN' or pp.code in ('production.settlements.manage','equipment.contracts.manage'));
  end loop;
  return v_count;
end
$$;
revoke all on function public.emit_equipment_payment_deadline_notifications() from public,anon,authenticated;

select cron.schedule('equipment-payment-deadlines-daily','0 6 * * *','select public.emit_equipment_payment_deadline_notifications();');
