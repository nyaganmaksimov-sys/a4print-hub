-- PHASE 2 CORE MULTI-COMPANY
-- Tenant keys for legacy POS cash tables and tenant-aware RLS for finance/POS data.

create schema if not exists private;

alter table public.pos_cash_operations
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;

create index if not exists idx_pos_cash_operations_organization_created
  on public.pos_cash_operations(organization_id,created_at desc);

update public.pos_cash_operations op
set organization_id = resolved.organization_id
from lateral (
  select ps.organization_id
  from public.pos_shift_sessions ps
  where ps.moysklad_shift_id=op.moysklad_shift_id
  order by ps.opened_at desc
  limit 1
) resolved
where op.organization_id is null
  and resolved.organization_id is not null;

create or replace function private.assign_pos_cash_operation_organization()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  if new.organization_id is null and new.moysklad_shift_id is not null then
    select ps.organization_id into new.organization_id
    from public.pos_shift_sessions ps
    where ps.moysklad_shift_id=new.moysklad_shift_id
    order by ps.opened_at desc
    limit 1;
  end if;
  return new;
end;
$$;

revoke all on function private.assign_pos_cash_operation_organization() from public,anon,authenticated;

drop trigger if exists trg_pos_cash_operations_assign_organization on public.pos_cash_operations;
create trigger trg_pos_cash_operations_assign_organization
before insert or update of moysklad_shift_id,organization_id
on public.pos_cash_operations
for each row
execute function private.assign_pos_cash_operation_organization();

alter table public.pos_cash_balance_state
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;

create index if not exists idx_pos_cash_balance_state_organization
  on public.pos_cash_balance_state(organization_id,updated_at desc);

update public.pos_cash_balance_state bs
set organization_id=resolved.organization_id
from lateral (
  select ps.organization_id
  from public.pos_shift_sessions ps
  where ps.store_id=bs.store_id
  order by ps.opened_at desc
  limit 1
) resolved
where bs.organization_id is null
  and resolved.organization_id is not null;

create or replace function private.assign_pos_cash_balance_organization()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
begin
  if new.organization_id is null and new.store_id is not null then
    select ps.organization_id into new.organization_id
    from public.pos_shift_sessions ps
    where ps.store_id=new.store_id
    order by ps.opened_at desc
    limit 1;
  end if;
  return new;
end;
$$;

revoke all on function private.assign_pos_cash_balance_organization() from public,anon,authenticated;

drop trigger if exists trg_pos_cash_balance_assign_organization on public.pos_cash_balance_state;
create trigger trg_pos_cash_balance_assign_organization
before insert or update of store_id,organization_id
on public.pos_cash_balance_state
for each row
execute function private.assign_pos_cash_balance_organization();

-- PAYMENTS
drop policy if exists payments_admin_manager_write on public.payments;
drop policy if exists payments_read on public.payments;

create policy payments_tenant_select on public.payments
for select to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.is_hub_staff()
);

create policy payments_tenant_insert on public.payments
for insert to authenticated
with check (
  organization_id=public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER'))
);

create policy payments_tenant_update on public.payments
for update to authenticated
using (
  organization_id=public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER'))
)
with check (
  organization_id=public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER'))
);

create policy payments_tenant_delete on public.payments
for delete to authenticated
using (
  organization_id=public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER'))
);

-- CATALOG
drop policy if exists catalog_items_admin_manager_write on public.catalog_items;
drop policy if exists catalog_items_read on public.catalog_items;

create policy catalog_items_tenant_select on public.catalog_items
for select to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.is_hub_staff()
);

create policy catalog_items_tenant_insert on public.catalog_items
for insert to authenticated
with check (
  organization_id=public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER'))
);

create policy catalog_items_tenant_update on public.catalog_items
for update to authenticated
using (
  organization_id=public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER'))
)
with check (
  organization_id=public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER'))
);

create policy catalog_items_tenant_delete on public.catalog_items
for delete to authenticated
using (
  organization_id=public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER'))
);

-- CASH ACCOUNTS
drop policy if exists cash_accounts_admin_all on public.cash_accounts;
drop policy if exists cash_accounts_pos_select on public.cash_accounts;

create policy cash_accounts_tenant_select on public.cash_accounts
for select to authenticated
using (
  organization_id=public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('POS_OPERATOR'))
);

create policy cash_accounts_tenant_insert on public.cash_accounts
for insert to authenticated
with check (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

create policy cash_accounts_tenant_update on public.cash_accounts
for update to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
)
with check (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

create policy cash_accounts_tenant_delete on public.cash_accounts
for delete to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

-- CASH CATEGORIES
drop policy if exists cash_categories_admin_all on public.cash_categories;

create policy cash_categories_tenant_select on public.cash_categories
for select to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

create policy cash_categories_tenant_insert on public.cash_categories
for insert to authenticated
with check (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

create policy cash_categories_tenant_update on public.cash_categories
for update to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
)
with check (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

create policy cash_categories_tenant_delete on public.cash_categories
for delete to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

-- CASH TRANSACTIONS
drop policy if exists cash_transactions_admin_all on public.cash_transactions;

create policy cash_transactions_tenant_select on public.cash_transactions
for select to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

create policy cash_transactions_tenant_insert on public.cash_transactions
for insert to authenticated
with check (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

create policy cash_transactions_tenant_update on public.cash_transactions
for update to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
)
with check (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

create policy cash_transactions_tenant_delete on public.cash_transactions
for delete to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

-- POS SALES
drop policy if exists pos_sales_admin_all on public.pos_sales;

create policy pos_sales_tenant_select on public.pos_sales
for select to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

create policy pos_sales_tenant_insert on public.pos_sales
for insert to authenticated
with check (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

create policy pos_sales_tenant_update on public.pos_sales
for update to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
)
with check (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

create policy pos_sales_tenant_delete on public.pos_sales
for delete to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

-- POS RETURNS
drop policy if exists pos_returns_admin_all on public.pos_returns;

create policy pos_returns_tenant_select on public.pos_returns
for select to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

create policy pos_returns_tenant_insert on public.pos_returns
for insert to authenticated
with check (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

create policy pos_returns_tenant_update on public.pos_returns
for update to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
)
with check (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

create policy pos_returns_tenant_delete on public.pos_returns
for delete to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

-- POS SHIFT SESSIONS
drop policy if exists pos_shift_sessions_admin_all on public.pos_shift_sessions;

create policy pos_shift_sessions_tenant_select on public.pos_shift_sessions
for select to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

create policy pos_shift_sessions_tenant_insert on public.pos_shift_sessions
for insert to authenticated
with check (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

create policy pos_shift_sessions_tenant_update on public.pos_shift_sessions
for update to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
)
with check (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);

create policy pos_shift_sessions_tenant_delete on public.pos_shift_sessions
for delete to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);
