-- A4PRINT Cloud staging: HUB and KASSA catalog, SQL structure verified against Supabase.
-- Sensitive cost prices are kept server-side; NO catalog records are exposed in HTTP.
-- This is a protected snapshot only. Sales, POS, stock writes remain disabled.
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
create table if not exists public.catalog_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  sku text not null,
  name text not null,
  item_type text not null check(item_type = any(array['PRODUCT','MATERIAL','SERVICE','FINISHED_PRODUCT','MODEL_3D'])),
  category text,
  unit text not null default 'шт',
  description text,
  sale_price numeric not null default 0 check(sale_price >= 0),
  cost_price numeric not null default 0 check(cost_price >= 0),
  min_stock numeric not null default 0 check(min_stock >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  external_source text,
  external_id text,
  external_href text,
  article text,
  barcode text,
  external_updated_at timestamptz,
  last_synced_at timestamptz
);
alter table public.organizations enable row level security;
alter table public.catalog_items enable row level security;
revoke all on public.organizations from public, anonymous, authenticated;
revoke all on public.catalog_items from public, anonymous, authenticated;
grant select on public.organizations, public.catalog_items to a4print_cloud_probe;
create policy cloud_staging_server_read_organizations on public.organizations
 for select to a4print_cloud_probe using(true);
create policy cloud_staging_server_read_catalog_items on public.catalog_items
 for select to a4print_cloud_probe using(true);
comment on table public.catalog_items is 'Protected snapshot: includes business-sensitive cost prices. Do NOT expose as public Data API.';
