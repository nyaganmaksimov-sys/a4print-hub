-- PHASE 2 CORE MULTI-COMPANY
-- Final equipment SECURITY DEFINER tenant guards:
-- incident repairs, contract documents and partner disputes.

create schema if not exists private;

create or replace function private.assert_equipment_incident_tenant(
  p_incident_id uuid
)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_equipment_id uuid;
  v_equipment_org uuid;
  v_current_org uuid;
begin
  if p_incident_id is null then
    raise exception 'EQUIPMENT_INCIDENT_NOT_AVAILABLE';
  end if;

  if auth.uid() is null then
    return;
  end if;

  select i.equipment_id
    into v_equipment_id
  from public.equipment_incidents i
  where i.id=p_incident_id;

  if v_equipment_id is null then
    raise exception 'EQUIPMENT_INCIDENT_NOT_AVAILABLE';
  end if;

  select a.organization_id
    into v_equipment_org
  from public.equipment_assets a
  where a.id=v_equipment_id;

  v_current_org:=public.current_user_organization_id();

  if v_equipment_org is null
     or v_current_org is null
     or v_equipment_org<>v_current_org then
    raise exception 'EQUIPMENT_INCIDENT_NOT_AVAILABLE';
  end if;
end;
$$;

revoke all on function private.assert_equipment_incident_tenant(uuid)
from public,anon,authenticated;

create or replace function private.assert_equipment_contract_document_tenant(
  p_document_id uuid
)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_contract_id uuid;
begin
  if p_document_id is null then
    raise exception 'EQUIPMENT_CONTRACT_DOCUMENT_NOT_AVAILABLE';
  end if;

  if auth.uid() is null then
    return;
  end if;

  select dl.entity_id
    into v_contract_id
  from public.document_links dl
  where dl.document_id=p_document_id
    and dl.entity_type='EQUIPMENT_CONTRACT'
  order by dl.created_at
  limit 1;

  if v_contract_id is null then
    raise exception 'EQUIPMENT_CONTRACT_DOCUMENT_NOT_AVAILABLE';
  end if;

  perform private.assert_equipment_contract_tenant(v_contract_id);
end;
$$;

revoke all on function private.assert_equipment_contract_document_tenant(uuid)
from public,anon,authenticated;

create or replace function private.assert_equipment_partner_response_tenant(
  p_response_id uuid
)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_entity_type text;
  v_entity_id uuid;
begin
  if p_response_id is null then
    raise exception 'EQUIPMENT_PARTNER_RESPONSE_NOT_AVAILABLE';
  end if;

  if auth.uid() is null then
    return;
  end if;

  select r.entity_type,r.entity_id
    into v_entity_type,v_entity_id
  from public.equipment_partner_responses r
  where r.id=p_response_id;

  if v_entity_id is null then
    raise exception 'EQUIPMENT_PARTNER_RESPONSE_NOT_AVAILABLE';
  end if;

  if v_entity_type='OWNER_SETTLEMENT' then
    perform private.assert_equipment_contract_child_tenant('OWNER_SETTLEMENT',v_entity_id);
  elsif v_entity_type='LEASE_CHARGE' then
    perform private.assert_equipment_contract_child_tenant('LEASE_CHARGE',v_entity_id);
  elsif v_entity_type='CONTRACT_DOCUMENT' then
    perform private.assert_equipment_contract_document_tenant(v_entity_id);
  else
    raise exception 'EQUIPMENT_PARTNER_RESPONSE_NOT_AVAILABLE';
  end if;
end;
$$;

revoke all on function private.assert_equipment_partner_response_tenant(uuid)
from public,anon,authenticated;

-- Incident repair: validate both incident equipment tenant and optional contract tenant.
do $$
declare
  v_oid oid:=to_regprocedure('public.record_equipment_incident_repair(uuid,text,text,text,numeric,text,uuid,jsonb,text,boolean)');
  v_def text;
  v_guard text:=E'\nbegin\n  perform private.assert_equipment_incident_tenant(p_incident_id);\n  if p_contract_id is not null then\n    perform private.assert_equipment_contract_tenant(p_contract_id);\n  end if;\n';
begin
  if v_oid is null then
    raise exception 'RPC_NOT_FOUND:record_equipment_incident_repair';
  end if;

  select pg_get_functiondef(v_oid) into v_def;

  if v_def not ilike '%private.assert_equipment_incident_tenant(p_incident_id)%' then
    v_def:=regexp_replace(v_def,E'\nbegin\n',v_guard);

    if v_def not ilike '%private.assert_equipment_incident_tenant(p_incident_id)%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:record_equipment_incident_repair';
    end if;

    execute v_def;
  end if;
end;
$$;

-- Contract document status: resolve linked equipment contract before reading document state.
do $$
declare
  v_oid oid:=to_regprocedure('public.set_equipment_contract_document_status(uuid,text,text)');
  v_def text;
  v_guard text:=E'\nbegin\n  perform private.assert_equipment_contract_document_tenant(p_document_id);\n';
begin
  if v_oid is null then
    raise exception 'RPC_NOT_FOUND:set_equipment_contract_document_status';
  end if;

  select pg_get_functiondef(v_oid) into v_def;

  if v_def not ilike '%private.assert_equipment_contract_document_tenant(p_document_id)%' then
    v_def:=regexp_replace(v_def,E'\nbegin\n',v_guard);

    if v_def not ilike '%private.assert_equipment_contract_document_tenant(p_document_id)%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:set_equipment_contract_document_status';
    end if;

    execute v_def;
  end if;
end;
$$;

-- Staff dispute resolution: resolve the disputed entity back to its contract tenant.
do $$
declare
  v_oid oid:=to_regprocedure('public.resolve_equipment_partner_dispute(uuid,text)');
  v_def text;
  v_guard text:=E'\nbegin\n  perform private.assert_equipment_partner_response_tenant(p_response_id);\n';
begin
  if v_oid is null then
    raise exception 'RPC_NOT_FOUND:resolve_equipment_partner_dispute';
  end if;

  select pg_get_functiondef(v_oid) into v_def;

  if v_def not ilike '%private.assert_equipment_partner_response_tenant(p_response_id)%' then
    v_def:=regexp_replace(v_def,E'\nbegin\n',v_guard);

    if v_def not ilike '%private.assert_equipment_partner_response_tenant(p_response_id)%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:resolve_equipment_partner_dispute';
    end if;

    execute v_def;
  end if;
end;
$$;
