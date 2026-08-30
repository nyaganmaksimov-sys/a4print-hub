-- A4PRINT HUB: security migration 003
-- Run after 002_business_core.sql.
-- Uses the existing public.has_role(text) helper.

alter table public.organizations enable row level security;
alter table public.organization_units enable row level security;
alter table public.catalog_items enable row level security;
alter table public.inventory_transactions enable row level security;
alter table public.payments enable row level security;

-- Authenticated employees can read core business data.
create policy organizations_read on public.organizations for select to authenticated using (true);
create policy organization_units_read on public.organization_units for select to authenticated using (true);
create policy catalog_items_read on public.catalog_items for select to authenticated using (true);
create policy inventory_transactions_read on public.inventory_transactions for select to authenticated using (true);
create policy payments_read on public.payments for select to authenticated using (true);

-- Only ADMIN/MANAGER may maintain organizations, catalog and payments.
create policy organizations_admin_manager_write on public.organizations for all to authenticated
using (public.has_role('ADMIN') or public.has_role('MANAGER'))
with check (public.has_role('ADMIN') or public.has_role('MANAGER'));

create policy organization_units_admin_manager_write on public.organization_units for all to authenticated
using (public.has_role('ADMIN') or public.has_role('MANAGER'))
with check (public.has_role('ADMIN') or public.has_role('MANAGER'));

create policy catalog_items_admin_manager_write on public.catalog_items for all to authenticated
using (public.has_role('ADMIN') or public.has_role('MANAGER'))
with check (public.has_role('ADMIN') or public.has_role('MANAGER'));

create policy payments_admin_manager_write on public.payments for all to authenticated
using (public.has_role('ADMIN') or public.has_role('MANAGER'))
with check (public.has_role('ADMIN') or public.has_role('MANAGER'));

-- Warehouse staff can create stock movements, but cannot delete them.
create policy inventory_insert_staff on public.inventory_transactions for insert to authenticated
with check (
  public.has_role('ADMIN') or public.has_role('MANAGER') or
  public.has_role('WAREHOUSE') or public.has_role('PRODUCTION')
);

-- Only ADMIN can update/delete inventory history.
create policy inventory_admin_update_delete on public.inventory_transactions for update to authenticated
using (public.has_role('ADMIN')) with check (public.has_role('ADMIN'));
create policy inventory_admin_delete on public.inventory_transactions for delete to authenticated
using (public.has_role('ADMIN'));
