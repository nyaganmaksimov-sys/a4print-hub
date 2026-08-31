-- A4PRINT HUB: customer billing details for invoices/contracts
-- Run after current core and partner migrations.

alter table public.customers add column if not exists customer_type text not null default 'PERSON'
  check (customer_type in ('PERSON','IP','LEGAL'));
alter table public.customers add column if not exists legal_name text;
alter table public.customers add column if not exists inn text;
alter table public.customers add column if not exists kpp text;
alter table public.customers add column if not exists ogrn text;
alter table public.customers add column if not exists legal_address text;
alter table public.customers add column if not exists actual_address text;
alter table public.customers add column if not exists bank_name text;
alter table public.customers add column if not exists bik text;
alter table public.customers add column if not exists settlement_account text;
alter table public.customers add column if not exists correspondent_account text;
alter table public.customers add column if not exists signatory_name text;
alter table public.customers add column if not exists signatory_title text;
alter table public.customers add column if not exists signatory_basis text;

create index if not exists idx_customers_inn on public.customers(inn);

-- Customer database is internal. Partners must not get access to customer records.
alter table public.customers enable row level security;

drop policy if exists customers_staff_select on public.customers;
create policy customers_staff_select on public.customers for select to authenticated
using (
  public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('POS_OPERATOR') or
  public.has_role('WAREHOUSE') or public.has_role('PRODUCTION') or public.has_role('VIEWER')
);

drop policy if exists customers_sales_insert on public.customers;
create policy customers_sales_insert on public.customers for insert to authenticated
with check (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('POS_OPERATOR'));

drop policy if exists customers_sales_update on public.customers;
create policy customers_sales_update on public.customers for update to authenticated
using (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('POS_OPERATOR'))
with check (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('POS_OPERATOR'));

drop policy if exists customers_admin_delete on public.customers;
create policy customers_admin_delete on public.customers for delete to authenticated
using (public.has_role('ADMIN'));
