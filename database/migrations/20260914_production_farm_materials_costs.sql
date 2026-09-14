-- A4PRINT HUB · Production Farm Phase 3
-- Canonical materials, warehouse movements and actual production cost.

-- 1. Ensure that production has a canonical warehouse even on installations
--    that used only the legacy equipment-consumables journal.
insert into public.warehouses(name,address,business_unit,is_active)
select 'Основной склад A4PRINT HUB', null, 'COMMON'::public.business_unit, true
where not exists (select 1 from public.warehouses where is_active = true);

alter table public.equipment_consumables
  add column if not exists catalog_item_id uuid,
  add column if not exists warehouse_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.equipment_consumables'::regclass
      and conname='equipment_consumables_catalog_item_id_fkey'
  ) then
    alter table public.equipment_consumables
      add constraint equipment_consumables_catalog_item_id_fkey
      foreign key (catalog_item_id) references public.catalog_items(id) on delete restrict;
  end if;

  if not exists (
    select 1 from pg_constraint
    where conrelid='public.equipment_consumables'::regclass
      and conname='equipment_consumables_warehouse_id_fkey'
  ) then
    alter table public.equipment_consumables
      add constraint equipment_consumables_warehouse_id_fkey
      foreign key (warehouse_id) references public.warehouses(id) on delete set null;
  end if;
end
$$;

create unique index if not exists equipment_consumables_catalog_item_uidx
  on public.equipment_consumables(catalog_item_id)
  where catalog_item_id is not null;

create or replace function public.sync_equipment_consumable_catalog_bridge()
returns trigger
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_sku text;
  v_warehouse uuid;
begin
  if new.warehouse_id is null then
    select w.id into v_warehouse
    from public.warehouses w
    where w.is_active=true
    order by case when w.business_unit='COMMON'::public.business_unit then 0 else 1 end, w.created_at
    limit 1;
    new.warehouse_id := v_warehouse;
  end if;

  if new.catalog_item_id is null then
    v_sku := nullif(trim(coalesce(new.sku,'')),'');
    if v_sku is null or exists(select 1 from public.catalog_items ci where ci.sku=v_sku) then
      v_sku := 'EC-' || replace(new.id::text,'-','');
    end if;

    insert into public.catalog_items(
      organization_id,sku,name,item_type,category,unit,description,
      sale_price,cost_price,min_stock,is_active
    ) values (
      new.organization_id,v_sku,new.name,'MATERIAL',new.category,new.unit,new.notes,
      0,0,new.min_stock,new.is_active
    )
    returning id into new.catalog_item_id;
  else
    update public.catalog_items ci
    set organization_id=new.organization_id,
        name=new.name,
        category=new.category,
        unit=new.unit,
        description=coalesce(new.notes,ci.description),
        min_stock=new.min_stock,
        is_active=new.is_active,
        updated_at=now()
    where ci.id=new.catalog_item_id;

    v_sku := nullif(trim(coalesce(new.sku,'')),'');
    if v_sku is not null
       and not exists(select 1 from public.catalog_items ci where ci.sku=v_sku and ci.id<>new.catalog_item_id) then
      update public.catalog_items set sku=v_sku, updated_at=now() where id=new.catalog_item_id;
    end if;
  end if;

  return new;
end
$$;

revoke all on function public.sync_equipment_consumable_catalog_bridge() from public, anon, authenticated;

drop trigger if exists trg_equipment_consumable_catalog_bridge on public.equipment_consumables;
create trigger trg_equipment_consumable_catalog_bridge
before insert or update of organization_id,name,category,sku,unit,min_stock,is_active,notes,warehouse_id,catalog_item_id
on public.equipment_consumables
for each row execute function public.sync_equipment_consumable_catalog_bridge();

-- Backfill all existing legacy consumables into the canonical catalog.
update public.equipment_consumables
set catalog_item_id=catalog_item_id
where catalog_item_id is null or warehouse_id is null;

-- One canonical baseline transaction per migrated legacy consumable.
create unique index if not exists inventory_transactions_equipment_bridge_uidx
  on public.inventory_transactions(reference_type,reference_id)
  where reference_type in ('EQUIPMENT_CONSUMABLE_MIGRATION','EQUIPMENT_CONSUMABLE_MOVEMENT');

insert into public.inventory_transactions(
  catalog_item_id,warehouse_id,transaction_type,quantity,unit_cost,
  reference_type,reference_id,note,created_by,created_at
)
select
  ec.catalog_item_id,
  ec.warehouse_id,
  case when b.current_stock >= 0 then 'ADJUSTMENT' else 'WRITE_OFF' end,
  abs(b.current_stock),
  coalesce(ci.cost_price,0),
  'EQUIPMENT_CONSUMABLE_MIGRATION',
  ec.id,
  'Перенос остатка из журнала расходников оборудования',
  ec.created_by,
  now()
from public.equipment_consumables ec
join public.equipment_consumable_balances b on b.consumable_id=ec.id
join public.catalog_items ci on ci.id=ec.catalog_item_id
where abs(b.current_stock) > 0.000001
  and not exists (
    select 1 from public.inventory_transactions it
    where it.reference_type='EQUIPMENT_CONSUMABLE_MIGRATION' and it.reference_id=ec.id
  );

create or replace function public.sync_equipment_consumable_movement_to_inventory()
returns trigger
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_catalog_item uuid;
  v_warehouse uuid;
  v_cost numeric;
  v_type text;
begin
  if abs(coalesce(new.quantity_delta,0)) <= 0.000001 then
    return new;
  end if;

  select ec.catalog_item_id,ec.warehouse_id,coalesce(ci.cost_price,0)
  into v_catalog_item,v_warehouse,v_cost
  from public.equipment_consumables ec
  join public.catalog_items ci on ci.id=ec.catalog_item_id
  where ec.id=new.consumable_id;

  if v_catalog_item is null then
    return new;
  end if;

  v_type := case upper(coalesce(new.movement_type,''))
    when 'RECEIPT' then 'RECEIPT'
    when 'RETURN' then 'PRODUCTION_IN'
    when 'ISSUE' then 'PRODUCTION_OUT'
    when 'WRITE_OFF' then 'WRITE_OFF'
    when 'ADJUSTMENT' then case when new.quantity_delta >= 0 then 'ADJUSTMENT' else 'WRITE_OFF' end
    else case when new.quantity_delta >= 0 then 'ADJUSTMENT' else 'WRITE_OFF' end
  end;

  insert into public.inventory_transactions(
    catalog_item_id,warehouse_id,transaction_type,quantity,unit_cost,
    reference_type,reference_id,note,created_by,created_at
  ) values (
    v_catalog_item,v_warehouse,v_type,abs(new.quantity_delta),v_cost,
    'EQUIPMENT_CONSUMABLE_MOVEMENT',new.id,
    concat_ws(' · ',new.note,case when new.equipment_id is not null then 'оборудование '||new.equipment_id::text end),
    new.created_by,new.created_at
  )
  on conflict do nothing;

  return new;
end
$$;

revoke all on function public.sync_equipment_consumable_movement_to_inventory() from public, anon, authenticated;

drop trigger if exists trg_equipment_consumable_movement_inventory on public.equipment_consumable_movements;
create trigger trg_equipment_consumable_movement_inventory
after insert on public.equipment_consumable_movements
for each row execute function public.sync_equipment_consumable_movement_to_inventory();

-- 2. Production material plan lines and immutable production-material events.
create table if not exists public.production_job_materials (
  id uuid primary key default gen_random_uuid(),
  production_job_id uuid not null references public.production_jobs(id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items(id) on delete restrict,
  warehouse_id uuid not null references public.warehouses(id) on delete restrict,
  planned_quantity numeric(14,3) not null default 0 check (planned_quantity >= 0),
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(production_job_id,catalog_item_id,warehouse_id)
);

create table if not exists public.production_material_events (
  id uuid primary key default gen_random_uuid(),
  material_line_id uuid not null references public.production_job_materials(id) on delete cascade,
  production_job_run_id uuid references public.production_job_runs(id) on delete set null,
  event_type text not null check (event_type in ('ISSUE','RETURN','CONSUME','WASTE','SCRAP','REWORK')),
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,4) not null default 0 check (unit_cost >= 0),
  inventory_transaction_id uuid references public.inventory_transactions(id) on delete set null,
  note text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists production_job_materials_job_idx
  on public.production_job_materials(production_job_id);
create index if not exists production_job_materials_catalog_idx
  on public.production_job_materials(catalog_item_id,warehouse_id);
create index if not exists production_material_events_line_idx
  on public.production_material_events(material_line_id,created_at desc);
create index if not exists production_material_events_run_idx
  on public.production_material_events(production_job_run_id)
  where production_job_run_id is not null;

alter table public.production_job_materials enable row level security;
alter table public.production_material_events enable row level security;

drop policy if exists production_job_materials_read on public.production_job_materials;
create policy production_job_materials_read on public.production_job_materials
for select to authenticated
using (public.has_permission('production.view') or public.has_permission('production.manage'));

drop policy if exists production_material_events_read on public.production_material_events;
create policy production_material_events_read on public.production_material_events
for select to authenticated
using (public.has_permission('production.view') or public.has_permission('production.manage'));

revoke all on public.production_job_materials from anon;
revoke all on public.production_material_events from anon;
revoke insert,update,delete on public.production_job_materials from authenticated;
revoke insert,update,delete on public.production_material_events from authenticated;
grant select on public.production_job_materials to authenticated;
grant select on public.production_material_events to authenticated;

drop trigger if exists trg_production_job_materials_updated_at on public.production_job_materials;
create trigger trg_production_job_materials_updated_at
before update on public.production_job_materials
for each row execute function public.touch_production_farm_updated_at();

drop trigger if exists trg_audit_production_job_materials on public.production_job_materials;
create trigger trg_audit_production_job_materials
after insert or update or delete on public.production_job_materials
for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_production_material_events on public.production_material_events;
create trigger trg_audit_production_material_events
after insert or update or delete on public.production_material_events
for each row execute function public.audit_row_change();

create or replace view public.production_job_material_status
with (security_invoker=true)
as
with a as (
  select
    e.material_line_id,
    coalesce(sum(e.quantity) filter (where e.event_type='ISSUE'),0)::numeric(14,3) as issued_quantity,
    coalesce(sum(e.quantity) filter (where e.event_type='RETURN'),0)::numeric(14,3) as returned_quantity,
    coalesce(sum(e.quantity) filter (where e.event_type='CONSUME'),0)::numeric(14,3) as consumed_quantity,
    coalesce(sum(e.quantity) filter (where e.event_type='WASTE'),0)::numeric(14,3) as waste_quantity,
    coalesce(sum(e.quantity) filter (where e.event_type='SCRAP'),0)::numeric(14,3) as scrap_quantity,
    coalesce(sum(e.quantity) filter (where e.event_type='REWORK'),0)::numeric(14,3) as rework_quantity
  from public.production_material_events e
  group by e.material_line_id
)
select
  l.id,
  l.production_job_id,
  l.catalog_item_id,
  l.warehouse_id,
  ci.sku,
  ci.name as material_name,
  ci.category,
  ci.unit,
  w.name as warehouse_name,
  l.planned_quantity,
  coalesce(a.issued_quantity,0)::numeric(14,3) as issued_quantity,
  coalesce(a.returned_quantity,0)::numeric(14,3) as returned_quantity,
  coalesce(a.consumed_quantity,0)::numeric(14,3) as consumed_quantity,
  coalesce(a.waste_quantity,0)::numeric(14,3) as waste_quantity,
  coalesce(a.scrap_quantity,0)::numeric(14,3) as scrap_quantity,
  coalesce(a.rework_quantity,0)::numeric(14,3) as rework_quantity,
  greatest(
    coalesce(a.issued_quantity,0)-coalesce(a.returned_quantity,0)-coalesce(a.consumed_quantity,0)-coalesce(a.waste_quantity,0)-coalesce(a.scrap_quantity,0)-coalesce(a.rework_quantity,0),
    0
  )::numeric(14,3) as unclassified_quantity,
  coalesce(ib.quantity,0)::numeric(14,3) as warehouse_stock,
  l.unit_cost,
  (greatest(coalesce(a.issued_quantity,0)-coalesce(a.returned_quantity,0),0)*l.unit_cost)::numeric(16,2) as material_cost,
  l.note,
  l.created_at,
  l.updated_at
from public.production_job_materials l
join public.catalog_items ci on ci.id=l.catalog_item_id
join public.warehouses w on w.id=l.warehouse_id
left join a on a.material_line_id=l.id
left join public.inventory_balances ib on ib.catalog_item_id=l.catalog_item_id and ib.warehouse_id=l.warehouse_id;

revoke all on public.production_job_material_status from anon, authenticated;

-- 3. Permission-checked APIs.
create or replace function public.save_production_job_material(
  p_job_id uuid,
  p_catalog_item_id uuid,
  p_warehouse_id uuid default null,
  p_planned_quantity numeric default 0,
  p_unit_cost numeric default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_line public.production_job_materials%rowtype;
  v_warehouse uuid;
  v_cost numeric;
  v_profile uuid;
  v_item public.catalog_items%rowtype;
begin
  if not public.has_permission('production.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if coalesce(p_planned_quantity,0) < 0 then
    raise exception 'INVALID_PLANNED_QUANTITY';
  end if;
  if p_unit_cost is not null and p_unit_cost < 0 then
    raise exception 'INVALID_UNIT_COST';
  end if;
  if not exists(select 1 from public.production_jobs j where j.id=p_job_id) then
    raise exception 'PRODUCTION_JOB_NOT_FOUND';
  end if;

  select * into v_item from public.catalog_items ci
  where ci.id=p_catalog_item_id and ci.item_type='MATERIAL' and ci.is_active=true;
  if not found then
    raise exception 'MATERIAL_NOT_FOUND';
  end if;

  v_warehouse := p_warehouse_id;
  if v_warehouse is null then
    select w.id into v_warehouse from public.warehouses w
    where w.is_active=true
    order by case when w.business_unit='COMMON'::public.business_unit then 0 else 1 end,w.created_at
    limit 1;
  end if;
  if v_warehouse is null or not exists(select 1 from public.warehouses w where w.id=v_warehouse and w.is_active=true) then
    raise exception 'WAREHOUSE_NOT_FOUND';
  end if;

  v_cost := coalesce(p_unit_cost,v_item.cost_price,0);
  v_profile := public.current_hub_user_id();

  select * into v_line
  from public.production_job_materials l
  where l.production_job_id=p_job_id and l.catalog_item_id=p_catalog_item_id and l.warehouse_id=v_warehouse
  for update;

  if found then
    if p_unit_cost is not null
       and abs(v_line.unit_cost-p_unit_cost) > 0.0001
       and exists(select 1 from public.production_material_events e where e.material_line_id=v_line.id and e.event_type in ('ISSUE','RETURN')) then
      raise exception 'MATERIAL_COST_LOCKED_AFTER_ISSUE';
    end if;

    update public.production_job_materials
    set planned_quantity=coalesce(p_planned_quantity,0),
        unit_cost=case when p_unit_cost is null then unit_cost else p_unit_cost end,
        note=nullif(trim(coalesce(p_note,'')),'')
    where id=v_line.id;
    return v_line.id;
  end if;

  insert into public.production_job_materials(
    production_job_id,catalog_item_id,warehouse_id,planned_quantity,unit_cost,note,created_by
  ) values (
    p_job_id,p_catalog_item_id,v_warehouse,coalesce(p_planned_quantity,0),v_cost,
    nullif(trim(coalesce(p_note,'')),''),v_profile
  ) returning id into v_line.id;

  return v_line.id;
end
$$;

create or replace function public.move_production_material(
  p_material_line_id uuid,
  p_action text,
  p_quantity numeric,
  p_run_id uuid default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path='public'
as $$
declare
  v_line public.production_job_materials%rowtype;
  v_action text := upper(trim(coalesce(p_action,'')));
  v_issued numeric := 0;
  v_returned numeric := 0;
  v_classified numeric := 0;
  v_available numeric := 0;
  v_event_id uuid := gen_random_uuid();
  v_inventory_id uuid;
  v_profile uuid;
begin
  if not public.has_permission('production.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'INVALID_MATERIAL_QUANTITY';
  end if;
  if v_action not in ('ISSUE','RETURN','CONSUME','WASTE','SCRAP','REWORK') then
    raise exception 'INVALID_MATERIAL_ACTION';
  end if;

  select * into v_line
  from public.production_job_materials l
  where l.id=p_material_line_id
  for update;
  if not found then
    raise exception 'MATERIAL_LINE_NOT_FOUND';
  end if;

  if p_run_id is not null and not exists(
    select 1 from public.production_job_runs r
    where r.id=p_run_id and r.production_job_id=v_line.production_job_id
  ) then
    raise exception 'RUN_JOB_MISMATCH';
  end if;

  select
    coalesce(sum(e.quantity) filter(where e.event_type='ISSUE'),0),
    coalesce(sum(e.quantity) filter(where e.event_type='RETURN'),0),
    coalesce(sum(e.quantity) filter(where e.event_type in ('CONSUME','WASTE','SCRAP','REWORK')),0)
  into v_issued,v_returned,v_classified
  from public.production_material_events e
  where e.material_line_id=v_line.id;

  v_profile := public.current_hub_user_id();

  if v_action='ISSUE' then
    select coalesce(ib.quantity,0) into v_available
    from public.inventory_balances ib
    where ib.catalog_item_id=v_line.catalog_item_id and ib.warehouse_id=v_line.warehouse_id;
    v_available := coalesce(v_available,0);
    if v_available + 0.000001 < p_quantity then
      raise exception 'INSUFFICIENT_STOCK';
    end if;

    insert into public.inventory_transactions(
      catalog_item_id,warehouse_id,transaction_type,quantity,unit_cost,
      reference_type,reference_id,note,created_by
    ) values (
      v_line.catalog_item_id,v_line.warehouse_id,'PRODUCTION_OUT',p_quantity,v_line.unit_cost,
      'PRODUCTION_MATERIAL_EVENT',v_event_id,
      concat_ws(' · ','Выдача в производство',nullif(trim(coalesce(p_note,'')),'')),v_profile
    ) returning id into v_inventory_id;

  elsif v_action='RETURN' then
    if (v_issued-v_returned-v_classified) + 0.000001 < p_quantity then
      raise exception 'RETURN_EXCEEDS_UNCLASSIFIED_MATERIAL';
    end if;

    insert into public.inventory_transactions(
      catalog_item_id,warehouse_id,transaction_type,quantity,unit_cost,
      reference_type,reference_id,note,created_by
    ) values (
      v_line.catalog_item_id,v_line.warehouse_id,'PRODUCTION_IN',p_quantity,v_line.unit_cost,
      'PRODUCTION_MATERIAL_EVENT',v_event_id,
      concat_ws(' · ','Возврат из производства',nullif(trim(coalesce(p_note,'')),'')),v_profile
    ) returning id into v_inventory_id;

  else
    if (v_issued-v_returned-v_classified) + 0.000001 < p_quantity then
      raise exception 'MATERIAL_CLASSIFICATION_EXCEEDS_ISSUED';
    end if;
  end if;

  insert into public.production_material_events(
    id,material_line_id,production_job_run_id,event_type,quantity,unit_cost,
    inventory_transaction_id,note,created_by
  ) values (
    v_event_id,v_line.id,p_run_id,v_action,p_quantity,v_line.unit_cost,
    v_inventory_id,nullif(trim(coalesce(p_note,'')),''),v_profile
  );

  return v_event_id;
end
$$;

create or replace function public.get_production_job_materials(p_job_id uuid)
returns table(
  id uuid,
  production_job_id uuid,
  catalog_item_id uuid,
  warehouse_id uuid,
  sku text,
  material_name text,
  category text,
  unit text,
  warehouse_name text,
  planned_quantity numeric,
  issued_quantity numeric,
  returned_quantity numeric,
  consumed_quantity numeric,
  waste_quantity numeric,
  scrap_quantity numeric,
  rework_quantity numeric,
  unclassified_quantity numeric,
  warehouse_stock numeric,
  unit_cost numeric,
  material_cost numeric,
  note text
)
language plpgsql
stable
security definer
set search_path='public'
as $$
declare
  v_show_cost boolean;
begin
  if not (public.has_permission('production.view') or public.has_permission('production.manage')) then
    raise exception 'PERMISSION_DENIED';
  end if;
  v_show_cost := public.has_permission('production.analytics.view') or public.has_permission('production.manage');

  return query
  select
    s.id,s.production_job_id,s.catalog_item_id,s.warehouse_id,s.sku,s.material_name,s.category,s.unit,s.warehouse_name,
    s.planned_quantity,s.issued_quantity,s.returned_quantity,s.consumed_quantity,s.waste_quantity,s.scrap_quantity,
    s.rework_quantity,s.unclassified_quantity,s.warehouse_stock,
    case when v_show_cost then s.unit_cost else null end,
    case when v_show_cost then s.material_cost else null end,
    s.note
  from public.production_job_material_status s
  where s.production_job_id=p_job_id
  order by s.material_name;
end
$$;

create or replace function public.get_production_job_costs(p_job_id uuid default null)
returns table(
  production_job_id uuid,
  operation_amount numeric,
  planned_production_cost numeric,
  actual_material_cost numeric,
  actual_machine_cost numeric,
  actual_electricity_cost numeric,
  actual_production_cost numeric,
  gross_margin numeric
)
language plpgsql
stable
security definer
set search_path='public'
as $$
begin
  if not (public.has_permission('production.analytics.view') or public.has_permission('production.manage')) then
    raise exception 'PERMISSION_DENIED';
  end if;

  return query
  with material as (
    select
      l.production_job_id,
      coalesce(sum(case when e.event_type='ISSUE' then e.quantity*e.unit_cost when e.event_type='RETURN' then -e.quantity*e.unit_cost else 0 end),0)::numeric as material_cost
    from public.production_job_materials l
    left join public.production_material_events e on e.material_line_id=l.id
    group by l.production_job_id
  ), base as (
    select
      j.id,
      coalesce(j.operation_amount,0)::numeric as op_amount,
      coalesce(j.production_cost,0)::numeric as planned_cost,
      coalesce(m.material_cost,0)::numeric as material_cost,
      (coalesce(j.actual_machine_minutes,0)/60.0*coalesce(eq.internal_hour_cost,0))::numeric as machine_cost,
      (case when coalesce(eq.electricity_as_direct_cost,true)
        then coalesce(j.actual_machine_minutes,0)/60.0*coalesce(eq.average_power_kw,0)*coalesce(eq.electricity_tariff,0)
        else 0 end)::numeric as electricity_cost
    from public.production_jobs j
    left join public.equipment_assets eq on eq.id=j.equipment_id
    left join material m on m.production_job_id=j.id
    where p_job_id is null or j.id=p_job_id
  )
  select
    b.id,
    round(b.op_amount,2),
    round(b.planned_cost,2),
    round(b.material_cost,2),
    round(b.machine_cost,2),
    round(b.electricity_cost,2),
    round(b.material_cost+b.machine_cost+b.electricity_cost,2),
    round(b.op_amount-(b.material_cost+b.machine_cost+b.electricity_cost),2)
  from base b
  order by b.id;
end
$$;

revoke all on function public.save_production_job_material(uuid,uuid,uuid,numeric,numeric,text) from public, anon;
revoke all on function public.move_production_material(uuid,text,numeric,uuid,text) from public, anon;
revoke all on function public.get_production_job_materials(uuid) from public, anon;
revoke all on function public.get_production_job_costs(uuid) from public, anon;

grant execute on function public.save_production_job_material(uuid,uuid,uuid,numeric,numeric,text) to authenticated;
grant execute on function public.move_production_material(uuid,text,numeric,uuid,text) to authenticated;
grant execute on function public.get_production_job_materials(uuid) to authenticated;
grant execute on function public.get_production_job_costs(uuid) to authenticated;
