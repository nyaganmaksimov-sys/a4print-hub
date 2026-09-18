-- PHASE 2 CORE MULTI-COMPANY
-- Add tenant keys to legacy orders/customers without changing existing access rules yet.

create schema if not exists private;

alter table public.orders
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;

alter table public.customers
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;

create index if not exists idx_orders_organization_id
  on public.orders(organization_id);

create index if not exists idx_customers_organization_id
  on public.customers(organization_id);

-- Existing order.business_unit is the canonical legacy source for company ownership.
update public.orders ord
set organization_id = org.id
from public.organizations org
where ord.organization_id is null
  and (
    (ord.business_unit::text = 'A4_PRINT' and org.code = 'A4PRINT')
    or
    (ord.business_unit::text = '3D_ARTPRINT' and org.code = '3DARTPRINT')
  );

-- Backfill a customer only when all company-specific linked orders resolve to one organization.
with resolved_customer_org as (
  select
    o.customer_id,
    (array_agg(distinct o.organization_id) filter (where o.organization_id is not null))[1] as organization_id
  from public.orders o
  where o.customer_id is not null
  group by o.customer_id
  having count(distinct o.organization_id) filter (where o.organization_id is not null) = 1
)
update public.customers c
set organization_id = r.organization_id
from resolved_customer_org r
where c.id = r.customer_id
  and c.organization_id is null
  and r.organization_id is not null;

-- Keep future A4_PRINT / 3D_ARTPRINT orders tenant-aware even before all callers are upgraded.
create or replace function private.assign_order_organization()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if new.organization_id is not null then
    return new;
  end if;

  if new.business_unit::text = 'A4_PRINT' then
    select id into new.organization_id
    from public.organizations
    where code = 'A4PRINT'
    limit 1;
  elsif new.business_unit::text = '3D_ARTPRINT' then
    select id into new.organization_id
    from public.organizations
    where code = '3DARTPRINT'
    limit 1;
  end if;

  return new;
end;
$$;

revoke all on function private.assign_order_organization() from public, anon, authenticated;

drop trigger if exists trg_orders_assign_organization on public.orders;
create trigger trg_orders_assign_organization
before insert or update of business_unit, organization_id
on public.orders
for each row
execute function private.assign_order_organization();

comment on column public.orders.organization_id is
  'Tenant organization. Backfilled from legacy business_unit for company-specific orders.';

comment on column public.customers.organization_id is
  'Tenant organization when ownership is unambiguous; nullable during phased multi-company migration.';
