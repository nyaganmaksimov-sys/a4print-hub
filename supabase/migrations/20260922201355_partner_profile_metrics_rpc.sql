create or replace function public.get_partner_profile_metrics(p_partner_id uuid)
returns table(
  orders_from_partner bigint,
  orders_to_partner bigint,
  turnover_from_partner numeric,
  turnover_to_partner numeric,
  crm_orders_count bigint,
  crm_sales numeric,
  crm_prepaid numeric,
  crm_receivable numeric,
  crm_customers_count bigint,
  supplier_services_count bigint,
  active_supplier_services bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with hub as (
    select
      count(*) filter (where o.partner_id=p_partner_id)::bigint as orders_from_partner,
      count(*) filter (where o.fulfillment_partner_id=p_partner_id)::bigint as orders_to_partner,
      coalesce(sum(o.total) filter (where o.partner_id=p_partner_id),0)::numeric as turnover_from_partner,
      coalesce(sum(o.total) filter (where o.fulfillment_partner_id=p_partner_id),0)::numeric as turnover_to_partner
    from public.orders o
    where o.partner_id=p_partner_id or o.fulfillment_partner_id=p_partner_id
  ),
  crm as (
    select
      count(*)::bigint as crm_orders_count,
      coalesce(sum(o.sale_total),0)::numeric as crm_sales,
      coalesce(sum(o.prepaid),0)::numeric as crm_prepaid,
      coalesce(sum(greatest(coalesce(o.sale_total,0)-coalesce(o.prepaid,0),0)),0)::numeric as crm_receivable
    from public.partner_crm_orders o
    where o.partner_id=p_partner_id
  ),
  customers as (
    select count(*)::bigint as crm_customers_count
    from public.partner_crm_customers c
    where c.partner_id=p_partner_id
  ),
  services as (
    select
      count(*)::bigint as supplier_services_count,
      count(*) filter (where s.is_active)::bigint as active_supplier_services
    from public.partner_supplier_services s
    where s.partner_id=p_partner_id
  )
  select
    h.orders_from_partner,h.orders_to_partner,h.turnover_from_partner,h.turnover_to_partner,
    c.crm_orders_count,c.crm_sales,c.crm_prepaid,c.crm_receivable,
    cu.crm_customers_count,s.supplier_services_count,s.active_supplier_services
  from hub h cross join crm c cross join customers cu cross join services s;
$$;

revoke execute on function public.get_partner_profile_metrics(uuid) from public;
revoke execute on function public.get_partner_profile_metrics(uuid) from anon;
revoke execute on function public.get_partner_profile_metrics(uuid) from authenticated;
grant execute on function public.get_partner_profile_metrics(uuid) to service_role;
