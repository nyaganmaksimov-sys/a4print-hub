-- Phase 3 bridge: keep the existing Equipment > Consumables UI compatible
-- while catalog_items + inventory_transactions become the canonical material ledger.

create or replace function public.sync_equipment_consumable_to_catalog()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_catalog_id uuid;
begin
  if new.catalog_item_id is null then
    select id into v_catalog_id
    from public.catalog_items
    where external_source = 'equipment_consumables'
      and external_id = new.id::text
    limit 1;

    if v_catalog_id is null then
      insert into public.catalog_items(
        organization_id, sku, name, item_type, category, unit,
        sale_price, cost_price, min_stock, is_active,
        external_source, external_id
      ) values (
        new.organization_id,
        'EC-' || replace(new.id::text,'-',''),
        new.name,
        'MATERIAL',
        new.category,
        new.unit,
        0,
        0,
        new.min_stock,
        new.is_active,
        'equipment_consumables',
        new.id::text
      ) returning id into v_catalog_id;
    end if;
    new.catalog_item_id := v_catalog_id;
  end if;

  update public.catalog_items
  set organization_id = new.organization_id,
      name = new.name,
      item_type = 'MATERIAL',
      category = new.category,
      unit = new.unit,
      min_stock = new.min_stock,
      is_active = new.is_active,
      external_source = 'equipment_consumables',
      external_id = new.id::text,
      updated_at = clock_timestamp()
  where id = new.catalog_item_id;

  return new;
end;
$$;

revoke all on function public.sync_equipment_consumable_to_catalog() from public, anon, authenticated;

drop trigger if exists equipment_consumable_catalog_bridge_trg on public.equipment_consumables;
create trigger equipment_consumable_catalog_bridge_trg
before insert or update of organization_id,name,category,unit,min_stock,is_active,catalog_item_id
on public.equipment_consumables
for each row execute function public.sync_equipment_consumable_to_catalog();

create or replace function public.mirror_equipment_consumable_movement_to_inventory()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_catalog_id uuid;
  v_wh uuid;
  v_type text;
  v_qty numeric;
  v_cost numeric;
begin
  select catalog_item_id into v_catalog_id
  from public.equipment_consumables
  where id = new.consumable_id;

  if v_catalog_id is null then return new; end if;
  if exists (
    select 1 from public.inventory_transactions
    where reference_type = 'EQUIPMENT_CONSUMABLE_MOVEMENT'
      and reference_id = new.id
  ) then return new; end if;

  select id into v_wh from public.warehouses where is_active order by created_at limit 1;
  select cost_price into v_cost from public.catalog_items where id = v_catalog_id;

  v_qty := abs(new.quantity_delta);
  if v_qty = 0 then return new; end if;

  v_type := case upper(new.movement_type)
    when 'RECEIPT' then 'RECEIPT'
    when 'ISSUE' then 'PRODUCTION_OUT'
    when 'RETURN' then 'PRODUCTION_IN'
    when 'WRITE_OFF' then 'WRITE_OFF'
    when 'ADJUSTMENT' then case when new.quantity_delta >= 0 then 'RECEIPT' else 'WRITE_OFF' end
    else case when new.quantity_delta >= 0 then 'RECEIPT' else 'WRITE_OFF' end
  end;

  insert into public.inventory_transactions(
    catalog_item_id, warehouse_id, transaction_type, quantity, unit_cost,
    reference_type, reference_id, note, created_by, created_at
  ) values (
    v_catalog_id, v_wh, v_type, v_qty, coalesce(v_cost,0),
    'EQUIPMENT_CONSUMABLE_MOVEMENT', new.id,
    coalesce(new.note, new.document_ref, 'Синхронизация движения расходника'),
    new.created_by, new.created_at
  );

  return new;
end;
$$;

revoke all on function public.mirror_equipment_consumable_movement_to_inventory() from public, anon, authenticated;

drop trigger if exists equipment_consumable_movement_inventory_bridge_trg on public.equipment_consumable_movements;
create trigger equipment_consumable_movement_inventory_bridge_trg
after insert on public.equipment_consumable_movements
for each row execute function public.mirror_equipment_consumable_movement_to_inventory();

-- Realtime for the phase 3 workspace. Guard against duplicate publication membership.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='production_job_materials'
  ) then
    alter publication supabase_realtime add table public.production_job_materials;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime' and schemaname='public' and tablename='inventory_transactions'
  ) then
    alter publication supabase_realtime add table public.inventory_transactions;
  end if;
end $$;
