-- PHASE 2 CORE MULTI-COMPANY
-- Early tenant guards for SECURITY DEFINER equipment contract action RPCs.
-- These guards prevent cross-tenant entity probing before business logic runs.
-- Service-role/background calls without auth.uid() remain supported.

create schema if not exists private;

create or replace function private.assert_equipment_contract_tenant(
  p_contract_id uuid,
  p_supplied_organization_id uuid default null
)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_contract_org uuid;
  v_current_org uuid;
begin
  if p_contract_id is null then
    return;
  end if;

  -- Preserve trusted service/background execution.
  if auth.uid() is null then
    return;
  end if;

  select c.organization_id
    into v_contract_org
  from public.equipment_contracts c
  where c.id=p_contract_id;

  v_current_org:=public.current_user_organization_id();

  if v_contract_org is null
     or v_current_org is null
     or v_contract_org<>v_current_org then
    raise exception 'EQUIPMENT_CONTRACT_NOT_AVAILABLE';
  end if;

  if p_supplied_organization_id is not null
     and p_supplied_organization_id<>v_contract_org then
    raise exception 'EQUIPMENT_CONTRACT_ORGANIZATION_MISMATCH';
  end if;
end;
$$;

revoke all on function private.assert_equipment_contract_tenant(uuid,uuid)
from public,anon,authenticated;

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
      ('public.complete_equipment_buyout(uuid,text,text)','p_contract_id',null::text),
      ('public.configure_equipment_lease_terms(uuid,numeric,numeric,numeric)','p_contract_id',null::text),
      ('public.create_equipment_contract_amendment(uuid,date,jsonb,text)','p_contract_id',null::text),
      ('public.generate_equipment_contract_document(uuid,text,uuid,uuid,text)','p_contract_id','p_hub_organization_id'),
      ('public.generate_equipment_lease_charge(uuid,date,date,text)','p_contract_id',null::text),
      ('public.generate_equipment_owner_settlement(uuid,date,date)','p_contract_id',null::text),
      ('public.record_equipment_buyout_payment(uuid,numeric,text)','p_contract_id',null::text),
      ('public.save_equipment_condition_inspection(uuid,uuid,uuid,text,uuid,date,text,numeric,text,text,jsonb,jsonb,text)','p_contract_id',null::text),
      ('public.save_equipment_contract(uuid,uuid,text,text,text,date,date,numeric,numeric,text,boolean,text,integer,text,integer,boolean,numeric,text,text,uuid[])','p_contract_id',null::text),
      ('public.start_equipment_contract_termination(uuid,date,text,text,boolean,text)','p_contract_id',null::text)
    ) as x(signature,contract_expr,organization_expr)
  loop
    v_oid:=to_regprocedure(r.signature);

    if v_oid is null then
      raise exception 'RPC_NOT_FOUND:%',r.signature;
    end if;

    select pg_get_functiondef(v_oid) into v_def;

    if v_def ilike '%private.assert_equipment_contract_tenant(%' then
      continue;
    end if;

    if r.organization_expr is null then
      v_guard:=format(
        E'\nbegin\n  perform private.assert_equipment_contract_tenant(%s);\n',
        r.contract_expr
      );
    else
      v_guard:=format(
        E'\nbegin\n  perform private.assert_equipment_contract_tenant(%s,%s);\n',
        r.contract_expr,
        r.organization_expr
      );
    end if;

    v_def:=regexp_replace(v_def,E'\nbegin\n',v_guard);

    if v_def not ilike '%private.assert_equipment_contract_tenant(%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:%',r.signature;
    end if;

    execute v_def;
  end loop;
end;
$$;
