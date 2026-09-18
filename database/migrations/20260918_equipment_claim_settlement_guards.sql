-- PHASE 2 CORE MULTI-COMPANY
-- Extend child tenant guards to claims, comparisons and settlement entities.

create or replace function private.assert_equipment_contract_child_tenant(
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_type text:=upper(btrim(coalesce(p_entity_type,'')));
  v_contract_id uuid;
begin
  if p_entity_id is null then
    raise exception 'EQUIPMENT_CONTRACT_ENTITY_NOT_AVAILABLE';
  end if;

  if auth.uid() is null then
    return;
  end if;

  if v_type='AMENDMENT' then
    select a.contract_id into v_contract_id
    from public.equipment_contract_amendments a
    where a.id=p_entity_id;
  elsif v_type='TERMINATION' then
    select t.contract_id into v_contract_id
    from public.equipment_contract_terminations t
    where t.id=p_entity_id;
  elsif v_type='CLAIM' then
    select c.contract_id into v_contract_id
    from public.equipment_condition_claims c
    where c.id=p_entity_id;
  elsif v_type='COMPARISON' then
    select c.contract_id into v_contract_id
    from public.equipment_condition_comparisons c
    where c.id=p_entity_id;
  elsif v_type='LEASE_CHARGE' then
    select c.contract_id into v_contract_id
    from public.equipment_lease_charges c
    where c.id=p_entity_id;
  elsif v_type='OWNER_SETTLEMENT' then
    select s.contract_id into v_contract_id
    from public.equipment_owner_settlements s
    where s.id=p_entity_id;
  else
    raise exception 'EQUIPMENT_CONTRACT_ENTITY_TYPE_INVALID';
  end if;

  if v_contract_id is null then
    raise exception 'EQUIPMENT_CONTRACT_ENTITY_NOT_AVAILABLE';
  end if;

  perform private.assert_equipment_contract_tenant(v_contract_id);
end;
$$;

revoke all on function private.assert_equipment_contract_child_tenant(text,uuid)
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
      ('public.issue_equipment_condition_claim(uuid)','CLAIM','p_claim_id'),
      ('public.resolve_equipment_condition_claim(uuid,text,text,numeric,text)','CLAIM','p_claim_id'),
      ('public.resolve_equipment_condition_comparison(uuid,text,text)','COMPARISON','p_comparison_id'),
      ('public.set_equipment_lease_charge_status(uuid,text,text,text)','LEASE_CHARGE','p_charge_id')
    ) as x(signature,entity_type,id_expr)
  loop
    v_oid:=to_regprocedure(r.signature);

    if v_oid is null then
      raise exception 'RPC_NOT_FOUND:%',r.signature;
    end if;

    select pg_get_functiondef(v_oid) into v_def;

    if v_def ilike '%private.assert_equipment_contract_child_tenant(%' then
      continue;
    end if;

    v_guard:=format(
      E'\nbegin\n  perform private.assert_equipment_contract_child_tenant(%L,%s);\n',
      r.entity_type,
      r.id_expr
    );

    v_def:=regexp_replace(v_def,E'\nbegin\n',v_guard);

    if v_def not ilike '%private.assert_equipment_contract_child_tenant(%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:%',r.signature;
    end if;

    execute v_def;
  end loop;
end;
$$;

-- save_equipment_condition_claim can create a new claim from a comparison,
-- or edit an existing claim. Guard the comparison always and existing claim when supplied.
do $$
declare
  v_oid oid:=to_regprocedure('public.save_equipment_condition_claim(uuid,uuid,numeric,text,date,text,jsonb)');
  v_def text;
  v_guard text:=E'\nbegin\n  perform private.assert_equipment_contract_child_tenant(''COMPARISON'',p_comparison_id);\n  if p_claim_id is not null then\n    perform private.assert_equipment_contract_child_tenant(''CLAIM'',p_claim_id);\n  end if;\n';
begin
  if v_oid is null then
    raise exception 'RPC_NOT_FOUND:save_equipment_condition_claim';
  end if;

  select pg_get_functiondef(v_oid) into v_def;

  if v_def not ilike '%private.assert_equipment_contract_child_tenant(''COMPARISON'',p_comparison_id)%' then
    v_def:=regexp_replace(v_def,E'\nbegin\n',v_guard);

    if v_def not ilike '%private.assert_equipment_contract_child_tenant(''COMPARISON'',p_comparison_id)%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:save_equipment_condition_claim';
    end if;

    execute v_def;
  end if;
end;
$$;
