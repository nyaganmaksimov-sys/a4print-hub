-- A4PRINT HUB: Production Farm Phase 40 — production materials/costing hardening.

create or replace function public.production_material_action(
  p_job_id uuid,
  p_catalog_item_id uuid,
  p_action text,
  p_quantity numeric,
  p_warehouse_id uuid default null,
  p_note text default null
)
returns public.production_job_materials
language plpgsql
security definer
set search_path=''
as $$
declare
  v_action text:=upper(trim(coalesce(p_action,'')));
  v_row public.production_job_materials;
  v_wh uuid;
  v_available numeric;
  v_cost numeric;
  v_actor uuid;
  v_job_org uuid;
begin
  perform private.assert_production_job_tenant(p_job_id);
  perform private.assert_catalog_item_tenant(p_catalog_item_id);
  if p_warehouse_id is not null then
    perform private.assert_warehouse_tenant(p_warehouse_id);
  end if;

  if not public.has_permission('production.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if coalesce(p_quantity,0)<=0 then raise exception 'INVALID_QUANTITY'; end if;
  if v_action not in('ISSUE','RETURN','WASTE') then raise exception 'INVALID_ACTION'; end if;

  select organization_id into v_job_org
  from public.production_jobs
  where id=p_job_id;
  if v_job_org is null then raise exception 'PRODUCTION_JOB_NOT_FOUND'; end if;

  if not exists(
    select 1
    from public.catalog_items
    where id=p_catalog_item_id
      and item_type='MATERIAL'
      and organization_id=v_job_org
  ) then raise exception 'MATERIAL_NOT_FOUND'; end if;

  v_actor:=public.current_hub_user_id();

  select coalesce(p_warehouse_id,warehouse_id) into v_wh
  from public.production_job_materials
  where production_job_id=p_job_id
    and catalog_item_id=p_catalog_item_id;

  if v_wh is null then
    select w.id into v_wh
    from public.warehouses w
    where w.is_active=true
      and (
        w.organization_id=v_job_org
        or (w.is_shared=true and w.organization_id is null)
      )
    order by
      case when w.organization_id=v_job_org then 0 else 1 end,
      w.created_at
    limit 1;
  end if;

  if v_wh is null then raise exception 'WAREHOUSE_REQUIRED'; end if;

  if not exists(
    select 1
    from public.warehouses w
    where w.id=v_wh
      and w.is_active=true
      and (
        w.organization_id=v_job_org
        or (w.is_shared=true and w.organization_id is null)
      )
  ) then raise exception 'WAREHOUSE_NOT_AVAILABLE'; end if;

  select cost_price into v_cost
  from public.catalog_items
  where id=p_catalog_item_id
    and organization_id=v_job_org;

  insert into public.production_job_materials(
    production_job_id,catalog_item_id,warehouse_id,unit_cost_snapshot,created_by
  ) values(
    p_job_id,p_catalog_item_id,v_wh,coalesce(v_cost,0),v_actor
  )
  on conflict(production_job_id,catalog_item_id) do nothing;

  select * into v_row
  from public.production_job_materials
  where production_job_id=p_job_id
    and catalog_item_id=p_catalog_item_id
  for update;

  if v_action='ISSUE' then
    v_available:=public.production_inventory_balance(p_catalog_item_id,v_wh);
    if v_available<p_quantity then raise exception 'INSUFFICIENT_STOCK'; end if;

    insert into public.inventory_transactions(
      catalog_item_id,warehouse_id,transaction_type,quantity,unit_cost,
      reference_type,reference_id,note,created_by
    ) values(
      p_catalog_item_id,v_wh,'PRODUCTION_OUT',p_quantity,v_row.unit_cost_snapshot,
      'PRODUCTION_JOB',p_job_id,nullif(trim(p_note),''),v_actor
    );

    update public.production_job_materials
    set issued_quantity=issued_quantity+p_quantity
    where id=v_row.id
    returning * into v_row;

  elsif v_action='RETURN' then
    if v_row.returned_quantity+p_quantity+v_row.waste_quantity>v_row.issued_quantity then
      raise exception 'RETURN_EXCEEDS_AVAILABLE';
    end if;

    insert into public.inventory_transactions(
      catalog_item_id,warehouse_id,transaction_type,quantity,unit_cost,
      reference_type,reference_id,note,created_by
    ) values(
      p_catalog_item_id,v_wh,'PRODUCTION_IN',p_quantity,v_row.unit_cost_snapshot,
      'PRODUCTION_JOB',p_job_id,
      coalesce(nullif(trim(p_note),''),'Возврат материала из производства'),v_actor
    );

    update public.production_job_materials
    set returned_quantity=returned_quantity+p_quantity
    where id=v_row.id
    returning * into v_row;

  else
    if v_row.waste_quantity+p_quantity>v_row.issued_quantity-v_row.returned_quantity then
      raise exception 'WASTE_EXCEEDS_NET_ISSUE';
    end if;

    update public.production_job_materials
    set waste_quantity=waste_quantity+p_quantity
    where id=v_row.id
    returning * into v_row;
  end if;

  perform public.recalculate_production_job_cost(p_job_id);
  return v_row;
end
$$;

revoke all on function public.production_material_action(uuid,uuid,text,numeric,uuid,text)
  from public,anon,authenticated;
grant execute on function public.production_material_action(uuid,uuid,text,numeric,uuid,text)
  to authenticated;

create or replace function public.save_production_job_material_plan(
  p_job_id uuid,
  p_catalog_item_id uuid,
  p_planned_quantity numeric,
  p_warehouse_id uuid default null,
  p_notes text default null
)
returns public.production_job_materials
language plpgsql
security definer
set search_path=''
as $$
declare
  v_row public.production_job_materials;
  v_wh uuid;
  v_cost numeric;
  v_job_org uuid;
begin
  perform private.assert_production_job_tenant(p_job_id);
  perform private.assert_catalog_item_tenant(p_catalog_item_id);
  if p_warehouse_id is not null then
    perform private.assert_warehouse_tenant(p_warehouse_id);
  end if;

  if not public.has_permission('production.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if coalesce(p_planned_quantity,0)<0 then raise exception 'INVALID_QUANTITY'; end if;

  select organization_id into v_job_org
  from public.production_jobs
  where id=p_job_id;
  if v_job_org is null then raise exception 'PRODUCTION_JOB_NOT_FOUND'; end if;

  if not exists(
    select 1
    from public.catalog_items
    where id=p_catalog_item_id
      and item_type='MATERIAL'
      and is_active=true
      and organization_id=v_job_org
  ) then raise exception 'MATERIAL_NOT_FOUND'; end if;

  v_wh:=p_warehouse_id;
  if v_wh is null then
    select w.id into v_wh
    from public.warehouses w
    where w.is_active=true
      and (
        w.organization_id=v_job_org
        or (w.is_shared=true and w.organization_id is null)
      )
    order by
      case when w.organization_id=v_job_org then 0 else 1 end,
      w.created_at
    limit 1;
  end if;

  if v_wh is null then raise exception 'WAREHOUSE_REQUIRED'; end if;

  if not exists(
    select 1
    from public.warehouses w
    where w.id=v_wh
      and w.is_active=true
      and (
        w.organization_id=v_job_org
        or (w.is_shared=true and w.organization_id is null)
      )
  ) then raise exception 'WAREHOUSE_NOT_AVAILABLE'; end if;

  select cost_price into v_cost
  from public.catalog_items
  where id=p_catalog_item_id
    and organization_id=v_job_org;

  insert into public.production_job_materials(
    production_job_id,catalog_item_id,warehouse_id,planned_quantity,
    unit_cost_snapshot,notes,created_by
  ) values(
    p_job_id,p_catalog_item_id,v_wh,coalesce(p_planned_quantity,0),
    coalesce(v_cost,0),nullif(trim(p_notes),''),public.current_hub_user_id()
  )
  on conflict(production_job_id,catalog_item_id) do update
  set warehouse_id=excluded.warehouse_id,
      planned_quantity=excluded.planned_quantity,
      notes=excluded.notes,
      unit_cost_snapshot=case
        when public.production_job_materials.issued_quantity=0 then excluded.unit_cost_snapshot
        else public.production_job_materials.unit_cost_snapshot
      end
  returning * into v_row;

  return v_row;
end
$$;

revoke all on function public.save_production_job_material_plan(uuid,uuid,numeric,uuid,text)
  from public,anon,authenticated;
grant execute on function public.save_production_job_material_plan(uuid,uuid,numeric,uuid,text)
  to authenticated;

alter function public.set_production_material_cost(uuid,numeric) set search_path to '';
alter function public.close_production_job_pause(uuid,timestamptz) set search_path to '';
alter function public.log_production_job_run_event() set search_path to '';
alter function public.log_production_job_status_without_run() set search_path to '';
alter function public.on_production_job_status_sync_order() set search_path to '';
alter function public.production_job_events_recalculate() set search_path to '';
alter function public.production_job_machine_recost() set search_path to '';
alter function public.production_job_materials_recost() set search_path to '';
alter function public.production_job_materials_touch() set search_path to '';
alter function public.recalculate_production_job_cost(uuid) set search_path to '';
alter function public.recalculate_production_job_machine_time(uuid) set search_path to '';
alter function public.recalculate_production_job_operator_totals(uuid) set search_path to '';
alter function public.sync_order_to_production_job() set search_path to '';
alter function public.sync_production_job_execution() set search_path to '';

do $$
declare
  v_oid oid;
  v_def text;
begin
  v_oid:=to_regprocedure('public.on_production_job_status_sync_order()');
  if v_oid is null then raise exception 'RPC_NOT_FOUND:on_production_job_status_sync_order'; end if;

  select pg_get_functiondef(v_oid) into v_def;

  v_def:=replace(
    v_def,
    'where order_id=new.order_id and status::text not in (''DONE'',''CANCELLED'');',
    'where order_id=new.order_id and organization_id=new.organization_id and status::text not in (''DONE'',''CANCELLED'');'
  );

  execute v_def;
end
$$;
