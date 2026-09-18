-- PHASE 2 CORE MULTI-COMPANY
-- Tenant hardening for equipment core SECURITY DEFINER RPCs.

create schema if not exists private;

create or replace function private.assert_equipment_asset_tenant(
  p_equipment_id uuid
)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_equipment_org uuid;
  v_current_org uuid;
begin
  if p_equipment_id is null then
    raise exception 'EQUIPMENT_NOT_AVAILABLE';
  end if;

  if auth.uid() is null then
    return;
  end if;

  select a.organization_id into v_equipment_org
  from public.equipment_assets a
  where a.id=p_equipment_id;

  v_current_org:=public.current_user_organization_id();

  if v_equipment_org is null
     or v_current_org is null
     or v_equipment_org<>v_current_org then
    raise exception 'EQUIPMENT_NOT_AVAILABLE';
  end if;
end;
$$;

revoke all on function private.assert_equipment_asset_tenant(uuid)
from public,anon,authenticated;

create or replace function private.assert_staff_user_tenant(
  p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_user_org uuid;
  v_current_org uuid;
begin
  if p_user_id is null then
    return;
  end if;

  if auth.uid() is null then
    return;
  end if;

  select ou.organization_id
    into v_user_org
  from public.users u
  join public.organization_units ou on ou.id=u.organization_unit_id
  where u.id=p_user_id
    and u.is_active=true;

  v_current_org:=public.current_user_organization_id();

  if v_user_org is null
     or v_current_org is null
     or v_user_org<>v_current_org then
    raise exception 'STAFF_USER_NOT_AVAILABLE';
  end if;
end;
$$;

revoke all on function private.assert_staff_user_tenant(uuid)
from public,anon,authenticated;

-- Keep previous contract-child entity types and add INSPECTION.
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
  elsif v_type='INSPECTION' then
    select i.contract_id into v_contract_id
    from public.equipment_condition_inspections i
    where i.id=p_entity_id;
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

create or replace function private.assert_equipment_inspection_file_tenant(
  p_file_id uuid
)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_inspection_id uuid;
begin
  if p_file_id is null then
    raise exception 'EQUIPMENT_INSPECTION_FILE_NOT_AVAILABLE';
  end if;

  if auth.uid() is null then
    return;
  end if;

  select f.inspection_id into v_inspection_id
  from public.equipment_condition_inspection_files f
  where f.id=p_file_id;

  if v_inspection_id is null then
    raise exception 'EQUIPMENT_INSPECTION_FILE_NOT_AVAILABLE';
  end if;

  perform private.assert_equipment_contract_child_tenant('INSPECTION',v_inspection_id);
end;
$$;

revoke all on function private.assert_equipment_inspection_file_tenant(uuid)
from public,anon,authenticated;

create or replace function private.assert_equipment_risk_entity_tenant(
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
  v_equipment_id uuid;
begin
  if p_entity_id is null then
    raise exception 'EQUIPMENT_RISK_ENTITY_NOT_AVAILABLE';
  end if;

  if auth.uid() is null then
    return;
  end if;

  if v_type='INSURANCE' then
    select p.equipment_id into v_equipment_id
    from public.equipment_insurance_policies p
    where p.id=p_entity_id;
  elsif v_type='IMPROVEMENT' then
    select i.equipment_id into v_equipment_id
    from public.equipment_improvements i
    where i.id=p_entity_id;
  else
    raise exception 'EQUIPMENT_RISK_ENTITY_NOT_AVAILABLE';
  end if;

  if v_equipment_id is null then
    raise exception 'EQUIPMENT_RISK_ENTITY_NOT_AVAILABLE';
  end if;

  perform private.assert_equipment_asset_tenant(v_equipment_id);
end;
$$;

revoke all on function private.assert_equipment_risk_entity_tenant(text,uuid)
from public,anon,authenticated;

-- Direct equipment-id RPCs.
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
      ('public.save_equipment_capacity(uuid,jsonb)','p_equipment_id'),
      ('public.save_equipment_ownership(uuid,text,uuid,text,integer,numeric,date,date,numeric,numeric,numeric,numeric,numeric,boolean,numeric,numeric,text)','p_equipment_id'),
      ('public.save_production_equipment_capabilities(uuid,text[])','p_equipment_id'),
      ('public.save_production_equipment_standard(uuid,text,numeric,numeric,text,boolean)','p_equipment_id')
    ) as x(signature,id_expr)
  loop
    v_oid:=to_regprocedure(r.signature);
    if v_oid is null then raise exception 'RPC_NOT_FOUND:%',r.signature; end if;

    select pg_get_functiondef(v_oid) into v_def;
    if v_def ilike '%private.assert_equipment_asset_tenant(%' then continue; end if;

    v_guard:=format(E'\nbegin\n  perform private.assert_equipment_asset_tenant(%s);\n',r.id_expr);
    v_def:=case
      when v_def like E'%\nbegin\n%' then regexp_replace(v_def,E'\nbegin\n',v_guard)
      else regexp_replace(v_def,' begin ',v_guard)
    end;

    if v_def not ilike '%private.assert_equipment_asset_tenant(%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:%',r.signature;
    end if;

    execute v_def;
  end loop;
end;
$$;

-- Incident creation: equipment tenant plus same-tenant responsible user.
do $$
declare
  v_oid oid:=to_regprocedure('public.report_equipment_incident(uuid,uuid,text,text,text,uuid)');
  v_def text;
  v_guard text:=E'\nbegin\n  perform private.assert_equipment_asset_tenant(p_equipment_id);\n  if p_responsible_user_id is not null then\n    perform private.assert_staff_user_tenant(p_responsible_user_id);\n  end if;\n';
begin
  if v_oid is null then raise exception 'RPC_NOT_FOUND:report_equipment_incident'; end if;
  select pg_get_functiondef(v_oid) into v_def;

  if v_def not ilike '%private.assert_equipment_asset_tenant(p_equipment_id)%' then
    v_def:=case
      when v_def like E'%\nbegin\n%' then regexp_replace(v_def,E'\nbegin\n',v_guard)
      else regexp_replace(v_def,' begin ',v_guard)
    end;
    if v_def not ilike '%private.assert_equipment_asset_tenant(p_equipment_id)%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:report_equipment_incident';
    end if;
    execute v_def;
  end if;
end;
$$;

-- Incident update/link: existing incident tenant.
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
      ('public.update_equipment_incident(uuid,text,uuid,text,text)','p_incident_id'),
      ('public.link_equipment_incident_document(uuid,uuid,text)','p_incident_id')
    ) as x(signature,id_expr)
  loop
    v_oid:=to_regprocedure(r.signature);
    if v_oid is null then raise exception 'RPC_NOT_FOUND:%',r.signature; end if;

    select pg_get_functiondef(v_oid) into v_def;
    if v_def ilike '%private.assert_equipment_incident_tenant(%' then continue; end if;

    if r.signature like 'public.update_equipment_incident%' then
      v_guard:=E'\nbegin\n  perform private.assert_equipment_incident_tenant(p_incident_id);\n  if p_responsible_user_id is not null then\n    perform private.assert_staff_user_tenant(p_responsible_user_id);\n  end if;\n';
    else
      v_guard:=E'\nbegin\n  perform private.assert_equipment_incident_tenant(p_incident_id);\n';
    end if;

    v_def:=case
      when v_def like E'%\nbegin\n%' then regexp_replace(v_def,E'\nbegin\n',v_guard)
      else regexp_replace(v_def,' begin ',v_guard)
    end;

    if v_def not ilike '%private.assert_equipment_incident_tenant(%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:%',r.signature;
    end if;

    execute v_def;
  end loop;
end;
$$;

-- Inspection actions/files.
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
      ('public.cancel_equipment_condition_inspection(uuid,text)','p_inspection_id'),
      ('public.complete_equipment_condition_inspection(uuid)','p_inspection_id'),
      ('public.register_equipment_condition_inspection_file(uuid,text,text,text,bigint,text,text)','p_inspection_id')
    ) as x(signature,id_expr)
  loop
    v_oid:=to_regprocedure(r.signature);
    if v_oid is null then raise exception 'RPC_NOT_FOUND:%',r.signature; end if;

    select pg_get_functiondef(v_oid) into v_def;
    if v_def ilike '%private.assert_equipment_contract_child_tenant(''INSPECTION''%' then continue; end if;

    v_guard:=format(
      E'\nbegin\n  perform private.assert_equipment_contract_child_tenant(''INSPECTION'',%s);\n',
      r.id_expr
    );
    v_def:=case
      when v_def like E'%\nbegin\n%' then regexp_replace(v_def,E'\nbegin\n',v_guard)
      else regexp_replace(v_def,' begin ',v_guard)
    end;

    if v_def not ilike '%private.assert_equipment_contract_child_tenant(''INSPECTION''%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:%',r.signature;
    end if;

    execute v_def;
  end loop;
end;
$$;

do $$
declare
  v_oid oid:=to_regprocedure('public.remove_equipment_condition_inspection_file(uuid)');
  v_def text;
  v_guard text:=E'\nbegin\n  perform private.assert_equipment_inspection_file_tenant(p_file_id);\n';
begin
  if v_oid is null then raise exception 'RPC_NOT_FOUND:remove_equipment_condition_inspection_file'; end if;
  select pg_get_functiondef(v_oid) into v_def;

  if v_def not ilike '%private.assert_equipment_inspection_file_tenant(p_file_id)%' then
    v_def:=case
      when v_def like E'%\nbegin\n%' then regexp_replace(v_def,E'\nbegin\n',v_guard)
      else regexp_replace(v_def,' begin ',v_guard)
    end;
    if v_def not ilike '%private.assert_equipment_inspection_file_tenant(p_file_id)%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:remove_equipment_condition_inspection_file';
    end if;
    execute v_def;
  end if;
end;
$$;

-- Risk document creation.
do $$
declare
  v_oid oid:=to_regprocedure('public.register_equipment_risk_document(text,uuid,text,text,bigint,text,text)');
  v_def text;
  v_guard text:=E'\nbegin\n  perform private.assert_equipment_risk_entity_tenant(p_entity_type,p_entity_id);\n';
begin
  if v_oid is null then raise exception 'RPC_NOT_FOUND:register_equipment_risk_document'; end if;
  select pg_get_functiondef(v_oid) into v_def;

  if v_def not ilike '%private.assert_equipment_risk_entity_tenant(p_entity_type,p_entity_id)%' then
    v_def:=case
      when v_def like E'%\nbegin\n%' then regexp_replace(v_def,E'\nbegin\n',v_guard)
      else regexp_replace(v_def,' begin ',v_guard)
    end;
    if v_def not ilike '%private.assert_equipment_risk_entity_tenant(p_entity_type,p_entity_id)%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:register_equipment_risk_document';
    end if;
    execute v_def;
  end if;
end;
$$;

-- Read-only aggregations verified to work with caller privileges and tenant RLS.
alter function public.list_equipment_condition_claim_candidates() security invoker;
alter function public.production_equipment_analytics(date,date) security invoker;

-- document_versions is intentionally not exposed to authenticated, so this read RPC
-- remains SECURITY DEFINER but explicitly filters to the current equipment tenant.
create or replace function public.get_equipment_risk_documents()
returns table(
  document_id uuid,
  entity_type text,
  entity_id uuid,
  equipment_id uuid,
  document_type_code text,
  title text,
  document_number text,
  document_status text,
  document_date date,
  notes text,
  file_name text,
  mime_type text,
  file_size bigint,
  storage_path text,
  created_at timestamptz
)
language sql
stable
security definer
set search_path to ''
as $function$
  select
    d.id,
    l.entity_type,
    l.entity_id,
    nullif(d.metadata->>'equipment_id','')::uuid,
    dt.code,
    d.title,
    d.document_number,
    d.status::text,
    d.issue_date,
    d.notes,
    v.file_name,
    v.mime_type,
    v.file_size,
    case
      when v.file_url like 'storage://hub-documents/%'
      then substr(v.file_url,length('storage://hub-documents/')+1)
      else null
    end,
    d.created_at
  from public.document_links l
  join public.documents d on d.id=l.document_id
  join public.document_types dt on dt.id=d.document_type_id
  left join lateral (
    select dv.file_name,dv.mime_type,dv.file_size,dv.file_url
    from public.document_versions dv
    where dv.document_id=d.id
    order by dv.version_number desc,dv.created_at desc
    limit 1
  ) v on true
  where public.has_permission('equipment.view')
    and l.entity_type in ('EQUIPMENT_INSURANCE_POLICY','EQUIPMENT_IMPROVEMENT')
    and exists (
      select 1
      from public.equipment_assets ea
      where ea.id=nullif(d.metadata->>'equipment_id','')::uuid
        and ea.organization_id=public.current_user_organization_id()
    )
  order by d.created_at desc
$function$;

-- Trigger functions do not need direct Data API execution.
revoke all on function public.audit_equipment_risk_record()
from public,anon,authenticated;
