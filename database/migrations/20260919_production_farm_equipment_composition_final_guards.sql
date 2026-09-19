-- A4PRINT HUB: Production Farm Phase 42 follow-up — final composition guards.
-- Keeps current live security semantics when the base Phase 42 migration is applied on a clean environment.

do $$
declare
  v_oid oid;
  v_def text;
begin
  v_oid:=to_regprocedure(
    'public.create_equipment_composition_amendment(uuid,date,jsonb,jsonb,text)'
  );
  if v_oid is null then raise exception 'RPC_NOT_FOUND:create_equipment_composition_amendment'; end if;

  select pg_get_functiondef(v_oid) into v_def;

  if v_def not ilike '%private.assert_non_partner_staff_context(%' then
    v_def:=replace(
      v_def,
      'begin' || E'\n  perform private.assert_equipment_contract_tenant(p_contract_id);',
      'begin' || E'\n  perform private.assert_non_partner_staff_context();' ||
      E'\n  perform private.assert_equipment_contract_tenant(p_contract_id);'
    );
    execute v_def;
  end if;
end
$$;

do $$
declare
  v_oid oid;
  v_def text;
  v_old text;
  v_new text;
begin
  v_oid:=to_regprocedure(
    'public.save_equipment_contract(uuid,uuid,text,text,text,date,date,numeric,numeric,text,boolean,text,integer,text,integer,boolean,numeric,text,text,uuid[])'
  );
  if v_oid is null then raise exception 'RPC_NOT_FOUND:save_equipment_contract'; end if;

  select pg_get_functiondef(v_oid) into v_def;

  if v_def ilike '%private.assert_equipment_asset_tenant(v_equipment_id)%'
     and v_def ilike '%app.equipment_contract_initial_composition_save'',''0''%'
     and v_def not ilike '%on conflict(contract_id,equipment_id)%'
  then
    null;
  else
    v_old:=
      '  perform set_config(''app.equipment_contract_initial_composition_save'',''1'',true);'||
      E'\n  delete from public.equipment_contract_assets where contract_id=v_id;'||
      E'\n  foreach v_equipment_id in array coalesce(p_equipment_ids,''{}''::uuid[]) loop'||
      E'\n    if not exists(select 1 from public.equipment_assets a where a.id=v_equipment_id) then raise exception ''EQUIPMENT_NOT_FOUND: %'',v_equipment_id; end if;'||
      E'\n    insert into public.equipment_contract_assets(contract_id,equipment_id,starts_on,ends_on) values(v_id,v_equipment_id,p_starts_on,p_ends_on) on conflict(contract_id,equipment_id) do nothing;'||
      E'\n  end loop;'||
      E'\n  return v_id;';

    v_new:=
      '  perform set_config(''app.equipment_contract_initial_composition_save'',''1'',true);'||
      E'\n  delete from public.equipment_contract_assets where contract_id=v_id;'||
      E'\n  foreach v_equipment_id in array coalesce(p_equipment_ids,''{}''::uuid[]) loop'||
      E'\n    perform private.assert_equipment_asset_tenant(v_equipment_id);'||
      E'\n    insert into public.equipment_contract_assets(contract_id,equipment_id,starts_on,ends_on) values(v_id,v_equipment_id,p_starts_on,p_ends_on);'||
      E'\n  end loop;'||
      E'\n  perform set_config(''app.equipment_contract_initial_composition_save'',''0'',true);'||
      E'\n  return v_id;';

    if position(v_old in v_def)=0 then
      raise exception 'SAVE_CONTRACT_PERIOD_MODEL_PATCH_POINT_NOT_FOUND';
    end if;

    execute replace(v_def,v_old,v_new);
  end if;
end
$$;

select private.assert_production_farm_security_baseline();
