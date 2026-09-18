-- PHASE 2 CORE MULTI-COMPANY
-- Tenant hardening for production SECURITY DEFINER RPCs and dispatcher.

create schema if not exists private;

create or replace function private.assert_production_job_tenant(
  p_job_id uuid
)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_org uuid;
  v_current_org uuid;
begin
  if p_job_id is null then
    raise exception 'PRODUCTION_JOB_NOT_AVAILABLE';
  end if;

  if auth.uid() is null then
    return;
  end if;

  select j.organization_id into v_org
  from public.production_jobs j
  where j.id=p_job_id;

  v_current_org:=public.current_user_organization_id();

  if v_org is null
     or v_current_org is null
     or v_org<>v_current_org then
    raise exception 'PRODUCTION_JOB_NOT_AVAILABLE';
  end if;
end;
$$;

revoke all on function private.assert_production_job_tenant(uuid)
from public,anon,authenticated;

create or replace function private.assert_catalog_item_tenant(
  p_catalog_item_id uuid
)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_org uuid;
  v_current_org uuid;
begin
  if p_catalog_item_id is null then
    raise exception 'CATALOG_ITEM_NOT_AVAILABLE';
  end if;

  if auth.uid() is null then
    return;
  end if;

  select c.organization_id into v_org
  from public.catalog_items c
  where c.id=p_catalog_item_id;

  v_current_org:=public.current_user_organization_id();

  if v_org is null
     or v_current_org is null
     or v_org<>v_current_org then
    raise exception 'CATALOG_ITEM_NOT_AVAILABLE';
  end if;
end;
$$;

revoke all on function private.assert_catalog_item_tenant(uuid)
from public,anon,authenticated;

create or replace function private.assert_warehouse_tenant(
  p_warehouse_id uuid
)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_org uuid;
  v_shared boolean;
  v_current_org uuid;
begin
  if p_warehouse_id is null then
    raise exception 'WAREHOUSE_NOT_AVAILABLE';
  end if;

  if auth.uid() is null then
    return;
  end if;

  select w.organization_id,w.is_shared
    into v_org,v_shared
  from public.warehouses w
  where w.id=p_warehouse_id
    and w.is_active=true;

  v_current_org:=public.current_user_organization_id();

  if coalesce(v_shared,false) then
    return;
  end if;

  if v_org is null
     or v_current_org is null
     or v_org<>v_current_org then
    raise exception 'WAREHOUSE_NOT_AVAILABLE';
  end if;
end;
$$;

revoke all on function private.assert_warehouse_tenant(uuid)
from public,anon,authenticated;

create or replace function private.assert_order_item_tenant(
  p_order_item_id uuid
)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_org uuid;
  v_business_unit public.business_unit;
  v_current_org uuid;
begin
  if p_order_item_id is null then
    raise exception 'ORDER_ITEM_NOT_AVAILABLE';
  end if;

  if auth.uid() is null then
    return;
  end if;

  select o.organization_id,o.business_unit
    into v_org,v_business_unit
  from public.order_items oi
  join public.orders o on o.id=oi.order_id
  where oi.id=p_order_item_id;

  v_current_org:=public.current_user_organization_id();

  if v_org=v_current_org then
    return;
  end if;

  if v_org is null and v_business_unit='COMMON'::public.business_unit then
    return;
  end if;

  raise exception 'ORDER_ITEM_NOT_AVAILABLE';
end;
$$;

revoke all on function private.assert_order_item_tenant(uuid)
from public,anon,authenticated;

-- Job-only public RPCs.
do $$
declare
  r record;
  v_oid oid;
  v_def text;
  v_guard text;
begin
  for r in
    select *
    from (values
      ('public.auto_dispatch_production_job(uuid,boolean)','p_job_id'),
      ('public.production_operator_action(uuid,text,text,text,numeric,numeric,numeric)','p_job_id'),
      ('public.set_production_dispatch_lock(uuid,boolean)','p_job_id'),
      ('public.sync_order_status_from_production(uuid)','p_job_id'),
      ('public.transition_production_job(uuid,text)','p_job_id')
    ) as x(signature,id_expr)
  loop
    v_oid:=to_regprocedure(r.signature);
    if v_oid is null then raise exception 'RPC_NOT_FOUND:%',r.signature; end if;
    select pg_get_functiondef(v_oid) into v_def;

    if v_def ilike '%private.assert_production_job_tenant(%' then continue; end if;

    v_guard:=format(E'\nbegin\n  perform private.assert_production_job_tenant(%s);\n',r.id_expr);
    v_def:=case
      when v_def like E'%\nbegin\n%' then regexp_replace(v_def,E'\nbegin\n',v_guard)
      else regexp_replace(v_def,' begin ',v_guard)
    end;

    if v_def not ilike '%private.assert_production_job_tenant(%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:%',r.signature;
    end if;

    execute v_def;
  end loop;
end;
$$;

-- configure_production_job: validate every cross-table input.
do $$
declare
  v_oid oid:=to_regprocedure('public.configure_production_job(uuid,uuid,uuid,text,numeric,numeric,numeric,uuid,numeric)');
  v_def text;
  v_guard text:=E'\nbegin\n  perform private.assert_production_job_tenant(p_job_id);\n  if p_equipment_id is not null then perform private.assert_equipment_asset_tenant(p_equipment_id); end if;\n  if p_order_item_id is not null then perform private.assert_order_item_tenant(p_order_item_id); end if;\n  if p_primary_material_id is not null then perform private.assert_catalog_item_tenant(p_primary_material_id); end if;\n';
begin
  if v_oid is null then raise exception 'RPC_NOT_FOUND:configure_production_job'; end if;
  select pg_get_functiondef(v_oid) into v_def;

  if v_def not ilike '%private.assert_production_job_tenant(p_job_id)%' then
    v_def:=case
      when v_def like E'%\nbegin\n%' then regexp_replace(v_def,E'\nbegin\n',v_guard)
      else regexp_replace(v_def,' begin ',v_guard)
    end;
    if v_def not ilike '%private.assert_production_job_tenant(p_job_id)%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:configure_production_job';
    end if;
    execute v_def;
  end if;
end;
$$;

-- Dispatch slot wrapper: job tenant plus explicit preferred equipment tenant.
do $$
declare
  v_oid oid:=to_regprocedure('public.production_find_dispatch_slot(uuid,timestamp with time zone,uuid,date,integer)');
  v_def text;
  v_guard text:=E'\nbegin\n  perform private.assert_production_job_tenant(p_job_id);\n  if p_preferred_equipment_id is not null then perform private.assert_equipment_asset_tenant(p_preferred_equipment_id); end if;\n';
begin
  if v_oid is null then raise exception 'RPC_NOT_FOUND:production_find_dispatch_slot'; end if;
  select pg_get_functiondef(v_oid) into v_def;

  if v_def not ilike '%private.assert_production_job_tenant(p_job_id)%' then
    v_def:=regexp_replace(v_def,E'\nbegin\n',v_guard);
    if v_def not ilike '%private.assert_production_job_tenant(p_job_id)%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:production_find_dispatch_slot';
    end if;
    execute v_def;
  end if;
end;
$$;

-- Internal dispatcher: always scope machine/capability candidates to the job organization,
-- including service-role/background planning where auth.uid() is absent.
do $$
declare
  v_oid oid:=to_regprocedure('public.production_find_dispatch_slot_internal(uuid,timestamp with time zone,uuid,date,integer)');
  v_def text;
begin
  if v_oid is null then raise exception 'RPC_NOT_FOUND:production_find_dispatch_slot_internal'; end if;
  select pg_get_functiondef(v_oid) into v_def;

  if v_def not ilike '%e.organization_id=v_job.organization_id%' then
    v_def:=replace(
      v_def,
      'where e.status<>''WRITTEN_OFF''',
      'where e.organization_id=v_job.organization_id and e.status<>''WRITTEN_OFF'''
    );
  end if;

  if v_def not ilike '%ea_scope.organization_id=v_job.organization_id%' then
    v_def:=replace(
      v_def,
      'and c.operation_type=v_job.operation_type',
      'and c.operation_type=v_job.operation_type and exists(select 1 from public.equipment_assets ea_scope where ea_scope.id=c.equipment_id and ea_scope.organization_id=v_job.organization_id)'
    );
  end if;

  if v_def not ilike '%e.organization_id=v_job.organization_id%'
     or v_def not ilike '%ea_scope.organization_id=v_job.organization_id%' then
    raise exception 'DISPATCH_SCOPE_PATCH_FAILED';
  end if;

  execute v_def;
end;
$$;

-- Internal scheduling entrypoint: authenticated callers inherited through wrappers must own the job.
do $$
declare
  v_oid oid:=to_regprocedure('public.production_schedule_job_internal(uuid,text,timestamp with time zone,uuid,date,boolean,boolean)');
  v_def text;
  v_guard text:=E'\nbegin\n  perform private.assert_production_job_tenant(p_job_id);\n';
begin
  if v_oid is null then raise exception 'RPC_NOT_FOUND:production_schedule_job_internal'; end if;
  select pg_get_functiondef(v_oid) into v_def;

  if v_def not ilike '%private.assert_production_job_tenant(p_job_id)%' then
    v_def:=regexp_replace(v_def,E'\nbegin\n',v_guard);
    if v_def not ilike '%private.assert_production_job_tenant(p_job_id)%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:production_schedule_job_internal';
    end if;
    execute v_def;
  end if;
end;
$$;

-- Manual scheduling: job and equipment must belong to the caller organization.
do $$
declare
  r record;
  v_oid oid;
  v_def text;
  v_guard text;
begin
  for r in
    select *
    from (values
      ('public.schedule_production_job(uuid,uuid,timestamp with time zone,timestamp with time zone)'),
      ('public.schedule_production_job_into_day(uuid,uuid,date)')
    ) as x(signature)
  loop
    v_oid:=to_regprocedure(r.signature);
    if v_oid is null then raise exception 'RPC_NOT_FOUND:%',r.signature; end if;
    select pg_get_functiondef(v_oid) into v_def;

    if v_def ilike '%private.assert_production_job_tenant(p_job_id)%' then continue; end if;

    v_guard:=E'\nbegin\n  perform private.assert_production_job_tenant(p_job_id);\n  if p_equipment_id is not null then perform private.assert_equipment_asset_tenant(p_equipment_id); end if;\n';
    v_def:=case
      when v_def like E'%\nbegin\n%' then regexp_replace(v_def,E'\nbegin\n',v_guard)
      else regexp_replace(v_def,' begin ',v_guard)
    end;

    if v_def not ilike '%private.assert_production_job_tenant(p_job_id)%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:%',r.signature;
    end if;

    execute v_def;
  end loop;
end;
$$;

-- Material actions/plans: job, material and warehouse scope.
do $$
declare
  r record;
  v_oid oid;
  v_def text;
  v_guard text;
begin
  for r in
    select *
    from (values
      ('public.production_material_action(uuid,uuid,text,numeric,uuid,text)'),
      ('public.save_production_job_material_plan(uuid,uuid,numeric,uuid,text)')
    ) as x(signature)
  loop
    v_oid:=to_regprocedure(r.signature);
    if v_oid is null then raise exception 'RPC_NOT_FOUND:%',r.signature; end if;
    select pg_get_functiondef(v_oid) into v_def;

    if v_def ilike '%private.assert_catalog_item_tenant(p_catalog_item_id)%' then continue; end if;

    v_guard:=E'\nbegin\n  perform private.assert_production_job_tenant(p_job_id);\n  perform private.assert_catalog_item_tenant(p_catalog_item_id);\n  if p_warehouse_id is not null then perform private.assert_warehouse_tenant(p_warehouse_id); end if;\n';
    v_def:=case
      when v_def like E'%\nbegin\n%' then regexp_replace(v_def,E'\nbegin\n',v_guard)
      else regexp_replace(v_def,' begin ',v_guard)
    end;

    -- Make implicit/default warehouse selection tenant-aware.
    v_def:=replace(
      v_def,
      'from public.warehouses where is_active order by created_at limit 1',
      'from public.warehouses where is_active and (auth.uid() is null or is_shared or organization_id=public.current_user_organization_id()) order by is_shared desc,created_at limit 1'
    );

    if v_def not ilike '%private.assert_catalog_item_tenant(p_catalog_item_id)%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:%',r.signature;
    end if;

    execute v_def;
  end loop;
end;
$$;

-- Catalog cost update is tenant-bound.
do $$
declare
  v_oid oid:=to_regprocedure('public.set_production_material_cost(uuid,numeric)');
  v_def text;
  v_guard text:=E'\nbegin\n  perform private.assert_catalog_item_tenant(p_catalog_item_id);\n';
begin
  if v_oid is null then raise exception 'RPC_NOT_FOUND:set_production_material_cost'; end if;
  select pg_get_functiondef(v_oid) into v_def;

  if v_def not ilike '%private.assert_catalog_item_tenant(p_catalog_item_id)%' then
    v_def:=case
      when v_def like E'%\nbegin\n%' then regexp_replace(v_def,E'\nbegin\n',v_guard)
      else regexp_replace(v_def,' begin ',v_guard)
    end;
    if v_def not ilike '%private.assert_catalog_item_tenant(p_catalog_item_id)%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:set_production_material_cost';
    end if;
    execute v_def;
  end if;
end;
$$;

-- Queue-wide dispatch must only iterate the caller tenant for authenticated staff.
do $$
declare
  v_oid oid:=to_regprocedure('public.auto_dispatch_production_queue(integer)');
  v_def text;
begin
  if v_oid is null then raise exception 'RPC_NOT_FOUND:auto_dispatch_production_queue'; end if;
  select pg_get_functiondef(v_oid) into v_def;

  if v_def not ilike '%j.organization_id=public.current_user_organization_id()%' then
    v_def:=replace(
      v_def,
      'where j.status in (''NEW'',''QUEUED'',''PAUSED'')',
      'where (auth.uid() is null or j.organization_id=public.current_user_organization_id()) and j.status in (''NEW'',''QUEUED'',''PAUSED'')'
    );
  end if;

  if v_def not ilike '%j.organization_id=public.current_user_organization_id()%' then
    raise exception 'AUTO_DISPATCH_QUEUE_SCOPE_PATCH_FAILED';
  end if;

  execute v_def;
end;
$$;

-- Read analytics verified under both A4PRINT and 3DARTPRINT as SECURITY INVOKER.
alter function public.production_analytics_summary(date,date) security invoker;
alter function public.production_downtime_pareto(date,date) security invoker;
