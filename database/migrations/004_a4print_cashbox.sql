-- A4PRINT HUB migration 004: internal A4-Print cashbox
-- IMPORTANT: run in Supabase SQL Editor after 003_rls_core.sql.
-- Financial data is ADMIN ONLY at database/RLS level.

create extension if not exists pgcrypto;

create table if not exists public.cash_accounts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  account_type text not null check (account_type in ('CASH','BANK','CARD','OTHER')),
  currency text not null default 'RUB',
  opening_balance numeric(14,2) not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, name)
);

create table if not exists public.cash_categories (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  direction text not null check (direction in ('INCOME','EXPENSE')),
  name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, direction, name)
);

create table if not exists public.cash_transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  cash_account_id uuid not null references public.cash_accounts(id) on delete restrict,
  category_id uuid references public.cash_categories(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  direction text not null check (direction in ('INCOME','EXPENSE')),
  amount numeric(14,2) not null check (amount > 0),
  payment_method text,
  description text not null,
  transaction_date date not null default current_date,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_cash_transactions_org_date on public.cash_transactions(organization_id, transaction_date desc);
create index if not exists idx_cash_transactions_account on public.cash_transactions(cash_account_id, transaction_date desc);
create index if not exists idx_cash_transactions_order on public.cash_transactions(order_id);

alter table public.cash_accounts enable row level security;
alter table public.cash_categories enable row level security;
alter table public.cash_transactions enable row level security;

-- No generic authenticated read policy: only ADMIN can see/write cashbox data.
create policy cash_accounts_admin_all on public.cash_accounts for all to authenticated
using (public.has_role('ADMIN')) with check (public.has_role('ADMIN'));
create policy cash_categories_admin_all on public.cash_categories for all to authenticated
using (public.has_role('ADMIN')) with check (public.has_role('ADMIN'));
create policy cash_transactions_admin_all on public.cash_transactions for all to authenticated
using (public.has_role('ADMIN')) with check (public.has_role('ADMIN'));

insert into public.cash_accounts (organization_id,name,account_type,currency)
select id,'Наличные','CASH','RUB' from public.organizations where code='A4PRINT'
on conflict (organization_id,name) do nothing;
insert into public.cash_accounts (organization_id,name,account_type,currency)
select id,'Расчётный счёт','BANK','RUB' from public.organizations where code='A4PRINT'
on conflict (organization_id,name) do nothing;

insert into public.cash_categories (organization_id,direction,name)
select id,'INCOME','Оплата заказа' from public.organizations where code='A4PRINT' on conflict do nothing;
insert into public.cash_categories (organization_id,direction,name)
select id,'INCOME','Прочий доход' from public.organizations where code='A4PRINT' on conflict do nothing;
insert into public.cash_categories (organization_id,direction,name)
select id,'EXPENSE','Материалы и закупки' from public.organizations where code='A4PRINT' on conflict do nothing;
insert into public.cash_categories (organization_id,direction,name)
select id,'EXPENSE','Аренда' from public.organizations where code='A4PRINT' on conflict do nothing;
insert into public.cash_categories (organization_id,direction,name)
select id,'EXPENSE','Зарплата' from public.organizations where code='A4PRINT' on conflict do nothing;
insert into public.cash_categories (organization_id,direction,name)
select id,'EXPENSE','Реклама' from public.organizations where code='A4PRINT' on conflict do nothing;
insert into public.cash_categories (organization_id,direction,name)
select id,'EXPENSE','Налоги и комиссии' from public.organizations where code='A4PRINT' on conflict do nothing;
insert into public.cash_categories (organization_id,direction,name)
select id,'EXPENSE','Прочий расход' from public.organizations where code='A4PRINT' on conflict do nothing;
