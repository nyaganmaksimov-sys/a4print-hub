-- Production Farm phase 4: owner settlements for revenue-share equipment contracts.

create table if not exists public.equipment_owner_settlements (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.equipment_contracts(id) on delete restrict,
  partner_id uuid not null references public.partners(id) on delete restrict,
  period_start date not null,
  period_end date not null,
  status text not null default 'DRAFT' check(status in ('DRAFT','APPROVED','PAID','CANCELLED')),
  calculation_basis text not null,
  gross_revenue numeric(14,2) not null default 0,
  direct_costs numeric(14,2) not null default 0,
  split_base numeric(14,2) not null default 0,
  owner_amount numeric(14,2) not null default 0,
  hub_amount numeric(14,2) not null default 0,
  currency text not null default 'RUB',
  generated_by uuid references public.users(id) on delete set null,
  approved_by uuid references public.users(id) on delete set null,
  paid_by uuid references public.users(id) on delete set null,
  generated_at timestamptz not null default now(),
  approved_at timestamptz,
  paid_at timestamptz,
  payment_reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(contract_id,period_start,period_end),
  check(period_end>=period_start)
);

create table if not exists public.equipment_owner_settlement_lines (
  id uuid primary key default gen_random_uuid(),
  settlement_id uuid not null references public.equipment_owner_settlements(id) on delete cascade,
  production_job_id uuid not null references public.production_jobs(id) on delete restrict,
  equipment_id uuid not null references public.equipment_assets(id) on delete restrict,
  order_id uuid references public.orders(id) on delete set null,
  completed_at timestamptz not null,
  operation_revenue numeric(14,2) not null default 0,
  received_revenue numeric(14,2) not null default 0,
  direct_costs numeric(14,2) not null default 0,
  split_base numeric(14,2) not null default 0,
  owner_amount numeric(14,2) not null default 0,
  hub_amount numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  unique(settlement_id,production_job_id)
);

create index if not exists equipment_owner_settlements_partner_idx on public.equipment_owner_settlements(partner_id,period_end desc);
create index if not exists equipment_owner_settlements_status_idx on public.equipment_owner_settlements(status,period_end desc);
create index if not exists equipment_owner_settlement_lines_job_idx on public.equipment_owner_settlement_lines(production_job_id);

alter table public.equipment_owner_settlements enable row level security;
alter table public.equipment_owner_settlement_lines enable row level security;

drop policy if exists owner_settlements_staff_read on public.equipment_owner_settlements;
create policy owner_settlements_staff_read on public.equipment_owner_settlements for select to authenticated
using(public.has_permission('production.settlements.view'));
drop policy if exists owner_settlements_partner_read on public.equipment_owner_settlements;
create policy owner_settlements_partner_read on public.equipment_owner_settlements for select to authenticated
using(partner_id=public.current_partner_id());
drop policy if exists owner_settlements_manage on public.equipment_owner_settlements;
create policy owner_settlements_manage on public.equipment_owner_settlements for all to authenticated
using(public.has_permission('production.settlements.manage'))
with check(public.has_permission('production.settlements.manage'));

drop policy if exists owner_settlement_lines_staff_read on public.equipment_owner_settlement_lines;
create policy owner_settlement_lines_staff_read on public.equipment_owner_settlement_lines for select to authenticated
using(exists(select 1 from public.equipment_owner_settlements s where s.id=settlement_id and public.has_permission('production.settlements.view')));
drop policy if exists owner_settlement_lines_partner_read on public.equipment_owner_settlement_lines;
create policy owner_settlement_lines_partner_read on public.equipment_owner_settlement_lines for select to authenticated
using(exists(select 1 from public.equipment_owner_settlements s where s.id=settlement_id and s.partner_id=public.current_partner_id()));
drop policy if exists owner_settlement_lines_manage on public.equipment_owner_settlement_lines;
create policy owner_settlement_lines_manage on public.equipment_owner_settlement_lines for all to authenticated
using(public.has_permission('production.settlements.manage'))
with check(public.has_permission('production.settlements.manage'));

grant select,insert,update,delete on public.equipment_owner_settlements,public.equipment_owner_settlement_lines to authenticated;

create or replace function public.touch_owner_settlement()
returns trigger language plpgsql set search_path=public as $$
begin new.updated_at=clock_timestamp(); return new; end $$;
revoke all on function public.touch_owner_settlement() from public,anon,authenticated;
drop trigger if exists owner_settlement_touch_trg on public.equipment_owner_settlements;
create trigger owner_settlement_touch_trg before update on public.equipment_owner_settlements for each row execute function public.touch_owner_settlement();

create or replace function public.generate_equipment_owner_settlement(
  p_contract_id uuid,
  p_period_start date,
  p_period_end date
) returns public.equipment_owner_settlements
language plpgsql
security definer
set search_path=public
as $$
declare
  v_contract public.equipment_contracts;
  v_settlement public.equipment_owner_settlements;
  v_actor uuid;
begin
  if not public.has_permission('production.settlements.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start then raise exception 'INVALID_PERIOD'; end if;

  select * into v_contract from public.equipment_contracts where id=p_contract_id for update;
  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if v_contract.contract_type<>'REVENUE_SHARE' then raise exception 'SETTLEMENT_CONTRACT_TYPE_UNSUPPORTED'; end if;
  if v_contract.status not in ('ACTIVE','COMPLETED') then raise exception 'CONTRACT_NOT_ACTIVE'; end if;
  v_actor:=public.current_staff_user_id();

  insert into public.equipment_owner_settlements(
    contract_id,partner_id,period_start,period_end,status,calculation_basis,currency,generated_by
  ) values (
    v_contract.id,v_contract.partner_id,p_period_start,p_period_end,'DRAFT',v_contract.calculation_basis,v_contract.currency,v_actor
  )
  on conflict(contract_id,period_start,period_end) do update
    set partner_id=excluded.partner_id,
        calculation_basis=excluded.calculation_basis,
        currency=excluded.currency,
        generated_by=excluded.generated_by,
        generated_at=clock_timestamp(),
        status=case when public.equipment_owner_settlements.status='DRAFT' then 'DRAFT' else public.equipment_owner_settlements.status end
  returning * into v_settlement;

  if v_settlement.status<>'DRAFT' then raise exception 'SETTLEMENT_LOCKED'; end if;
  delete from public.equipment_owner_settlement_lines where settlement_id=v_settlement.id;

  insert into public.equipment_owner_settlement_lines(
    settlement_id,production_job_id,equipment_id,order_id,completed_at,
    operation_revenue,received_revenue,direct_costs,split_base,owner_amount,hub_amount
  )
  select
    v_settlement.id,
    j.id,
    j.equipment_id,
    j.order_id,
    j.completed_at,
    round(coalesce(j.operation_amount,0),2),
    round(case
      when j.order_id is null then 0
      when coalesce(o.total,0)<=0 then 0
      else least(coalesce(j.operation_amount,0), coalesce(j.operation_amount,0) * least(1,coalesce(pay.paid_amount,0)/nullif(o.total,0)))
    end,2),
    round(coalesce(j.production_cost,0),2),
    0,0,0
  from public.production_jobs j
  join public.equipment_contract_assets ca on ca.contract_id=v_contract.id and ca.equipment_id=j.equipment_id
  left join public.orders o on o.id=j.order_id
  left join lateral (
    select coalesce(sum(p.amount),0) as paid_amount from public.payments p where p.order_id=j.order_id and p.status='PAID'
  ) pay on true
  where j.status='DONE'
    and j.completed_at is not null
    and j.completed_at::date between p_period_start and p_period_end
    and (ca.starts_on is null or j.completed_at::date>=ca.starts_on)
    and (ca.ends_on is null or j.completed_at::date<=ca.ends_on)
    and j.completed_at::date>=v_contract.starts_on
    and (v_contract.ends_on is null or j.completed_at::date<=v_contract.ends_on);

  update public.equipment_owner_settlement_lines l
  set split_base=round(greatest(0,
      case v_contract.calculation_basis
        when 'RECEIVED_REVENUE' then l.received_revenue
        when 'NET_AFTER_DIRECT_COSTS' then l.operation_revenue-l.direct_costs
        else case when v_contract.direct_costs_before_split then l.operation_revenue-l.direct_costs else l.operation_revenue end
      end
    ),2)
  where l.settlement_id=v_settlement.id;

  update public.equipment_owner_settlement_lines l
  set owner_amount=round(l.split_base*v_contract.owner_share_percent/100.0,2),
      hub_amount=round(l.split_base-(l.split_base*v_contract.owner_share_percent/100.0),2)
  where l.settlement_id=v_settlement.id;

  update public.equipment_owner_settlements s
  set gross_revenue=x.gross_revenue,
      direct_costs=x.direct_costs,
      split_base=x.split_base,
      owner_amount=x.owner_amount,
      hub_amount=x.hub_amount,
      generated_at=clock_timestamp()
  from (
    select coalesce(sum(operation_revenue),0)::numeric as gross_revenue,
           coalesce(sum(direct_costs),0)::numeric as direct_costs,
           coalesce(sum(split_base),0)::numeric as split_base,
           coalesce(sum(owner_amount),0)::numeric as owner_amount,
           coalesce(sum(hub_amount),0)::numeric as hub_amount
    from public.equipment_owner_settlement_lines where settlement_id=v_settlement.id
  ) x
  where s.id=v_settlement.id
  returning s.* into v_settlement;

  return v_settlement;
end;
$$;
revoke all on function public.generate_equipment_owner_settlement(uuid,date,date) from public,anon;
grant execute on function public.generate_equipment_owner_settlement(uuid,date,date) to authenticated;

create or replace function public.set_equipment_owner_settlement_status(
  p_settlement_id uuid,
  p_status text,
  p_payment_reference text default null,
  p_notes text default null
) returns public.equipment_owner_settlements
language plpgsql
security definer
set search_path=public
as $$
declare
  v_target text:=upper(trim(coalesce(p_status,'')));
  v_row public.equipment_owner_settlements;
  v_actor uuid;
begin
  if not public.has_permission('production.settlements.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if v_target not in ('APPROVED','PAID','CANCELLED') then raise exception 'INVALID_STATUS'; end if;
  v_actor:=public.current_staff_user_id();
  select * into v_row from public.equipment_owner_settlements where id=p_settlement_id for update;
  if v_row.id is null then raise exception 'SETTLEMENT_NOT_FOUND'; end if;

  if v_target='APPROVED' and v_row.status<>'DRAFT' then raise exception 'INVALID_TRANSITION'; end if;
  if v_target='PAID' and v_row.status<>'APPROVED' then raise exception 'INVALID_TRANSITION'; end if;
  if v_target='CANCELLED' and v_row.status='PAID' then raise exception 'INVALID_TRANSITION'; end if;

  update public.equipment_owner_settlements
  set status=v_target,
      approved_by=case when v_target='APPROVED' then v_actor else approved_by end,
      approved_at=case when v_target='APPROVED' then clock_timestamp() else approved_at end,
      paid_by=case when v_target='PAID' then v_actor else paid_by end,
      paid_at=case when v_target='PAID' then clock_timestamp() else paid_at end,
      payment_reference=case when v_target='PAID' then nullif(trim(p_payment_reference),'') else payment_reference end,
      notes=coalesce(nullif(trim(p_notes),''),notes)
  where id=p_settlement_id returning * into v_row;
  return v_row;
end;
$$;
revoke all on function public.set_equipment_owner_settlement_status(uuid,text,text,text) from public,anon;
grant execute on function public.set_equipment_owner_settlement_status(uuid,text,text,text) to authenticated;

create or replace view public.equipment_owner_settlement_overview
with (security_invoker=true)
as
select s.*,p.name as partner_name,c.contract_number,c.owner_share_percent,c.hub_share_percent,
       (select count(*) from public.equipment_owner_settlement_lines l where l.settlement_id=s.id) as jobs_count
from public.equipment_owner_settlements s
join public.partners p on p.id=s.partner_id
join public.equipment_contracts c on c.id=s.contract_id;
grant select on public.equipment_owner_settlement_overview to authenticated;
