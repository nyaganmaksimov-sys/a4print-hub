-- PHASE 2 CORE MULTI-COMPANY
-- Tenant guard for SECURITY DEFINER expense reimbursement.

create schema if not exists private;

create or replace function private.assert_expense_tenant(
  p_expense_id uuid
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
  if p_expense_id is null then
    raise exception 'EXPENSE_NOT_AVAILABLE';
  end if;

  if auth.uid() is null then
    return;
  end if;

  select e.organization_id into v_org
  from public.expenses e
  where e.id=p_expense_id;

  v_current_org:=public.current_user_organization_id();

  if v_org is null
     or v_current_org is null
     or v_org<>v_current_org then
    raise exception 'EXPENSE_NOT_AVAILABLE';
  end if;
end;
$$;

revoke all on function private.assert_expense_tenant(uuid)
from public,anon,authenticated;

do $$
declare
  v_oid oid:=to_regprocedure('public.reimburse_expense(uuid)');
  v_def text;
  v_guard text:=E'\nbegin\n  perform private.assert_expense_tenant(p_expense_id);\n';
begin
  if v_oid is null then
    raise exception 'RPC_NOT_FOUND:reimburse_expense';
  end if;

  select pg_get_functiondef(v_oid) into v_def;

  if v_def not ilike '%private.assert_expense_tenant(p_expense_id)%' then
    v_def:=regexp_replace(v_def,E'\nbegin\n',v_guard);

    if v_def not ilike '%private.assert_expense_tenant(p_expense_id)%' then
      raise exception 'RPC_GUARD_INJECTION_FAILED:reimburse_expense';
    end if;

    execute v_def;
  end if;
end;
$$;
