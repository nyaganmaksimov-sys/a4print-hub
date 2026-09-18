-- PHASE 2 CORE MULTI-COMPANY
-- Early tenant guards for equipment amendment/termination SECURITY DEFINER RPCs.

create schema if not exists private;

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

  -- Preserve trusted service/background execution.
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
      ('public.apply_equipment_contract_amendment(uuid)','AMENDMENT','p_amendment_id'),
      ('public.approve_equipment_contract_amendment(uuid,text)','AMENDMENT','p_amendment_id'),
      ('public.cancel_equipment_contract_amendment(uuid,text)','AMENDMENT','p_amendment_id'),
      ('public.get_equipment_contract_amendment_document(uuid)','AMENDMENT','p_amendment_id'),
      ('public.mark_equipment_contract_amendment_signed(uuid,text)','AMENDMENT','p_amendment_id'),
      ('public.record_equipment_contract_amendment_signature(uuid,text,text,text)','AMENDMENT','p_amendment_id'),
      ('public.finalize_equipment_contract_termination(uuid,text,text,uuid,text)','TERMINATION','p_termination_id'),
      ('public.get_equipment_contract_termination_condition_preflight(uuid)','TERMINATION','p_termination_id'),
      ('public.notify_equipment_contract_termination(uuid,text)','TERMINATION','p_termination_id'),
      ('public.set_equipment_contract_termination_status(uuid,text,text)','TERMINATION','p_termination_id')
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
