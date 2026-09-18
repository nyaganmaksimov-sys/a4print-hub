-- A4PRINT HUB: Production Farm Phase 36 — equipment mutation tenant/search_path hardening.

do $$
declare
  v_oid oid;
  v_def text;
begin
  v_oid:=to_regprocedure('public.report_equipment_incident(uuid,uuid,text,text,text,uuid)');
  if v_oid is null then raise exception 'RPC_NOT_FOUND:report_equipment_incident'; end if;

  select pg_get_functiondef(v_oid) into v_def;

  if v_def not ilike '%private.assert_production_job_tenant(%' then
    v_def:=replace(
      v_def,
      '  perform private.assert_equipment_asset_tenant(p_equipment_id);',
      E'  perform private.assert_equipment_asset_tenant(p_equipment_id);\n  if p_production_job_id is not null then\n    perform private.assert_production_job_tenant(p_production_job_id);\n  end if;'
    );
    execute v_def;
  end if;
end
$$;

alter function public.link_equipment_incident_document(uuid,uuid,text)
  set search_path to '';

alter function public.record_equipment_incident_repair(uuid,text,text,text,numeric,text,uuid,jsonb,text,boolean)
  set search_path to '';

alter function public.report_equipment_incident(uuid,uuid,text,text,text,uuid)
  set search_path to '';

alter function public.save_equipment_capacity(uuid,jsonb)
  set search_path to '';

alter function public.save_equipment_ownership(uuid,text,uuid,text,integer,numeric,date,date,numeric,numeric,numeric,numeric,numeric,boolean,numeric,numeric,text)
  set search_path to '';

alter function public.save_production_equipment_capabilities(uuid,text[])
  set search_path to '';

alter function public.save_production_equipment_standard(uuid,text,numeric,numeric,text,boolean)
  set search_path to '';

alter function public.update_equipment_incident(uuid,text,uuid,text,text)
  set search_path to '';
