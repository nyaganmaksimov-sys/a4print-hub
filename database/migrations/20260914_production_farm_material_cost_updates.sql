-- Phase 3 follow-up: keep balance reads under caller RLS and expose a permission-checked material cost update.

alter function public.production_inventory_balance(uuid, uuid) security invoker;

create or replace function public.set_production_material_cost(
  p_catalog_item_id uuid,
  p_cost numeric
) returns public.catalog_items
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.catalog_items;
begin
  if not public.has_permission('production.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_cost is null or p_cost < 0 then raise exception 'INVALID_COST'; end if;

  update public.catalog_items
  set cost_price = round(p_cost, 4), updated_at = clock_timestamp()
  where id = p_catalog_item_id
    and item_type = 'MATERIAL'
  returning * into v_row;

  if v_row.id is null then raise exception 'MATERIAL_NOT_FOUND'; end if;
  return v_row;
end;
$$;

revoke all on function public.set_production_material_cost(uuid, numeric) from public, anon;
grant execute on function public.set_production_material_cost(uuid, numeric) to authenticated;
