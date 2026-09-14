-- Production Farm Phase 6: equipment economics and obligations.
-- Read-only analytics are exposed as SECURITY INVOKER views so existing RLS remains authoritative.

create or replace view public.equipment_economics_daily
with (security_invoker = true)
as
with job_daily as (
  select
    j.equipment_id,
    j.completed_at::date as metric_date,
    count(*)::bigint as completed_jobs,
    coalesce(sum(j.actual_machine_minutes), 0)::numeric as machine_minutes,
    coalesce(sum(j.operation_amount), 0)::numeric as operation_revenue,
    coalesce(sum(c.machine_cost), 0)::numeric as machine_cost,
    coalesce(sum(c.electricity_cost), 0)::numeric as electricity_cost,
    coalesce(sum(c.material_cost), 0)::numeric as material_cost,
    coalesce(sum(c.total_production_cost), 0)::numeric as production_cost,
    coalesce(sum(c.waste_quantity), 0)::numeric as waste_quantity
  from public.production_jobs j
  left join public.production_job_cost_breakdown c on c.production_job_id = j.id
  where j.status = 'DONE'
    and j.equipment_id is not null
    and j.completed_at is not null
  group by j.equipment_id, j.completed_at::date
),
service_daily as (
  select
    s.equipment_id,
    s.serviced_at as metric_date,
    count(*)::bigint as service_events,
    count(*) filter (where s.service_type = 'REPAIR')::bigint as repair_events,
    coalesce(sum(s.cost), 0)::numeric as service_cost
  from public.equipment_service_log s
  where s.equipment_id is not null
  group by s.equipment_id, s.serviced_at
),
keys as (
  select equipment_id, metric_date from job_daily
  union
  select equipment_id, metric_date from service_daily
)
select
  k.metric_date,
  a.id as equipment_id,
  a.inventory_number,
  a.name as equipment_name,
  a.status as equipment_status,
  a.ownership_type,
  a.current_owner_partner_id,
  a.market_value,
  a.analogue_purchase_price,
  a.buy_replacement_warning_percent,
  coalesce(j.completed_jobs, 0)::bigint as completed_jobs,
  coalesce(j.machine_minutes, 0)::numeric as machine_minutes,
  coalesce(j.operation_revenue, 0)::numeric as operation_revenue,
  coalesce(j.machine_cost, 0)::numeric as machine_cost,
  coalesce(j.electricity_cost, 0)::numeric as electricity_cost,
  coalesce(j.material_cost, 0)::numeric as material_cost,
  coalesce(j.production_cost, 0)::numeric as production_cost,
  (coalesce(j.operation_revenue, 0) - coalesce(j.production_cost, 0))::numeric as production_margin,
  coalesce(j.waste_quantity, 0)::numeric as waste_quantity,
  coalesce(s.service_events, 0)::bigint as service_events,
  coalesce(s.repair_events, 0)::bigint as repair_events,
  coalesce(s.service_cost, 0)::numeric as service_cost,
  (coalesce(j.operation_revenue, 0) - coalesce(j.production_cost, 0) - coalesce(s.service_cost, 0))::numeric as net_margin_after_service
from keys k
join public.equipment_assets a on a.id = k.equipment_id
left join job_daily j on j.equipment_id = k.equipment_id and j.metric_date = k.metric_date
left join service_daily s on s.equipment_id = k.equipment_id and s.metric_date = k.metric_date;

comment on view public.equipment_economics_daily is
  'Daily equipment economics from completed production jobs and equipment service costs. SECURITY INVOKER preserves source-table RLS.';

revoke all on public.equipment_economics_daily from public, anon;
grant select on public.equipment_economics_daily to authenticated, service_role;

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
lease_assets as (
  select
    ca.equipment_id,
    sum(case when ch.status = 'APPROVED' then ch.amount else 0 end)::numeric as approved_lease_due,
    sum(case when ch.status = 'PAID' then ch.amount else 0 end)::numeric as paid_lease_amount
  from public.equipment_contract_assets ca
  join public.equipment_contracts c on c.id = ca.contract_id
  join public.equipment_lease_charges ch on ch.contract_id = c.id
  where c.contract_type in ('LEASE','LEASE_BUYOUT')
    and (ca.ends_on is null or ch.period_start <= ca.ends_on)
    and (ca.starts_on is null or ch.period_end >= ca.starts_on)
  group by ca.equipment_id
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
  'Current owner/lease payment obligations per equipment. Approved revenue-share settlements and approved unpaid lease charges are outstanding.';

revoke all on public.equipment_owner_obligations from public, anon;
grant select on public.equipment_owner_obligations to authenticated, service_role;
