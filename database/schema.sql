-- A4PRINT HUB
-- Unified database schema for A4-Принт and 3D-ARTPRINT.
-- PostgreSQL / Supabase compatible.

create extension if not exists pgcrypto;

-- =========================
-- ENUMS
-- =========================

do $$ begin
  create type business_unit as enum ('A4_PRINT', '3D_ARTPRINT', 'COMMON');
exception when duplicate_object then null; end $$;

do $$ begin
  create type order_status as enum ('NEW', 'CONFIRMED', 'IN_PROGRESS', 'READY', 'COMPLETED', 'ON_HOLD', 'CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type production_status as enum ('NEW', 'QUEUED', 'IN_PROGRESS', 'PAUSED', 'DONE', 'CANCELLED');
exception when duplicate_object then null; end $$;

do $$ begin
  create type stock_movement_type as enum ('RECEIPT', 'ISSUE', 'TRANSFER', 'ADJUSTMENT', 'RETURN');
exception when duplicate_object then null; end $$;

-- =========================
-- USERS / ACCESS
-- =========================

create table if not exists roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique,
  full_name text not null,
  email text unique,
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists user_roles (
  user_id uuid not null references users(id) on delete cascade,
  role_id uuid not null references roles(id) on delete cascade,
  primary key (user_id, role_id)
);

-- =========================
-- CUSTOMERS
-- =========================

create table if not exists customers (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  company_name text,
  email text,
  phone text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_customers_phone on customers(phone);
create index if not exists idx_customers_email on customers(email);

-- =========================
-- CATALOG / PRODUCTS / SERVICES
-- =========================

create table if not exists product_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  business_unit business_unit not null default 'COMMON',
  created_at timestamptz not null default now()
);

create table if not exists products (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references product_categories(id) on delete set null,
  sku text unique,
  name text not null,
  business_unit business_unit not null default 'COMMON',
  unit text not null default 'шт',
  purchase_price numeric(12,2) not null default 0 check (purchase_price >= 0),
  sale_price numeric(12,2) not null default 0 check (sale_price >= 0),
  min_stock numeric(12,3) not null default 0 check (min_stock >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists services (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  business_unit business_unit not null,
  description text,
  unit text not null default 'услуга',
  base_price numeric(12,2) not null default 0 check (base_price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(name, business_unit)
);

-- =========================
-- WAREHOUSES / STOCK
-- =========================

create table if not exists warehouses (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  address text,
  business_unit business_unit not null default 'COMMON',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists warehouse_locations (
  id uuid primary key default gen_random_uuid(),
  warehouse_id uuid not null references warehouses(id) on delete cascade,
  name text not null,
  unique(warehouse_id, name)
);

create table if not exists stock_balances (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id) on delete cascade,
  warehouse_id uuid not null references warehouses(id) on delete cascade,
  location_id uuid references warehouse_locations(id) on delete set null,
  quantity numeric(14,3) not null default 0,
  updated_at timestamptz not null default now(),
  unique(product_id, warehouse_id, location_id)
);

create table if not exists stock_movements (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references products(id),
  warehouse_id uuid not null references warehouses(id),
  location_id uuid references warehouse_locations(id),
  movement_type stock_movement_type not null,
  quantity numeric(14,3) not null check (quantity > 0),
  reason text,
  order_id uuid,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_stock_movements_product on stock_movements(product_id, created_at desc);

-- =========================
-- SUPPLIERS / PURCHASES
-- =========================

create table if not exists suppliers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  contact_name text,
  phone text,
  email text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists purchases (
  id uuid primary key default gen_random_uuid(),
  supplier_id uuid references suppliers(id) on delete set null,
  warehouse_id uuid references warehouses(id) on delete set null,
  invoice_number text,
  total numeric(12,2) not null default 0,
  notes text,
  created_by uuid references users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null references purchases(id) on delete cascade,
  product_id uuid not null references products(id),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_price numeric(12,2) not null default 0 check (unit_price >= 0)
);

-- =========================
-- 3D MODELS
-- =========================

create table if not exists models_3d (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  source_url text,
  source_name text,
  description text,
  recommended_material text,
  recommended_infill numeric(5,2),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =========================
-- ORDERS
-- =========================

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  order_number bigint generated always as identity unique,
  business_unit business_unit not null,
  customer_id uuid references customers(id) on delete set null,
  assigned_to uuid references users(id) on delete set null,
  status order_status not null default 'NEW',
  total numeric(12,2) not null default 0,
  customer_comment text,
  internal_comment text,
  source text,
  model_id uuid references models_3d(id) on delete set null,
  model_name text,
  model_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_orders_status on orders(status, created_at desc);
create index if not exists idx_orders_business on orders(business_unit, created_at desc);
create index if not exists idx_orders_customer on orders(customer_id, created_at desc);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  service_id uuid references services(id) on delete set null,
  name text not null,
  quantity numeric(14,3) not null default 1 check (quantity > 0),
  unit_price numeric(12,2) not null default 0,
  total_price numeric(12,2) not null default 0,
  parameters jsonb not null default '{}'::jsonb
);

create table if not exists order_status_history (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  old_status order_status,
  new_status order_status not null,
  changed_by uuid references users(id) on delete set null,
  comment text,
  created_at timestamptz not null default now()
);

create table if not exists order_files (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  file_name text not null,
  file_url text not null,
  mime_type text,
  created_at timestamptz not null default now()
);

-- =========================
-- PRODUCTION
-- =========================

create table if not exists production_jobs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete set null,
  assigned_to uuid references users(id) on delete set null,
  status production_status not null default 'NEW',
  title text not null,
  priority integer not null default 0,
  planned_start timestamptz,
  planned_end timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists production_job_items (
  id uuid primary key default gen_random_uuid(),
  production_job_id uuid not null references production_jobs(id) on delete cascade,
  product_id uuid references products(id) on delete set null,
  quantity numeric(14,3) not null check (quantity > 0),
  notes text
);

-- =========================
-- MESSAGING
-- =========================

create table if not exists chat_rooms (
  id uuid primary key default gen_random_uuid(),
  name text,
  is_group boolean not null default true,
  order_id uuid references orders(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists chat_members (
  room_id uuid not null references chat_rooms(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key(room_id, user_id)
);

create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references chat_rooms(id) on delete cascade,
  sender_id uuid references users(id) on delete set null,
  body text not null,
  created_at timestamptz not null default now(),
  edited_at timestamptz,
  deleted_at timestamptz
);

create index if not exists idx_messages_room on messages(room_id, created_at desc);

-- =========================
-- NOTIFICATIONS / AUDIT
-- =========================

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text not null,
  body text,
  type text not null,
  entity_type text,
  entity_id uuid,
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create table if not exists activity_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references users(id) on delete set null,
  action text not null,
  entity_type text,
  entity_id uuid,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- =========================
-- SETTINGS
-- =========================

create table if not exists settings (
  key text primary key,
  value jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

-- Basic default roles
insert into roles(name, description) values
  ('ADMIN', 'Полный доступ'),
  ('MANAGER', 'Заказы, клиенты и услуги'),
  ('WAREHOUSE', 'Склад и движение товаров'),
  ('PRODUCTION', 'Производственные задания'),
  ('VIEWER', 'Только просмотр')
on conflict (name) do nothing;
