-- A4PRINT HUB: Production Farm Phase 43 — temporal lease allocation and partner-scoped obligation views.

create or replace view public.equipment_lease_charge_allocations
with (security_invoker=true) as
with ctx as (
  select public.current_partner_id() as partner_id
),
period_overlap as (
  select
    ch.id as charge_id,
    ch.contract_id,
    c.organization_id,
    ch.partner_id,
    c.contract_number,
    ch.status,
    ch.currency,
    ch.period_start,
    ch.period_end,
    ch.amount,
    ch.buyout_credit_amount,
    ca.equipment_id,
    greatest(ch.period_start,ca.starts_on) as active_from,
    least(ch.period_end,coalesce(ca.ends_on,ch.period_end)) as active_to,
    greatest(coalesce(ca.allocation_weight,1),0)::numeric as allocation_weight
  from public.equipment_lease_charges ch
  join public.equipment_contracts c on c.id=ch.contract_id
  join public.equipment_contract_assets ca on ca.contract_id=c.id
  cross join ctx
  where ch.charge_type='LEASE'
    and c.contract_type in ('LEASE','LEASE_BUYOUT')
    and ca.starts_on<=ch.period_end
    and ch.period_start<=coalesce(ca.ends_on,'infinity'::date)
    and (ctx.partner_id is null or ch.partner_id=ctx.partner_id)
),
per_equipment as (
  select
    charge_id,
    contract_id,
    organization_id,
    partner_id,
    contract_number,
    status,
    currency,
    period_start,
    period_end,
    amount,
    buyout_credit_amount,
    equipment_id,
    min(active_from) as first_active_on,
    max(active_to) as last_active_on,
    sum((active_to-active_from+1)::integer)::integer as active_days,
    sum(((active_to-active_from+1)::numeric)*allocation_weight)::numeric as effective_weight,
    count(*)::integer as period_count
  from period_overlap
  where active_to>=active_from
  group by
    charge_id,contract_id,organization_id,partner_id,contract_number,
    status,currency,period_start,period_end,amount,buyout_credit_amount,equipment_id
),
weighted as (
  select
    p.*,
    sum(p.effective_weight) over(partition by p.charge_id) as total_effective_weight,
    count(*) over(partition by p.charge_id)::integer as asset_count
  from per_equipment p
)
select
  charge_id,
  contract_id,
  organization_id,
  partner_id,
  contract_number,
  status,
  currency,
  period_start,
  period_end,
  amount as charge_amount,
  buyout_credit_amount as charge_buyout_credit_amount,
  equipment_id,
  first_active_on,
  last_active_on,
  active_days,
  period_count,
  effective_weight,
  total_effective_weight,
  asset_count,
  case
    when total_effective_weight>0 then effective_weight/total_effective_weight
    else 1::numeric/nullif(asset_count,0)
  end as allocation_ratio,
  amount*(
    case
      when total_effective_weight>0 then effective_weight/total_effective_weight
      else 1::numeric/nullif(asset_count,0)
    end
  ) as allocated_amount,
  buyout_credit_amount*(
    case
      when total_effective_weight>0 then effective_weight/total_effective_weight
      else 1::numeric/nullif(asset_count,0)
    end
  ) as allocated_buyout_credit_amount
from weighted;

revoke all on public.equipment_lease_charge_allocations from public,anon;
grant select on public.equipment_lease_charge_allocations to authenticated;

create or replace view public.equipment_owner_obligations
with (security_invoker=true) as
with ctx as (
  select public.current_partner_id() as partner_id
),
settlement_lines as (
  select
    l.equipment_id,
    sum(case when s.status in ('APPROVED','PAID') then l.owner_amount else 0 end) as owner_accrued_amount,
    sum(case when s.status='PAID' then l.owner_amount else 0 end) as owner_paid_amount
  from public.equipment_owner_settlement_lines l
  join public.equipment_owner_settlements s on s.id=l.settlement_id
  cross join ctx
  where ctx.partner_id is null or s.partner_id=ctx.partner_id
  group by l.equipment_id
),
lease_assets as (
  select
    a.equipment_id,
    sum(case when a.status='APPROVED' then a.allocated_amount else 0 end) as approved_lease_due,
    sum(case when a.status='PAID' then a.allocated_amount else 0 end) as paid_lease_amount
  from public.equipment_lease_charge_allocations a
  group by a.equipment_id
)
select
  a.id as equipment_id,
  a.inventory_number,
  a.name as equipment_name,
  a.ownership_type,
  a.current_owner_partner_id,
  coalesce(sl.owner_accrued_amount,0::numeric) as owner_accrued_amount,
  coalesce(sl.owner_paid_amount,0::numeric) as owner_paid_amount,
  greatest(coalesce(sl.owner_accrued_amount,0::numeric)-coalesce(sl.owner_paid_amount,0::numeric),0::numeric) as owner_outstanding_amount,
  coalesce(la.approved_lease_due,0::numeric) as approved_lease_due,
  coalesce(la.paid_lease_amount,0::numeric) as paid_lease_amount,
  greatest(coalesce(sl.owner_accrued_amount,0::numeric)-coalesce(sl.owner_paid_amount,0::numeric),0::numeric)
    +coalesce(la.approved_lease_due,0::numeric) as total_outstanding_amount
from public.equipment_assets a
cross join ctx
left join settlement_lines sl on sl.equipment_id=a.id
left join lease_assets la on la.equipment_id=a.id
where ctx.partner_id is null
   or a.current_owner_partner_id=ctx.partner_id
   or exists(
     select 1
     from public.equipment_contract_assets ca
     join public.equipment_contracts c on c.id=ca.contract_id
     where ca.equipment_id=a.id
       and c.partner_id=ctx.partner_id
   );

select private.assert_production_farm_security_baseline();
