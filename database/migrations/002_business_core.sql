-- A4PRINT HUB: business core migration 002
-- Run in Supabase SQL Editor after the existing schema.

create extension if not exists pgcrypto;

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  legal_name text,
  tax_id text,
  registration_number text,
  email text,
  phone text,
  address text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.organization_units (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (organization_id, code)
);

create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  sku text not null unique,
  name text not null,
  item_type text not null check (item_type in ('PRODUCT','MATERIAL','SERVICE','FINISHED_PRODUCT','MODEL_3D')),
  category text,
  unit text not null default 'шт',
  description text,
  sale_price numeric(14,2) not null default 0 check (sale_price >= 0),
  cost_price numeric(14,2) not null default 0 check (cost_price >= 0),
  min_stock numeric(14,3) not null default 0 check (min_stock >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.inventory_transactions (
  id uuid primary key default gen_random_uuid(),
  catalog_item_id uuid not null references public.catalog_items(id),
  warehouse_id uuid references public.warehouses(id) on delete set null,
  transaction_type text not null check (transaction_type in ('RECEIPT','SALE','WRITE_OFF','TRANSFER_IN','TRANSFER_OUT','PRODUCTION_IN','PRODUCTION_OUT','ADJUSTMENT')),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,2) not null default 0 check (unit_cost >= 0),
  reference_type text,
  reference_id uuid,
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists public.payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  order_id uuid references public.orders(id) on delete set null,
  payment_number text not null unique,
  payment_type text not null check (payment_type in ('INCOME','EXPENSE','REFUND')),
  status text not null default 'PENDING' check (status in ('PENDING','PAID','CANCELLED','REFUNDED')),
  amount numeric(14,2) not null check (amount > 0),
  currency text not null default 'EUR',
  payment_method text,
  paid_at timestamptz,
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_org_units_org on public.organization_units(organization_id);
create index if not exists idx_catalog_org on public.catalog_items(organization_id);
create index if not exists idx_catalog_type on public.catalog_items(item_type);
create index if not exists idx_inventory_item on public.inventory_transactions(catalog_item_id);
create index if not exists idx_inventory_warehouse on public.inventory_transactions(warehouse_id);
create index if not exists idx_payments_order on public.payments(order_id);
create index if not exists idx_payments_customer on public.payments(customer_id);
create index if not exists idx_payments_status on public.payments(status);

insert into public.organizations (name, code)
values ('А4-Принт', 'A4PRINT'), ('3D-ARTPRINT', '3DARTPRINT')
on conflict (code) do nothing;

create or replace view public.inventory_balances as
select
  it.catalog_item_id,
  it.warehouse_id,
  sum(case when it.transaction_type in ('RECEIPT','TRANSFER_IN','PRODUCTION_IN','ADJUSTMENT') then it.quantity else -it.quantity end) as quantity
from public.inventory_transactions it
group by it.catalog_item_id, it.warehouse_id;

create or replace view public.payment_totals as
select
  p.order_id,
  coalesce(sum(case when p.payment_type='INCOME' and p.status='PAID' then p.amount else 0 end),0) as paid_income,
  coalesce(sum(case when p.payment_type='REFUND' and p.status='PAID' then p.amount else 0 end),0) as refunded,
  coalesce(sum(case when p.payment_type='EXPENSE' and p.status='PAID' then p.amount else 0 end),0) as expenses
from public.payments p
group by p.order_id;
