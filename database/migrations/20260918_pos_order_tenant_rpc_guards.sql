-- PHASE 2 CORE MULTI-COMPANY
-- Tenant hardening for POS/HUB order SECURITY DEFINER RPCs.

create schema if not exists private;

create or replace function private.assert_order_tenant(
  p_order_id uuid,
  p_allow_common boolean default true
)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_org uuid;
  v_unit public.business_unit;
  v_current_org uuid;
begin
  if p_order_id is null then
    raise exception 'ORDER_NOT_AVAILABLE';
  end if;

  if auth.uid() is null then
    return;
  end if;

  select o.organization_id,o.business_unit
    into v_org,v_unit
  from public.orders o
  where o.id=p_order_id;

  v_current_org:=public.current_user_organization_id();

  if v_org=v_current_org then
    return;
  end if;

  if coalesce(p_allow_common,true)
     and v_org is null
     and v_unit='COMMON'::public.business_unit then
    return;
  end if;

  raise exception 'ORDER_NOT_AVAILABLE';
end;
$$;

revoke all on function private.assert_order_tenant(uuid,boolean)
from public,anon,authenticated;

create or replace function private.assert_customer_tenant(
  p_customer_id uuid
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
  if p_customer_id is null then
    return;
  end if;

  if auth.uid() is null then
    return;
  end if;

  select c.organization_id into v_org
  from public.customers c
  where c.id=p_customer_id;

  v_current_org:=public.current_user_organization_id();

  if v_org is null
     or v_current_org is null
     or v_org<>v_current_org then
    raise exception 'CUSTOMER_NOT_AVAILABLE';
  end if;
end;
$$;

revoke all on function private.assert_customer_tenant(uuid)
from public,anon,authenticated;

create or replace function private.assert_business_unit_tenant(
  p_business_unit text
)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_unit public.business_unit;
  v_current_org uuid;
  v_target_org uuid;
begin
  if nullif(btrim(coalesce(p_business_unit,'')),'') is null then
    return;
  end if;

  if auth.uid() is null then
    return;
  end if;

  begin
    v_unit:=btrim(p_business_unit)::public.business_unit;
  exception when others then
    raise exception 'INVALID_BUSINESS_UNIT';
  end;

  if v_unit='COMMON'::public.business_unit then
    return;
  end if;

  v_current_org:=public.current_user_organization_id();

  select o.id into v_target_org
  from public.organizations o
  where o.code=case
    when v_unit='A4_PRINT'::public.business_unit then 'A4PRINT'
    when v_unit='3D_ARTPRINT'::public.business_unit then '3DARTPRINT'
    else null
  end
  limit 1;

  if v_current_org is null
     or v_target_org is null
     or v_target_org<>v_current_org then
    raise exception 'BUSINESS_UNIT_NOT_AVAILABLE';
  end if;
end;
$$;

revoke all on function private.assert_business_unit_tenant(text)
from public,anon,authenticated;

-- Single POS order read.
do $$
declare
  v_oid oid:=to_regprocedure('public.get_pos_hub_order(uuid)');
  v_def text;
  v_guard text:=E'\nbegin\n  perform private.assert_order_tenant(p_order_id,true);\n';
begin
  if v_oid is null then raise exception 'RPC_NOT_FOUND:get_pos_hub_order'; end if;
  select pg_get_functiondef(v_oid) into v_def;

  if v_def not ilike '%private.assert_order_tenant(p_order_id,true)%' then
    v_def:=case
      when v_def like E'%\nbegin\n%' then regexp_replace(v_def,E'\nbegin\n',v_guard)
      else regexp_replace(v_def,' begin ',v_guard)
    end;
    if v_def not ilike '%private.assert_order_tenant(p_order_id,true)%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:get_pos_hub_order';
    end if;
    execute v_def;
  end if;
end;
$$;

-- POS order list: preserve COMMON shared orders but exclude other organizations.
do $$
declare
  v_oid oid:=to_regprocedure('public.get_pos_hub_orders(text,integer)');
  v_def text;
  v_filter text:=E'where ((o.organization_id=public.current_user_organization_id()) or (o.organization_id is null and o.business_unit=''COMMON''::public.business_unit))\n    and o.status<>''CANCELLED''';
begin
  if v_oid is null then raise exception 'RPC_NOT_FOUND:get_pos_hub_orders'; end if;
  select pg_get_functiondef(v_oid) into v_def;

  if v_def not ilike '%o.organization_id=public.current_user_organization_id()%' then
    v_def:=replace(
      v_def,
      'where o.status<>''CANCELLED''',
      v_filter
    );
  end if;

  if v_def not ilike '%o.organization_id=public.current_user_organization_id()%' then
    raise exception 'RPC_TENANT_FILTER_FAILED:get_pos_hub_orders';
  end if;

  execute v_def;
end;
$$;

-- HUB order edits: current tenant or COMMON source order; customer must belong to caller;
-- requested target business unit must be caller organization or COMMON.
do $$
declare
  r record;
  v_oid oid;
  v_def text;
  v_guard text:=E'\nbegin\n  perform private.assert_order_tenant(p_order_id,true);\n  perform private.assert_customer_tenant(p_customer_id);\n  perform private.assert_business_unit_tenant(p_business_unit);\n';
begin
  for r in
    select signature
    from (values
      ('public.update_hub_order_details(uuid,uuid,text,text,text,text,text,jsonb)'),
      ('public.update_hub_order_details_v2(uuid,uuid,text,text,text,text,text,timestamp with time zone,integer,text,jsonb)')
    ) as x(signature)
  loop
    v_oid:=to_regprocedure(r.signature);
    if v_oid is null then raise exception 'RPC_NOT_FOUND:%',r.signature; end if;
    select pg_get_functiondef(v_oid) into v_def;

    if v_def ilike '%private.assert_order_tenant(p_order_id,true)%' then
      continue;
    end if;

    v_def:=case
      when v_def like E'%\nbegin\n%' then regexp_replace(v_def,E'\nbegin\n',v_guard)
      else regexp_replace(v_def,' begin ',v_guard)
    end;

    if v_def not ilike '%private.assert_order_tenant(p_order_id,true)%'
       or v_def not ilike '%private.assert_customer_tenant(p_customer_id)%'
       or v_def not ilike '%private.assert_business_unit_tenant(p_business_unit)%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:%',r.signature;
    end if;

    execute v_def;
  end loop;
end;
$$;
