-- Phase 6 hardening: do not multiply contract-level lease charges by equipment count.
-- A charge is allocated across equipment active for that charge period using allocation_weight.

create or replace view public.equipment_owner_obligations
with (security_invoker = true)
as
with settlement_lines as (
  select
    l.equipment_id,
    sum(case when s.status in ('APPROVED','PAID') then l.owner_amount else 0 end)::numeric as owner_accrued_amount,
    sum(case when s.status = 'PAID' then l.owner_amount else 0 end)::numeric as owner_paid_amount
  from public.equipment_owner_settlement_lines l
  join public.equipment_owner_settlements s on s.id = l.settlement_id
  group by l.equipment_id
),
charge_assets as (
  select
    ch.id as charge_id,
    ca.equipment_id,
    ch.status,
    ch.amount,
    greatest(coalesce(ca.allocation_weight, 1), 0)::numeric as weight,
    sum(greatest(coalesce(ca.allocation_weight, 1), 0)) over (partition by ch.id)::numeric as weight_total,
    count(*) over (partition by ch.id)::numeric as asset_count
  from public.equipment_lease_charges ch
  join public.equipment_contracts c on c.id = ch.contract_id
  join public.equipment_contract_assets ca on ca.contract_id = c.id
  where c.contract_type in ('LEASE','LEASE_BUYOUT')
    and (ca.ends_on is null or ch.period_start <= ca.ends_on)
    and (ca.starts_on is null or ch.period_end >= ca.starts_on)
),
lease_assets as (
  select
    equipment_id,
    sum(
      case when status = 'APPROVED' then amount *
        case when weight_total > 0 then weight / weight_total else 1 / nullif(asset_count, 0) end
      else 0 end
    )::numeric as approved_lease_due,
    sum(
      case when status = 'PAID' then amount *
        case when weight_total > 0 then weight / weight_total else 1 / nullif(asset_count, 0) end
      else 0 end
    )::numeric as paid_lease_amount
  from charge_assets
  group by equipment_id
)
select
  a.id as equipment_id,
  a.inventory_number,
  a.name as equipment_name,
  a.ownership_type,
  a.current_owner_partner_id,
  coalesce(sl.owner_accrued_amount, 0)::numeric as owner_accrued_amount,
  coalesce(sl.owner_paid_amount, 0)::numeric as owner_paid_amount,
  greatest(coalesce(sl.owner_accrued_amount, 0) - coalesce(sl.owner_paid_amount, 0), 0)::numeric as owner_outstanding_amount,
  coalesce(la.approved_lease_due, 0)::numeric as approved_lease_due,
  coalesce(la.paid_lease_amount, 0)::numeric as paid_lease_amount,
  (greatest(coalesce(sl.owner_accrued_amount, 0) - coalesce(sl.owner_paid_amount, 0), 0) + coalesce(la.approved_lease_due, 0))::numeric as total_outstanding_amount
from public.equipment_assets a
left join settlement_lines sl on sl.equipment_id = a.id
left join lease_assets la on la.equipment_id = a.id;

comment on view public.equipment_owner_obligations is
  'Current owner/lease obligations per equipment. Contract-level lease charges are allocated by active equipment allocation_weight to prevent multiplication across assets.';

revoke all on public.equipment_owner_obligations from public, anon;
grant select on public.equipment_owner_obligations to authenticated, service_role;
