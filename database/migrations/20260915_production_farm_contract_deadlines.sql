-- A4PRINT HUB: Production Farm Phase 20 — equipment contract expiry monitoring.
-- Does not auto-renew, auto-terminate or alter contracts. It only exposes state and emits reminders.

create table if not exists public.equipment_contract_deadline_events (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.equipment_contracts(id) on delete restrict,
  partner_id uuid not null references public.partners(id) on delete restrict,
  ends_on date not null,
  notice_kind text not null check(notice_kind in ('D30','D14','D7','D1','D0','EXPIRED')),
  emitted_at timestamptz not null default clock_timestamp(),
  unique(contract_id,ends_on,notice_kind)
);

create index if not exists equipment_contract_deadline_events_partner_idx
  on public.equipment_contract_deadline_events(partner_id,emitted_at desc);

alter table public.equipment_contract_deadline_events enable row level security;
drop policy if exists equipment_contract_deadline_events_staff_read on public.equipment_contract_deadline_events;
create policy equipment_contract_deadline_events_staff_read on public.equipment_contract_deadline_events
for select to authenticated
using(public.has_permission('equipment.view') or public.has_permission('equipment.contracts.manage'));

revoke all on public.equipment_contract_deadline_events from public,anon,authenticated;
grant select on public.equipment_contract_deadline_events to authenticated;

drop trigger if exists trg_audit_equipment_contract_deadline_events on public.equipment_contract_deadline_events;
create trigger trg_audit_equipment_contract_deadline_events
after insert or update or delete on public.equipment_contract_deadline_events
for each row execute function public.audit_row_change();

create or replace function public.get_my_equipment_contract_deadlines()
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_partner_id uuid;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  v_partner_id:=public.current_partner_id();
  if v_partner_id is null then raise exception 'PARTNER_ACCESS_REQUIRED'; end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.ends_on nulls last,x.contract_number),'[]'::jsonb)
    into v_result
  from (
    select
      c.id contract_id,
      c.contract_number,
      c.contract_type,
      c.status,
      c.starts_on,
      c.ends_on,
      c.early_termination_notice_days,
      case when c.ends_on is null then null else c.ends_on-current_date end days_left,
      case
        when c.status in ('TERMINATED','COMPLETED') then 'CLOSED'
        when c.ends_on is null then 'OPEN_ENDED'
        when c.ends_on<current_date then 'EXPIRED'
        when c.ends_on=current_date then 'ENDS_TODAY'
        when c.ends_on<=current_date+7 then 'ENDS_7'
        when c.ends_on<=current_date+14 then 'ENDS_14'
        when c.ends_on<=current_date+30 then 'ENDS_30'
        else 'ACTIVE'
      end deadline_state,
      (select count(*)::integer from public.equipment_contract_assets ca where ca.contract_id=c.id) equipment_count
    from public.equipment_contracts c
    where c.partner_id=v_partner_id
  ) x;

  return v_result;
end
$$;
revoke all on function public.get_my_equipment_contract_deadlines() from public,anon,authenticated;
grant execute on function public.get_my_equipment_contract_deadlines() to authenticated;

create or replace function public.list_equipment_contract_deadlines(p_include_closed boolean default false)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_result jsonb;
begin
  if not (public.has_permission('equipment.view') or public.has_permission('equipment.contracts.manage')) then
    raise exception 'PERMISSION_DENIED';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.ends_on nulls last,x.contract_number),'[]'::jsonb)
    into v_result
  from (
    select
      c.id contract_id,
      c.contract_number,
      c.contract_type,
      c.status,
      c.partner_id,
      coalesce(p.legal_name,p.name) partner_name,
      c.starts_on,
      c.ends_on,
      c.early_termination_notice_days,
      case when c.ends_on is null then null else c.ends_on-current_date end days_left,
      case
        when c.status in ('TERMINATED','COMPLETED') then 'CLOSED'
        when c.ends_on is null then 'OPEN_ENDED'
        when c.ends_on<current_date then 'EXPIRED'
        when c.ends_on=current_date then 'ENDS_TODAY'
        when c.ends_on<=current_date+7 then 'ENDS_7'
        when c.ends_on<=current_date+14 then 'ENDS_14'
        when c.ends_on<=current_date+30 then 'ENDS_30'
        else 'ACTIVE'
      end deadline_state,
      (select count(*)::integer from public.equipment_contract_assets ca where ca.contract_id=c.id) equipment_count
    from public.equipment_contracts c
    join public.partners p on p.id=c.partner_id
    where coalesce(p_include_closed,false) or c.status not in ('TERMINATED','COMPLETED')
  ) x;

  return v_result;
end
$$;
revoke all on function public.list_equipment_contract_deadlines(boolean) from public,anon,authenticated;
grant execute on function public.list_equipment_contract_deadlines(boolean) to authenticated;

create or replace function public.emit_equipment_contract_deadline_notifications()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  r record;
  v_kind text;
  v_event uuid;
  v_count integer:=0;
  v_title text;
  v_body text;
begin
  for r in
    select
      c.id contract_id,
      c.partner_id,
      c.contract_number,
      c.ends_on,
      coalesce(p.legal_name,p.name) partner_name,
      c.ends_on-current_date days_left
    from public.equipment_contracts c
    join public.partners p on p.id=c.partner_id
    where c.status in ('ACTIVE','SUSPENDED')
      and c.ends_on is not null
      and c.ends_on<=current_date+30
  loop
    v_kind:=case
      when r.days_left<0 then 'EXPIRED'
      when r.days_left=0 then 'D0'
      when r.days_left<=1 then 'D1'
      when r.days_left<=7 then 'D7'
      when r.days_left<=14 then 'D14'
      else 'D30'
    end;

    insert into public.equipment_contract_deadline_events(contract_id,partner_id,ends_on,notice_kind)
    values(r.contract_id,r.partner_id,r.ends_on,v_kind)
    on conflict(contract_id,ends_on,notice_kind) do nothing
    returning id into v_event;

    if v_event is null then continue; end if;
    v_count:=v_count+1;

    v_title:=case v_kind
      when 'EXPIRED' then 'Истёк срок договора оборудования'
      when 'D0' then 'Сегодня заканчивается договор оборудования'
      else 'Приближается окончание договора оборудования'
    end;
    v_body:=r.partner_name||' · договор '||r.contract_number||' · до '||to_char(r.ends_on,'DD.MM.YYYY')||
      case when r.days_left<0 then ' · просрочено на '||abs(r.days_left)||' дн.' else ' · осталось '||r.days_left||' дн.' end;

    insert into public.notifications(user_id,title,body,type,entity_type,entity_id)
    select distinct
      u.id,
      v_title,
      v_body,
      case when v_kind in ('EXPIRED','D0','D1') then 'WARNING' else 'INFO' end,
      'EQUIPMENT_CONTRACT_DEADLINE',
      v_event
    from public.users u
    join public.user_roles ur on ur.user_id=u.id
    join public.roles ro on ro.id=ur.role_id
    left join public.role_permissions rp on rp.role_id=ro.id
    left join public.permissions pp on pp.id=rp.permission_id
    where u.is_active=true
      and (ro.name='ADMIN' or pp.code='equipment.contracts.manage');
  end loop;

  return v_count;
end
$$;
revoke all on function public.emit_equipment_contract_deadline_notifications() from public,anon,authenticated;

select cron.schedule(
  'equipment-contract-deadlines-daily',
  '15 6 * * *',
  'select public.emit_equipment_contract_deadline_notifications();'
);
