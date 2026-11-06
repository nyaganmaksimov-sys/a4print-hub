-- A4PRINT CLOUD STAGING: first verified real-data schema slice (CUIM catalog taxonomy).
-- Copy source rows via a controlled tool execution, never commit customer/data dumps.
-- This migration does NOT touch Neon Auth, Supabase or production.
create table if not exists public.marketplace_city_sections (
  section_key text primary key,
  title text not null,
  subtitle text,
  icon_url text,
  icon_fallback text not null default '•',
  sort_order integer not null default 100,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  slug text not null
);
create table if not exists public.marketplace_city_subcategories (
  section_key text not null references public.marketplace_city_sections(section_key)
     on update cascade on delete cascade,
  subcategory_key text primary key,
  title text not null,
  keywords text[] not null default '{}'::text[],
  sort_order integer not null default 100,
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  slug text not null,
  icon_url text,
  icon_fallback text not null default '•'
);
alter table public.marketplace_city_sections enable row level security;
alter table public.marketplace_city_subcategories enable row level security;
-- No direct access from untrusted Neon Data API roles, even to inactive sections.
revoke all on public.marketplace_city_sections from public, anonymous, authenticated;
revoke all on public.marketplace_city_subcategories from public, anonymous, authenticated;
grant select on public.marketplace_city_sections, public.marketplace_city_subcategories to a4print_cloud_probe;
-- Read-only Render role gets the source catalog, but cannot modify it.
create policy cloud_staging_catalog_read_sections on public.marketplace_city_sections
 for select to a4print_cloud_probe using (true);
create policy cloud_staging_catalog_read_subcategories on public.marketplace_city_subcategories
 for select to a4print_cloud_probe using (true);
comment on table public.marketplace_city_sections is 'Cloud test copy of CUIM taxonomy. Protected; not yet served to buyers.';
comment on table public.marketplace_city_subcategories is 'Cloud test copy of CUIM taxonomy. Protected; not yet served to buyers.';
