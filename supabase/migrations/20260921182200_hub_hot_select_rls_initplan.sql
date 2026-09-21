alter policy catalog_items_tenant_select on public.catalog_items
using (
  organization_id = (select public.current_user_organization_id())
  and (select public.is_hub_staff())
);

alter policy notifications_select_own on public.notifications
using (
  user_id = (select public.current_hub_user_id())
);

alter policy orders_partner_read on public.orders
using (
  partner_id = (select public.current_partner_id())
  or fulfillment_partner_id = (select public.current_partner_id())
);

alter policy orders_tenant_staff_select on public.orders
using (
  (
    organization_id = (select public.current_user_organization_id())
    or (organization_id is null and business_unit::text = 'COMMON')
  )
  and (
    (select public.has_role('ADMIN'))
    or (select public.has_role('MANAGER'))
    or (select public.has_role('WAREHOUSE'))
    or (select public.has_role('PRODUCTION'))
    or (select public.has_role('VIEWER'))
  )
);

alter policy order_items_partner_read on public.order_items
using (
  exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and (
        o.partner_id = (select public.current_partner_id())
        or o.fulfillment_partner_id = (select public.current_partner_id())
      )
  )
);

alter policy order_items_tenant_staff_select on public.order_items
using (
  (
    (select public.has_role('ADMIN'))
    or (select public.has_role('MANAGER'))
    or (select public.has_role('WAREHOUSE'))
    or (select public.has_role('PRODUCTION'))
    or (select public.has_role('VIEWER'))
  )
  and exists (
    select 1
    from public.orders o
    where o.id = order_items.order_id
      and (
        o.organization_id = (select public.current_user_organization_id())
        or (o.organization_id is null and o.business_unit::text = 'COMMON')
      )
  )
);

alter policy pos_sales_tenant_select on public.pos_sales
using (
  organization_id = (select public.current_user_organization_id())
  and (select public.has_role('ADMIN'))
);

alter policy pos_returns_tenant_select on public.pos_returns
using (
  organization_id = (select public.current_user_organization_id())
  and (select public.has_role('ADMIN'))
);

alter policy production_jobs_tenant_select on public.production_jobs
using (
  organization_id = (select public.current_user_organization_id())
  and (
    (select public.has_role('ADMIN'))
    or (select public.has_role('MANAGER'))
    or (select public.has_role('WAREHOUSE'))
    or (select public.has_role('PRODUCTION'))
    or (select public.has_role('VIEWER'))
  )
);

alter policy inventory_transactions_read on public.inventory_transactions
using (
  (select public.is_hub_staff())
);
