-- A4PRINT HUB migration 005: MoySklad catalog integration
-- Run after 004_a4print_cashbox.sql.
-- Stores only external IDs/metadata. NEVER store MoySklad access tokens in database tables exposed to browser clients.

alter table public.catalog_items add column if not exists external_source text;
alter table public.catalog_items add column if not exists external_id text;
alter table public.catalog_items add column if not exists external_href text;
alter table public.catalog_items add column if not exists article text;
alter table public.catalog_items add column if not exists barcode text;
alter table public.catalog_items add column if not exists external_updated_at timestamptz;
alter table public.catalog_items add column if not exists last_synced_at timestamptz;

create unique index if not exists uq_catalog_external_source_id
on public.catalog_items(external_source, external_id)
where external_source is not null and external_id is not null;

create table if not exists public.integration_sync_log (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  integration text not null,
  entity_type text not null,
  status text not null check (status in ('STARTED','SUCCESS','ERROR')),
  received_count integer not null default 0,
  created_count integer not null default 0,
  updated_count integer not null default 0,
  error_message text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_by uuid references public.users(id) on delete set null
);

alter table public.integration_sync_log enable row level security;
create policy integration_sync_log_admin_all on public.integration_sync_log for all to authenticated
using (public.has_role('ADMIN')) with check (public.has_role('ADMIN'));

-- Catalog is currently readable by authenticated staff because migration 003 grants that.
-- MoySklad integration control/log remains ADMIN-only.
