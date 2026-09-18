-- PHASE 2 CORE MULTI-COMPANY
-- Tenant guard for creating organization departments.

create schema if not exists private;

create or replace function private.assert_organization_tenant(
  p_organization_id uuid
)
returns void
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_current_org uuid;
begin
  if p_organization_id is null then
    raise exception 'ORGANIZATION_NOT_AVAILABLE';
  end if;

  if auth.uid() is null then
    return;
  end if;

  v_current_org:=public.current_user_organization_id();

  if v_current_org is null or p_organization_id<>v_current_org then
    raise exception 'ORGANIZATION_NOT_AVAILABLE';
  end if;
end;
$$;

revoke all on function private.assert_organization_tenant(uuid)
from public,anon,authenticated;

do $$
declare
  v_oid oid:=to_regprocedure('public.admin_create_department(uuid,text,text)');
  v_def text;
  v_guard text:=E'\nbegin\n  perform private.assert_organization_tenant(p_organization_id);\n';
begin
  if v_oid is null then
    raise exception 'RPC_NOT_FOUND:admin_create_department';
  end if;

  select pg_get_functiondef(v_oid) into v_def;

  if v_def not ilike '%private.assert_organization_tenant(p_organization_id)%' then
    v_def:=regexp_replace(v_def,E'\nbegin\n',v_guard);

    if v_def not ilike '%private.assert_organization_tenant(p_organization_id)%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:admin_create_department';
    end if;

    execute v_def;
  end if;
end;
$$;
