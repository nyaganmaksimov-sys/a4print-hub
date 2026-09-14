-- Production Farm phase 4 hardening: accounting correctness, immutable workflow and audit.

alter table public.equipment_owner_settlements
  add column if not exists received_revenue numeric(14,2) not null default 0,
  add column if not exists owner_share_percent numeric(7,4) not null default 0,
  add column if not exists hub_share_percent numeric(7,4) not null default 0,
  add column if not exists direct_costs_before_split boolean not null default false;

update public.equipment_owner_settlements s
set owner_share_percent=c.owner_share_percent,
    hub_share_percent=c.hub_share_percent,
    direct_costs_before_split=c.direct_costs_before_split
from public.equipment_contracts c
where c.id=s.contract_id;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.equipment_owner_settlements'::regclass
      and conname='equipment_owner_settlements_owner_share_check'
  ) then
    alter table public.equipment_owner_settlements
      add constraint equipment_owner_settlements_owner_share_check
      check(owner_share_percent between 0 and 100);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.equipment_owner_settlements'::regclass
      and conname='equipment_owner_settlements_hub_share_check'
  ) then
    alter table public.equipment_owner_settlements
      add constraint equipment_owner_settlements_hub_share_check
      check(hub_share_percent between 0 and 100);
  end if;
end
$$;

-- Settlement mutations must go through the permission-checked RPC state machine.
revoke insert,update,delete on public.equipment_owner_settlements from authenticated;
revoke insert,update,delete on public.equipment_owner_settlement_lines from authenticated;
grant select on public.equipment_owner_settlements,public.equipment_owner_settlement_lines to authenticated;

drop policy if exists owner_settlements_manage on public.equipment_owner_settlements;
drop policy if exists owner_settlement_lines_manage on public.equipment_owner_settlement_lines;

-- Audit snapshots and status changes with the same audit mechanism as other farm entities.
drop trigger if exists trg_audit_equipment_owner_settlements on public.equipment_owner_settlements;
create trigger trg_audit_equipment_owner_settlements
after insert or update or delete on public.equipment_owner_settlements
for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_equipment_owner_settlement_lines on public.equipment_owner_settlement_lines;
create trigger trg_audit_equipment_owner_settlement_lines
after insert or update or delete on public.equipment_owner_settlement_lines
for each row execute function public.audit_row_change();

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
  if not public.has_permission('production.settlements.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start then
    raise exception 'INVALID_PERIOD';
  end if;

  select * into v_contract
  from public.equipment_contracts
  where id=p_contract_id
  for update;

  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if v_contract.contract_type<>'REVENUE_SHARE' then raise exception 'SETTLEMENT_CONTRACT_TYPE_UNSUPPORTED'; end if;
  if v_contract.status not in ('ACTIVE','COMPLETED') then raise exception 'CONTRACT_NOT_ACTIVE'; end if;
  if p_period_start < v_contract.starts_on
     or (v_contract.ends_on is not null and p_period_end > v_contract.ends_on) then
    raise exception 'PERIOD_OUTSIDE_CONTRACT';
  end if;

  if exists(
    select 1
    from public.equipment_owner_settlements s
    where s.contract_id=v_contract.id
      and s.status<>'CANCELLED'
      and daterange(s.period_start,s.period_end,'[]') && daterange(p_period_start,p_period_end,'[]')
      and not (s.period_start=p_period_start and s.period_end=p_period_end and s.status='DRAFT')
  ) then
    raise exception 'SETTLEMENT_PERIOD_OVERLAP';
  end if;

  v_actor:=public.current_staff_user_id();

  insert into public.equipment_owner_settlements(
    contract_id,partner_id,period_start,period_end,status,calculation_basis,
    owner_share_percent,hub_share_percent,direct_costs_before_split,
    currency,generated_by
  ) values (
    v_contract.id,v_contract.partner_id,p_period_start,p_period_end,'DRAFT',v_contract.calculation_basis,
    v_contract.owner_share_percent,v_contract.hub_share_percent,v_contract.direct_costs_before_split,
    v_contract.currency,v_actor
  )
  on conflict(contract_id,period_start,period_end) do update
    set partner_id=excluded.partner_id,
        calculation_basis=excluded.calculation_basis,
        owner_share_percent=excluded.owner_share_percent,
        hub_share_percent=excluded.hub_share_percent,
        direct_costs_before_split=excluded.direct_costs_before_split,
        currency=excluded.currency,
        generated_by=excluded.generated_by,
        generated_at=clock_timestamp()
    where public.equipment_owner_settlements.status='DRAFT'
  returning * into v_settlement;

  if v_settlement.id is null then raise exception 'SETTLEMENT_LOCKED'; end if;
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
    round(greatest(coalesce(j.operation_amount,0),0),2),
    round(
      case
        when j.order_id is null or greatest(coalesce(j.operation_amount,0),0)=0 then 0
        else least(
          greatest(coalesce(j.operation_amount,0),0),
          greatest(coalesce(pay.net_received,0),0)
            * greatest(coalesce(j.operation_amount,0),0)
            / greatest(coalesce(o.total,0),coalesce(op.order_operations,0),0.01)
        )
      end,
      2
    ),
    round(greatest(coalesce(j.production_cost,0),0),2),
    0,0,0
  from public.production_jobs j
  join public.equipment_contract_assets ca
    on ca.contract_id=v_contract.id and ca.equipment_id=j.equipment_id
  left join public.orders o on o.id=j.order_id
  left join lateral (
    select coalesce(sum(
      case
        when p.status='PAID' and p.payment_type='INCOME' then p.amount
        when p.status='PAID' and p.payment_type='REFUND' then -p.amount
        else 0
      end
    ),0) as net_received
    from public.payments p
    where p.order_id=j.order_id
  ) pay on true
  left join lateral (
    select coalesce(sum(greatest(coalesce(j2.operation_amount,0),0)),0) as order_operations
    from public.production_jobs j2
    where j2.order_id=j.order_id
      and j2.status<>'CANCELLED'
  ) op on true
  where j.status='DONE'
    and j.completed_at is not null
    and j.completed_at::date between p_period_start and p_period_end
    and (ca.starts_on is null or j.completed_at::date>=ca.starts_on)
    and (ca.ends_on is null or j.completed_at::date<=ca.ends_on)
    and j.completed_at::date>=v_contract.starts_on
    and (v_contract.ends_on is null or j.completed_at::date<=v_contract.ends_on)
    and not exists(
      select 1
      from public.equipment_owner_settlement_lines old_l
      join public.equipment_owner_settlements old_s on old_s.id=old_l.settlement_id
      where old_l.production_job_id=j.id
        and old_s.id<>v_settlement.id
        and old_s.status in ('APPROVED','PAID')
    );

  update public.equipment_owner_settlement_lines l
  set split_base=round(
    greatest(
      0,
      (case v_contract.calculation_basis
        when 'RECEIVED_REVENUE' then l.received_revenue
        when 'OPERATION_REVENUE' then l.operation_revenue
        when 'NET_AFTER_DIRECT_COSTS' then l.operation_revenue
        else l.operation_revenue
      end)
      - case
          when v_contract.calculation_basis='NET_AFTER_DIRECT_COSTS' or v_contract.direct_costs_before_split
          then l.direct_costs
          else 0
        end
    ),
    2
  )
  where l.settlement_id=v_settlement.id;

  update public.equipment_owner_settlement_lines l
  set owner_amount=round(l.split_base*v_contract.owner_share_percent/100.0,2),
      hub_amount=round(l.split_base-(l.split_base*v_contract.owner_share_percent/100.0),2)
  where l.settlement_id=v_settlement.id;

  update public.equipment_owner_settlements s
  set gross_revenue=x.gross_revenue,
      received_revenue=x.received_revenue,
      direct_costs=x.direct_costs,
      split_base=x.split_base,
      owner_amount=x.owner_amount,
      hub_amount=x.hub_amount,
      owner_share_percent=v_contract.owner_share_percent,
      hub_share_percent=v_contract.hub_share_percent,
      direct_costs_before_split=v_contract.direct_costs_before_split,
      generated_at=clock_timestamp()
  from (
    select
      coalesce(sum(operation_revenue),0)::numeric as gross_revenue,
      coalesce(sum(received_revenue),0)::numeric as received_revenue,
      coalesce(sum(direct_costs),0)::numeric as direct_costs,
      coalesce(sum(split_base),0)::numeric as split_base,
      coalesce(sum(owner_amount),0)::numeric as owner_amount,
      coalesce(sum(hub_amount),0)::numeric as hub_amount
    from public.equipment_owner_settlement_lines
    where settlement_id=v_settlement.id
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

  select * into v_row
  from public.equipment_owner_settlements
  where id=p_settlement_id
  for update;
  if v_row.id is null then raise exception 'SETTLEMENT_NOT_FOUND'; end if;

  if v_target='APPROVED' then
    if v_row.status<>'DRAFT' then raise exception 'INVALID_TRANSITION'; end if;
    if not exists(select 1 from public.equipment_owner_settlement_lines l where l.settlement_id=v_row.id) then
      raise exception 'SETTLEMENT_HAS_NO_JOBS';
    end if;
    if exists(
      select 1
      from public.equipment_owner_settlement_lines l
      join public.equipment_owner_settlement_lines other_l on other_l.production_job_id=l.production_job_id and other_l.settlement_id<>l.settlement_id
      join public.equipment_owner_settlements other_s on other_s.id=other_l.settlement_id
      where l.settlement_id=v_row.id and other_s.status in ('APPROVED','PAID')
    ) then
      raise exception 'PRODUCTION_JOB_ALREADY_SETTLED';
    end if;
  elsif v_target='PAID' then
    if v_row.status<>'APPROVED' then raise exception 'INVALID_TRANSITION'; end if;
    if v_row.owner_amount>0 and nullif(trim(coalesce(p_payment_reference,'')),'') is null then
      raise exception 'PAYMENT_REFERENCE_REQUIRED';
    end if;
  elsif v_target='CANCELLED' then
    if v_row.status='PAID' then raise exception 'INVALID_TRANSITION'; end if;
  end if;

  update public.equipment_owner_settlements
  set status=v_target,
      approved_by=case when v_target='APPROVED' then v_actor else approved_by end,
      approved_at=case when v_target='APPROVED' then clock_timestamp() else approved_at end,
      paid_by=case when v_target='PAID' then v_actor else paid_by end,
      paid_at=case when v_target='PAID' then clock_timestamp() else paid_at end,
      payment_reference=case when v_target='PAID' then nullif(trim(p_payment_reference),'') else payment_reference end,
      notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes)
  where id=p_settlement_id
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.set_equipment_owner_settlement_status(uuid,text,text,text) from public,anon;
grant execute on function public.set_equipment_owner_settlement_status(uuid,text,text,text) to authenticated;

create or replace view public.equipment_owner_settlement_overview
with (security_invoker=true)
as
select
  s.*,
  p.name as partner_name,
  c.contract_number,
  (select count(*) from public.equipment_owner_settlement_lines l where l.settlement_id=s.id) as jobs_count
from public.equipment_owner_settlements s
join public.partners p on p.id=s.partner_id
join public.equipment_contracts c on c.id=s.contract_id;

grant select on public.equipment_owner_settlement_overview to authenticated;
