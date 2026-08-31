-- A4PRINT HUB: hard separation between external Partner Portal accounts and HUB employees.
-- Run immediately after 009_partner_portal.sql.

create or replace function public.is_hub_staff()
returns boolean
language sql
security definer
stable
set search_path=public
as $$
  select exists (
    select 1
    from public.users u
    join public.user_roles ur on ur.user_id=u.id
    where u.auth_user_id=auth.uid() and u.is_active=true
  );
$$;

grant execute on function public.is_hub_staff() to authenticated;

-- Fix staff directory policy without recursive access to public.users.
alter table public.users enable row level security;
drop policy if exists users_read_active_staff on public.users;
create policy users_read_active_staff on public.users
for select to authenticated
using (public.is_hub_staff());

-- Internal chat is HUB-only. Partner Portal users have auth accounts but no HUB role.
drop policy if exists chat_rooms_read_staff on public.chat_rooms;
create policy chat_rooms_read_staff on public.chat_rooms
for select to authenticated using (public.is_hub_staff());

drop policy if exists chat_members_read_staff on public.chat_members;
create policy chat_members_read_staff on public.chat_members
for select to authenticated using (public.is_hub_staff());

drop policy if exists messages_read_staff on public.messages;
create policy messages_read_staff on public.messages
for select to authenticated using (public.is_hub_staff());

drop policy if exists messages_insert_self on public.messages;
create policy messages_insert_self on public.messages
for insert to authenticated
with check (
  public.is_hub_staff()
  and sender_id=(select u.id from public.users u where u.auth_user_id=auth.uid() limit 1)
);

drop policy if exists messages_update_self on public.messages;
create policy messages_update_self on public.messages
for update to authenticated
using (public.is_hub_staff() and sender_id=(select u.id from public.users u where u.auth_user_id=auth.uid() limit 1))
with check (public.is_hub_staff() and sender_id=(select u.id from public.users u where u.auth_user_id=auth.uid() limit 1));

drop policy if exists messages_delete_self on public.messages;
create policy messages_delete_self on public.messages
for delete to authenticated
using (public.is_hub_staff() and sender_id=(select u.id from public.users u where u.auth_user_id=auth.uid() limit 1));

-- Existing migration 003 had broad `authenticated` read policies. Replace them so
-- external partner accounts cannot inspect internal inventory/finance tables.
drop policy if exists organizations_read on public.organizations;
create policy organizations_read on public.organizations for select to authenticated using (public.is_hub_staff());
drop policy if exists organization_units_read on public.organization_units;
create policy organization_units_read on public.organization_units for select to authenticated using (public.is_hub_staff());
drop policy if exists catalog_items_read on public.catalog_items;
create policy catalog_items_read on public.catalog_items for select to authenticated using (public.is_hub_staff());
drop policy if exists inventory_transactions_read on public.inventory_transactions;
create policy inventory_transactions_read on public.inventory_transactions for select to authenticated using (public.is_hub_staff());
drop policy if exists payments_read on public.payments;
create policy payments_read on public.payments for select to authenticated using (public.is_hub_staff());

-- Customer database must never be visible to external partners.
alter table public.customers enable row level security;
drop policy if exists customers_staff_read on public.customers;
create policy customers_staff_read on public.customers for select to authenticated using (public.is_hub_staff());
drop policy if exists customers_manager_write on public.customers;
create policy customers_manager_write on public.customers for all to authenticated
using (public.has_role('ADMIN') or public.has_role('MANAGER'))
with check (public.has_role('ADMIN') or public.has_role('MANAGER'));

-- Protect internal product/service/warehouse data. Partner Portal uses partner_services instead.
alter table public.products enable row level security;
alter table public.services enable row level security;
alter table public.warehouses enable row level security;
alter table public.warehouse_locations enable row level security;
alter table public.stock_balances enable row level security;
alter table public.stock_movements enable row level security;

drop policy if exists products_staff_read on public.products;
create policy products_staff_read on public.products for select to authenticated using (public.is_hub_staff());
drop policy if exists services_staff_read on public.services;
create policy services_staff_read on public.services for select to authenticated using (public.is_hub_staff());
drop policy if exists warehouses_staff_read on public.warehouses;
create policy warehouses_staff_read on public.warehouses for select to authenticated using (public.is_hub_staff());
drop policy if exists warehouse_locations_staff_read on public.warehouse_locations;
create policy warehouse_locations_staff_read on public.warehouse_locations for select to authenticated using (public.is_hub_staff());
drop policy if exists stock_balances_staff_read on public.stock_balances;
create policy stock_balances_staff_read on public.stock_balances for select to authenticated using (public.is_hub_staff());
drop policy if exists stock_movements_staff_read on public.stock_movements;
create policy stock_movements_staff_read on public.stock_movements for select to authenticated using (public.is_hub_staff());

-- Maintain existing staff write capability where these legacy tables are used.
drop policy if exists products_manager_write on public.products;
create policy products_manager_write on public.products for all to authenticated
using (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
with check (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'));
drop policy if exists services_manager_write on public.services;
create policy services_manager_write on public.services for all to authenticated
using (public.has_role('ADMIN') or public.has_role('MANAGER'))
with check (public.has_role('ADMIN') or public.has_role('MANAGER'));
drop policy if exists warehouses_manager_write on public.warehouses;
create policy warehouses_manager_write on public.warehouses for all to authenticated
using (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
with check (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'));
drop policy if exists warehouse_locations_manager_write on public.warehouse_locations;
create policy warehouse_locations_manager_write on public.warehouse_locations for all to authenticated
using (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
with check (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'));
drop policy if exists stock_balances_staff_write on public.stock_balances;
create policy stock_balances_staff_write on public.stock_balances for all to authenticated
using (public.has_role('ADMIN') or public.has_role('WAREHOUSE'))
with check (public.has_role('ADMIN') or public.has_role('WAREHOUSE'));
drop policy if exists stock_movements_staff_write on public.stock_movements;
create policy stock_movements_staff_write on public.stock_movements for all to authenticated
using (public.has_role('ADMIN') or public.has_role('WAREHOUSE') or public.has_role('PRODUCTION'))
with check (public.has_role('ADMIN') or public.has_role('WAREHOUSE') or public.has_role('PRODUCTION'));
