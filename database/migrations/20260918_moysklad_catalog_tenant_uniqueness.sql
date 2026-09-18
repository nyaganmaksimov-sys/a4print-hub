-- PHASE 2 / MOYSKLAD MULTI-COMPANY
-- Catalog identifiers are unique inside an organization, not globally.

alter table public.catalog_items
  drop constraint if exists catalog_items_sku_key;

drop index if exists public.uq_catalog_external_source_id;

create unique index if not exists uq_catalog_org_sku
  on public.catalog_items(organization_id, sku)
  where organization_id is not null;

create unique index if not exists uq_catalog_unscoped_sku
  on public.catalog_items(sku)
  where organization_id is null;

create unique index if not exists uq_catalog_org_external_source_id
  on public.catalog_items(organization_id, external_source, external_id)
  where organization_id is not null
    and external_source is not null
    and external_id is not null;

create unique index if not exists uq_catalog_unscoped_external_source_id
  on public.catalog_items(external_source, external_id)
  where organization_id is null
    and external_source is not null
    and external_id is not null;
