-- Production Farm phase 3: canonical materials, warehouse movements and actual costing.

create extension if not exists pgcrypto;

alter table public.equipment_consumables
  add column if not exists catalog_item_id uuid references public.catalog_items(id) on delete set null;

create unique index if not exists equipment_consumables_catalog_item_uidx
  on public.equipment_consumables(catalog_item_id)
  where catalog_item_id is not null;

-- Keep the old consumables UI compatible while giving every legacy consumable
-- a canonical catalog MATERIAL identity.
insert into public.catalog_items (
  organization_id, sku, name, item_type, category, unit, sale_price, cost_price,
  min_stock, is_active, external_source, external_id
)
select
  c.organization_id,
  'EC-' || replace(c.id::text, '-', ''),
  c.name,
  'MATERIAL',
  c.category,
  c.unit,
  0,
  0,
  c.min_stock,
  c.is_active,
  'equipment_consumables',
  c.id::text
from public.equipment_consumables c
where c.catalog_item_id is null
  and not exists (
    select 1 from public.catalog_items ci
    where ci.external_source = 'equipment_consumables'
      and ci.external_id = c.id::text
  );

update public.equipment_consumables c
set catalog_item_id = ci.id
from public.catalog_items ci
where c.catalog_item_id is null
  and ci.external_source = 'equipment_consumables'
  and ci.external_id = c.id::text;

-- The canonical inventory schema existed without a warehouse in the current DB.
insert into public.warehouses(name, business_unit, is_active)
select 'Основной склад', 'COMMON'::public.business_unit, true
where not exists (select 1 from public.warehouses where name = 'Основной склад');

-- Preserve the current positive legacy consumable balance as one opening receipt.
with balances as (
  select c.id as consumable_id,
         c.catalog_item_id,
         greatest(coalesce(sum(m.quantity_delta), 0), 0)::numeric as quantity
  from public.equipment_consumables c
  left join public.equipment_consumable_movements m on m.consumable_id = c.id
  where c.catalog_item_id is not null
  group by c.id, c.catalog_item_id
), wh as (
  select id from public.warehouses where name = 'Основной склад' order by created_at limit 1
)
insert into public.inventory_transactions(
  catalog_item_id, warehouse_id, transaction_type, quantity, unit_cost,
  reference_type, reference_id, note
)
select b.catalog_item_id, wh.id, 'RECEIPT', b.quantity, 0,
       'LEGACY_EQUIPMENT_CONSUMABLE_OPENING', b.consumable_id,
       'Перенос остатка из equipment_consumables'
from balances b cross join wh
where b.quantity > 0
  and not exists (
    select 1 from public.inventory_transactions it
    where it.reference_type = 'LEGACY_EQUIPMENT_CONSUMABLE_OPENING'
      and it.reference_id = b.consumable_id
  );

create table if not exists public.production_job_materials (
  id uuid primary key default gen_random_uuid(),
  production_job_id uuid not null references public.production_jobs(id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items(id),
  warehouse_id uuid references public.warehouses(id) on delete set null,
  planned_quantity numeric(14,3) not null default 0 check (planned_quantity >= 0),
  issued_quantity numeric(14,3) not null default 0 check (issued_quantity >= 0),
  returned_quantity numeric(14,3) not null default 0 check (returned_quantity >= 0),
  waste_quantity numeric(14,3) not null default 0 check (waste_quantity >= 0),
  unit_cost_snapshot numeric(14,4) not null default 0 check (unit_cost_snapshot >= 0),
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint production_job_materials_return_not_over_issue
    check (returned_quantity <= issued_quantity),
  constraint production_job_materials_waste_not_over_net
    check (waste_quantity <= issued_quantity - returned_quantity),
  unique (production_job_id, catalog_item_id)
);

create index if not exists production_job_materials_job_idx
  on public.production_job_materials(production_job_id);
create index if not exists production_job_materials_catalog_idx
  on public.production_job_materials(catalog_item_id);
create index if not exists production_job_materials_warehouse_idx
  on public.production_job_materials(warehouse_id);

alter table public.production_job_materials enable row level security;

drop policy if exists production_job_materials_read on public.production_job_materials;
create policy production_job_materials_read
on public.production_job_materials for select to authenticated
using (public.has_permission('production.view'));

drop policy if exists production_job_materials_manage on public.production_job_materials;
create policy production_job_materials_manage
on public.production_job_materials for all to authenticated
using (public.has_permission('production.manage'))
with check (public.has_permission('production.manage'));

create or replace function public.production_inventory_balance(
  p_catalog_item_id uuid,
  p_warehouse_id uuid default null
) returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(
    case
      when transaction_type in ('RECEIPT','TRANSFER_IN','PRODUCTION_IN','ADJUSTMENT') then quantity
      when transaction_type in ('SALE','WRITE_OFF','TRANSFER_OUT','PRODUCTION_OUT') then -quantity
      else 0
    end
  ), 0)::numeric
  from public.inventory_transactions
  where catalog_item_id = p_catalog_item_id
    and (p_warehouse_id is null or warehouse_id = p_warehouse_id);
$$;

revoke all on function public.production_inventory_balance(uuid, uuid) from public, anon;
grant execute on function public.production_inventory_balance(uuid, uuid) to authenticated;

create or replace function public.recalculate_production_job_cost(p_job_id uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_machine numeric := 0;
  v_electricity numeric := 0;
  v_material numeric := 0;
  v_minutes numeric := 0;
  v_total numeric := 0;
begin
  select coalesce(j.actual_machine_minutes, 0),
         coalesce((coalesce(j.actual_machine_minutes,0) / 60.0) * coalesce(e.internal_hour_cost,0), 0),
         case when coalesce(e.electricity_as_direct_cost, true)
              then coalesce((coalesce(j.actual_machine_minutes,0) / 60.0) * coalesce(e.average_power_kw,0) * coalesce(e.electricity_tariff,0), 0)
              else 0 end
    into v_minutes, v_machine, v_electricity
  from public.production_jobs j
  left join public.equipment_assets e on e.id = j.equipment_id
  where j.id = p_job_id;

  if not found then raise exception 'PRODUCTION_JOB_NOT_FOUND'; end if;

  select coalesce(sum((issued_quantity - returned_quantity) * unit_cost_snapshot), 0)
    into v_material
  from public.production_job_materials
  where production_job_id = p_job_id;

  v_total := round(coalesce(v_machine,0) + coalesce(v_electricity,0) + coalesce(v_material,0), 2);
  update public.production_jobs set production_cost = v_total where id = p_job_id;
  return v_total;
end;
$$;

revoke all on function public.recalculate_production_job_cost(uuid) from public, anon, authenticated;

create or replace function public.production_job_materials_touch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'DELETE' then new.updated_at := clock_timestamp(); end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function public.production_job_materials_touch() from public, anon, authenticated;

drop trigger if exists production_job_materials_touch_trg on public.production_job_materials;
create trigger production_job_materials_touch_trg
before update on public.production_job_materials
for each row execute function public.production_job_materials_touch();

create or replace function public.production_job_materials_recost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalculate_production_job_cost(coalesce(new.production_job_id, old.production_job_id));
  return coalesce(new, old);
end;
$$;
revoke all on function public.production_job_materials_recost() from public, anon, authenticated;

drop trigger if exists production_job_materials_recost_trg on public.production_job_materials;
create trigger production_job_materials_recost_trg
after insert or update or delete on public.production_job_materials
for each row execute function public.production_job_materials_recost();

create or replace function public.production_job_machine_recost()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recalculate_production_job_cost(new.id);
  return new;
end;
$$;
revoke all on function public.production_job_machine_recost() from public, anon, authenticated;

drop trigger if exists production_job_machine_recost_trg on public.production_jobs;
create trigger production_job_machine_recost_trg
after update of actual_machine_minutes, equipment_id on public.production_jobs
for each row execute function public.production_job_machine_recost();

create or replace function public.save_production_job_material_plan(
  p_job_id uuid,
  p_catalog_item_id uuid,
  p_planned_quantity numeric,
  p_warehouse_id uuid default null,
  p_notes text default null
) returns public.production_job_materials
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.production_job_materials;
  v_wh uuid;
  v_cost numeric;
begin
  if not public.has_permission('production.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if coalesce(p_planned_quantity,0) < 0 then raise exception 'INVALID_QUANTITY'; end if;
  if not exists (select 1 from public.production_jobs where id = p_job_id) then raise exception 'PRODUCTION_JOB_NOT_FOUND'; end if;
  if not exists (select 1 from public.catalog_items where id = p_catalog_item_id and item_type = 'MATERIAL' and is_active) then raise exception 'MATERIAL_NOT_FOUND'; end if;

  select coalesce(p_warehouse_id, (select id from public.warehouses where is_active order by created_at limit 1)) into v_wh;
  select cost_price into v_cost from public.catalog_items where id = p_catalog_item_id;

  insert into public.production_job_materials(
    production_job_id, catalog_item_id, warehouse_id, planned_quantity,
    unit_cost_snapshot, notes, created_by
  ) values (
    p_job_id, p_catalog_item_id, v_wh, coalesce(p_planned_quantity,0),
    coalesce(v_cost,0), nullif(trim(p_notes),''), public.current_hub_user_id()
  )
  on conflict (production_job_id, catalog_item_id) do update
  set warehouse_id = excluded.warehouse_id,
      planned_quantity = excluded.planned_quantity,
      notes = excluded.notes,
      unit_cost_snapshot = case
        when public.production_job_materials.issued_quantity = 0 then excluded.unit_cost_snapshot
        else public.production_job_materials.unit_cost_snapshot
      end
  returning * into v_row;

  return v_row;
end;
$$;

revoke all on function public.save_production_job_material_plan(uuid, uuid, numeric, uuid, text) from public, anon;
grant execute on function public.save_production_job_material_plan(uuid, uuid, numeric, uuid, text) to authenticated;

create or replace function public.production_material_action(
  p_job_id uuid,
  p_catalog_item_id uuid,
  p_action text,
  p_quantity numeric,
  p_warehouse_id uuid default null,
  p_note text default null
) returns public.production_job_materials
language plpgsql
security definer
set search_path = public
as $$
declare
  v_action text := upper(trim(coalesce(p_action,'')));
  v_row public.production_job_materials;
  v_wh uuid;
  v_available numeric;
  v_cost numeric;
  v_actor uuid;
begin
  if not public.has_permission('production.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if coalesce(p_quantity,0) <= 0 then raise exception 'INVALID_QUANTITY'; end if;
  if v_action not in ('ISSUE','RETURN','WASTE') then raise exception 'INVALID_ACTION'; end if;
  if not exists (select 1 from public.production_jobs where id = p_job_id) then raise exception 'PRODUCTION_JOB_NOT_FOUND'; end if;
  if not exists (select 1 from public.catalog_items where id = p_catalog_item_id and item_type = 'MATERIAL') then raise exception 'MATERIAL_NOT_FOUND'; end if;

  v_actor := public.current_hub_user_id();
  select coalesce(p_warehouse_id, warehouse_id) into v_wh
  from public.production_job_materials
  where production_job_id = p_job_id and catalog_item_id = p_catalog_item_id;
  if v_wh is null then select id into v_wh from public.warehouses where is_active order by created_at limit 1; end if;
  if v_wh is null then raise exception 'WAREHOUSE_REQUIRED'; end if;

  select cost_price into v_cost from public.catalog_items where id = p_catalog_item_id;

  insert into public.production_job_materials(
    production_job_id, catalog_item_id, warehouse_id, unit_cost_snapshot, created_by
  ) values (p_job_id, p_catalog_item_id, v_wh, coalesce(v_cost,0), v_actor)
  on conflict (production_job_id, catalog_item_id) do nothing;

  select * into v_row
  from public.production_job_materials
  where production_job_id = p_job_id and catalog_item_id = p_catalog_item_id
  for update;

  if v_action = 'ISSUE' then
    v_available := public.production_inventory_balance(p_catalog_item_id, v_wh);
    if v_available < p_quantity then raise exception 'INSUFFICIENT_STOCK'; end if;

    insert into public.inventory_transactions(
      catalog_item_id, warehouse_id, transaction_type, quantity, unit_cost,
      reference_type, reference_id, note, created_by
    ) values (
      p_catalog_item_id, v_wh, 'PRODUCTION_OUT', p_quantity, v_row.unit_cost_snapshot,
      'PRODUCTION_JOB', p_job_id, nullif(trim(p_note),''), v_actor
    );

    update public.production_job_materials
      set issued_quantity = issued_quantity + p_quantity
      where id = v_row.id returning * into v_row;

  elsif v_action = 'RETURN' then
    if v_row.returned_quantity + p_quantity + v_row.waste_quantity > v_row.issued_quantity then
      raise exception 'RETURN_EXCEEDS_AVAILABLE';
    end if;

    insert into public.inventory_transactions(
      catalog_item_id, warehouse_id, transaction_type, quantity, unit_cost,
      reference_type, reference_id, note, created_by
    ) values (
      p_catalog_item_id, v_wh, 'PRODUCTION_IN', p_quantity, v_row.unit_cost_snapshot,
      'PRODUCTION_JOB', p_job_id, coalesce(nullif(trim(p_note),''),'Возврат материала из производства'), v_actor
    );

    update public.production_job_materials
      set returned_quantity = returned_quantity + p_quantity
      where id = v_row.id returning * into v_row;

  else
    if v_row.waste_quantity + p_quantity > v_row.issued_quantity - v_row.returned_quantity then
      raise exception 'WASTE_EXCEEDS_NET_ISSUE';
    end if;
    update public.production_job_materials
      set waste_quantity = waste_quantity + p_quantity
      where id = v_row.id returning * into v_row;
  end if;

  perform public.recalculate_production_job_cost(p_job_id);
  return v_row;
end;
$$;

revoke all on function public.production_material_action(uuid, uuid, text, numeric, uuid, text) from public, anon;
grant execute on function public.production_material_action(uuid, uuid, text, numeric, uuid, text) to authenticated;

create or replace view public.production_job_cost_breakdown
with (security_invoker = true)
as
select
  j.id as production_job_id,
  j.equipment_id,
  coalesce(j.actual_machine_minutes,0) as actual_machine_minutes,
  round(coalesce((j.actual_machine_minutes / 60.0) * e.internal_hour_cost,0),2) as machine_cost,
  round(case when coalesce(e.electricity_as_direct_cost,true)
    then coalesce((j.actual_machine_minutes / 60.0) * e.average_power_kw * e.electricity_tariff,0)
    else 0 end,2) as electricity_cost,
  round(coalesce(m.material_cost,0),2) as material_cost,
  round(coalesce(j.production_cost,0),2) as total_production_cost,
  coalesce(m.waste_quantity,0) as waste_quantity
from public.production_jobs j
left join public.equipment_assets e on e.id = j.equipment_id
left join lateral (
  select sum((pjm.issued_quantity-pjm.returned_quantity)*pjm.unit_cost_snapshot) as material_cost,
         sum(pjm.waste_quantity) as waste_quantity
  from public.production_job_materials pjm
  where pjm.production_job_id = j.id
) m on true;

grant select on public.production_job_cost_breakdown to authenticated;
