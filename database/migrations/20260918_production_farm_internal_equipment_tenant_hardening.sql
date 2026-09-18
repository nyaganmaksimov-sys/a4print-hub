-- A4PRINT HUB: Production Farm Phase 37 — internal equipment tenant hardening.

create or replace function public.notify_equipment_incident(p_incident_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_inc public.equipment_incidents%rowtype;
  v_machine public.equipment_assets%rowtype;
  v_title text;
  v_body text;
begin
  select * into v_inc
  from public.equipment_incidents
  where id=p_incident_id;
  if v_inc.id is null then return; end if;

  select * into v_machine
  from public.equipment_assets
  where id=v_inc.equipment_id;
  if v_machine.id is null or v_machine.organization_id is null then return; end if;

  v_title:='Неисправность оборудования · '||
    coalesce(v_machine.inventory_number,'')||' '||coalesce(v_machine.name,'');
  v_body:=left(v_inc.description,700);

  insert into public.notifications(user_id,title,body,type,entity_type,entity_id)
  select distinct
    u.id,v_title,v_body,'EQUIPMENT_INCIDENT','EQUIPMENT_INCIDENT',v_inc.id
  from public.users u
  join public.organization_units ou
    on ou.id=u.organization_unit_id
   and ou.is_active=true
   and ou.organization_id=v_machine.organization_id
  where u.is_active
    and (
      u.id=v_machine.responsible_user_id
      or u.id=v_inc.responsible_user_id
      or exists(
        select 1
        from public.user_roles ur
        join public.role_permissions rp on rp.role_id=ur.role_id
        join public.permissions p on p.id=rp.permission_id
        where ur.user_id=u.id
          and p.code='equipment.repair'
      )
      or exists(
        select 1
        from public.user_roles ur
        join public.roles ro on ro.id=ur.role_id
        where ur.user_id=u.id
          and ro.name='ADMIN'
      )
    )
    and not exists(
      select 1
      from public.notifications n
      where n.user_id=u.id
        and n.type='EQUIPMENT_INCIDENT'
        and n.entity_type='EQUIPMENT_INCIDENT'
        and n.entity_id=v_inc.id
    );
end
$$;

revoke all on function public.notify_equipment_incident(uuid)
  from public,anon,authenticated;

create or replace function public.mirror_equipment_consumable_movement_to_inventory()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_catalog_id uuid;
  v_consumable_org uuid;
  v_catalog_org uuid;
  v_wh uuid;
  v_type text;
  v_qty numeric;
  v_cost numeric;
begin
  select c.catalog_item_id,c.organization_id
    into v_catalog_id,v_consumable_org
  from public.equipment_consumables c
  where c.id=new.consumable_id;

  if v_catalog_id is null then return new; end if;
  if v_consumable_org is null then
    raise exception 'EQUIPMENT_CONSUMABLE_ORGANIZATION_REQUIRED';
  end if;

  select ci.organization_id,ci.cost_price
    into v_catalog_org,v_cost
  from public.catalog_items ci
  where ci.id=v_catalog_id;

  if v_catalog_org is null or v_catalog_org is distinct from v_consumable_org then
    raise exception 'EQUIPMENT_CONSUMABLE_CATALOG_TENANT_MISMATCH';
  end if;

  if exists(
    select 1
    from public.inventory_transactions
    where reference_type='EQUIPMENT_CONSUMABLE_MOVEMENT'
      and reference_id=new.id
  ) then return new; end if;

  select w.id into v_wh
  from public.warehouses w
  where w.is_active=true
    and (
      w.organization_id=v_consumable_org
      or (w.is_shared=true and w.organization_id is null)
    )
  order by
    case when w.organization_id=v_consumable_org then 0 else 1 end,
    w.created_at
  limit 1;

  if v_wh is null then
    raise exception 'INVENTORY_WAREHOUSE_NOT_AVAILABLE';
  end if;

  v_qty:=abs(new.quantity_delta);
  if v_qty=0 then return new; end if;

  v_type:=case upper(new.movement_type)
    when 'RECEIPT' then 'RECEIPT'
    when 'ISSUE' then 'PRODUCTION_OUT'
    when 'RETURN' then 'PRODUCTION_IN'
    when 'WRITE_OFF' then 'WRITE_OFF'
    when 'ADJUSTMENT' then case when new.quantity_delta>=0 then 'RECEIPT' else 'WRITE_OFF' end
    else case when new.quantity_delta>=0 then 'RECEIPT' else 'WRITE_OFF' end
  end;

  insert into public.inventory_transactions(
    catalog_item_id,warehouse_id,transaction_type,quantity,unit_cost,
    reference_type,reference_id,note,created_by,created_at
  ) values(
    v_catalog_id,v_wh,v_type,v_qty,coalesce(v_cost,0),
    'EQUIPMENT_CONSUMABLE_MOVEMENT',new.id,
    coalesce(new.note,new.document_ref,'Синхронизация движения расходника'),
    new.created_by,new.created_at
  );

  return new;
end
$$;

revoke all on function public.mirror_equipment_consumable_movement_to_inventory()
  from public,anon,authenticated;

create or replace function public.sync_equipment_consumable_to_catalog()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_catalog_id uuid;
  v_catalog_org uuid;
begin
  if new.organization_id is null then
    raise exception 'EQUIPMENT_CONSUMABLE_ORGANIZATION_REQUIRED';
  end if;

  if new.catalog_item_id is null then
    select id into v_catalog_id
    from public.catalog_items
    where external_source='equipment_consumables'
      and external_id=new.id::text
    limit 1;

    if v_catalog_id is null then
      insert into public.catalog_items(
        organization_id,sku,name,item_type,category,unit,
        sale_price,cost_price,min_stock,is_active,
        external_source,external_id
      ) values(
        new.organization_id,
        'EC-'||replace(new.id::text,'-',''),
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

    new.catalog_item_id:=v_catalog_id;
  end if;

  select organization_id into v_catalog_org
  from public.catalog_items
  where id=new.catalog_item_id;

  if v_catalog_org is not null and v_catalog_org is distinct from new.organization_id then
    raise exception 'EQUIPMENT_CONSUMABLE_CATALOG_TENANT_MISMATCH';
  end if;

  update public.catalog_items
  set organization_id=new.organization_id,
      name=new.name,
      item_type='MATERIAL',
      category=new.category,
      unit=new.unit,
      min_stock=new.min_stock,
      is_active=new.is_active,
      external_source='equipment_consumables',
      external_id=new.id::text,
      updated_at=clock_timestamp()
  where id=new.catalog_item_id;

  return new;
end
$$;

revoke all on function public.sync_equipment_consumable_to_catalog()
  from public,anon,authenticated;

alter function public.ensure_equipment_owner_partner_role()
  set search_path to '';

alter function public.equipment_incident_status_trigger()
  set search_path to '';

alter function public.refresh_equipment_operational_status(uuid)
  set search_path to '';

alter function public.replan_production_jobs_after_equipment_fault()
  set search_path to '';

alter function public.seed_equipment_capacity_rules()
  set search_path to '';

alter function public.sync_equipment_incident_status(uuid)
  set search_path to '';

alter function public.sync_equipment_ownership_history()
  set search_path to '';
