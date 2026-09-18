-- PHASE 2 CORE MULTI-COMPANY
-- Tenant guards for SECURITY DEFINER staff administration RPCs.

create schema if not exists private;

create or replace function private.assert_org_unit_tenant(
  p_organization_unit_id uuid
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
  if p_organization_unit_id is null then
    raise exception 'ORGANIZATION_UNIT_NOT_AVAILABLE';
  end if;

  if auth.uid() is null then
    return;
  end if;

  select ou.organization_id into v_org
  from public.organization_units ou
  where ou.id=p_organization_unit_id;

  v_current_org:=public.current_user_organization_id();

  if v_org is null
     or v_current_org is null
     or v_org<>v_current_org then
    raise exception 'ORGANIZATION_UNIT_NOT_AVAILABLE';
  end if;
end;
$$;

revoke all on function private.assert_org_unit_tenant(uuid)
from public,anon,authenticated;

create or replace function private.assert_staff_position_tenant(
  p_position_id uuid
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
  if p_position_id is null then
    raise exception 'STAFF_POSITION_NOT_AVAILABLE';
  end if;

  if auth.uid() is null then
    return;
  end if;

  select ou.organization_id
    into v_org
  from public.staff_positions sp
  join public.organization_units ou on ou.id=sp.organization_unit_id
  where sp.id=p_position_id;

  v_current_org:=public.current_user_organization_id();

  if v_org is null
     or v_current_org is null
     or v_org<>v_current_org then
    raise exception 'STAFF_POSITION_NOT_AVAILABLE';
  end if;
end;
$$;

revoke all on function private.assert_staff_position_tenant(uuid)
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
      (
        'public.admin_create_position(uuid,text,text)',
        E'\nbegin\n  perform private.assert_org_unit_tenant(p_department_id);\n'
      ),
      (
        'public.admin_update_department(uuid,text,text,boolean)',
        E'\nbegin\n  perform private.assert_org_unit_tenant(p_department_id);\n'
      ),
      (
        'public.admin_update_position(uuid,text,text,boolean)',
        E'\nbegin\n  perform private.assert_staff_position_tenant(p_position_id);\n'
      ),
      (
        'public.admin_set_staff_assignment(uuid,uuid,text)',
        E'\nbegin\n  perform private.assert_staff_user_tenant(p_user_id);\n  perform private.assert_org_unit_tenant(p_department_id);\n'
      ),
      (
        'public.admin_set_staff_assignment_v2(uuid,uuid,uuid)',
        E'\nbegin\n  perform private.assert_staff_user_tenant(p_user_id);\n  perform private.assert_org_unit_tenant(p_department_id);\n  perform private.assert_staff_position_tenant(p_position_id);\n'
      )
    ) as x(signature,guard_sql)
  loop
    v_oid:=to_regprocedure(r.signature);
    if v_oid is null then
      raise exception 'RPC_NOT_FOUND:%',r.signature;
    end if;

    select pg_get_functiondef(v_oid) into v_def;

    if v_def ilike '%private.assert_org_unit_tenant(%'
       or v_def ilike '%private.assert_staff_position_tenant(%'
       or v_def ilike '%private.assert_staff_user_tenant(%' then
      continue;
    end if;

    v_guard:=r.guard_sql;
    v_def:=case
      when v_def like E'%\nbegin\n%' then regexp_replace(v_def,E'\nbegin\n',v_guard)
      else regexp_replace(v_def,' begin ',v_guard)
    end;

    if v_def not ilike '%private.assert_%tenant(%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:%',r.signature;
    end if;

    execute v_def;
  end loop;
end;
$$;
