create or replace function public.guard_equipment_consumable_unit_change()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.unit is distinct from old.unit
     and exists (
       select 1
       from public.equipment_consumable_movements m
       where m.consumable_id = old.id
       limit 1
     ) then
    raise exception 'UNIT_CHANGE_REQUIRES_EMPTY_JOURNAL';
  end if;
  return new;
end;
$$;

drop trigger if exists equipment_consumable_unit_guard on public.equipment_consumables;
create trigger equipment_consumable_unit_guard
before update of unit on public.equipment_consumables
for each row execute function public.guard_equipment_consumable_unit_change();

create or replace function public.create_equipment_consumable_v2(
  p_organization_id uuid,
  p_name text,
  p_category text default null,
  p_sku text default null,
  p_unit text default 'шт',
  p_min_stock numeric default 0,
  p_storage_location text default null,
  p_supplier text default null,
  p_is_active boolean default true,
  p_notes text default null,
  p_initial_stock numeric default 0
)
returns uuid
language plpgsql
security invoker
set search_path = public, auth
as $$
declare
  v_id uuid;
  v_profile uuid;
  v_unit text := nullif(trim(coalesce(p_unit,'')),'');
begin
  if nullif(trim(coalesce(p_name,'')),'') is null then
    raise exception 'CONSUMABLE_NAME_REQUIRED';
  end if;
  if v_unit is null then
    raise exception 'CONSUMABLE_UNIT_REQUIRED';
  end if;
  if coalesce(p_min_stock,0) < 0 then
    raise exception 'INVALID_MIN_STOCK';
  end if;
  if coalesce(p_initial_stock,0) < 0 then
    raise exception 'INVALID_INITIAL_STOCK';
  end if;

  select u.id into v_profile
  from public.users u
  where u.auth_user_id = auth.uid() and u.is_active = true
  limit 1;

  insert into public.equipment_consumables(
    organization_id,name,category,sku,unit,min_stock,storage_location,supplier,is_active,notes,created_by
  ) values (
    p_organization_id,trim(p_name),nullif(trim(coalesce(p_category,'')),''),nullif(trim(coalesce(p_sku,'')),''),
    v_unit,coalesce(p_min_stock,0),nullif(trim(coalesce(p_storage_location,'')),''),nullif(trim(coalesce(p_supplier,'')),''),
    coalesce(p_is_active,true),nullif(trim(coalesce(p_notes,'')),''),v_profile
  ) returning id into v_id;

  if coalesce(p_initial_stock,0) > 0 then
    insert into public.equipment_consumable_movements(
      consumable_id,movement_type,quantity_delta,note,created_by
    ) values (
      v_id,'RECEIPT',p_initial_stock,'Начальный остаток',v_profile
    );
  end if;

  return v_id;
end;
$$;

revoke all on function public.create_equipment_consumable_v2(uuid,text,text,text,text,numeric,text,text,boolean,text,numeric) from public;
grant execute on function public.create_equipment_consumable_v2(uuid,text,text,text,text,numeric,text,text,boolean,text,numeric) to authenticated;
