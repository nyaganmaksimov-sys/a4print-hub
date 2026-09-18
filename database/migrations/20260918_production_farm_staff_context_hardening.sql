-- A4PRINT HUB: Production Farm Phase 47 — staff-context hardening for equipment/production API.
-- Partner-linked accounts must not inherit staff-only API access from accidental staff permissions.

create or replace function private.assert_no_partner_context()
returns void
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  -- Preserve trusted/background execution.
  if auth.uid() is null then
    return;
  end if;

  if public.current_partner_id() is not null then
    raise exception 'STAFF_CONTEXT_REQUIRED';
  end if;
end
$$;

revoke all on function private.assert_no_partner_context()
from public,anon,authenticated;

-- Patch every current exposed PL/pgSQL staff API matching the security baseline:
-- permission-gated, equipment/production, authenticated SECURITY DEFINER,
-- not already partner-aware and not an owner get_my/response endpoint.
do $$
declare
  r record;
  v_def text;
  v_patched text;
begin
  for r in
    select p.oid,p.proname,pg_get_function_identity_arguments(p.oid) args
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    join pg_catalog.pg_language l on l.oid=p.prolang
    where n.nspname='public'
      and p.prosecdef
      and l.lanname='plpgsql'
      and has_function_privilege('authenticated',p.oid,'EXECUTE')
      and (p.proname ilike '%equipment%' or p.proname ilike '%production%')
      and position('has_permission' in pg_get_functiondef(p.oid))>0
      and position('current_partner_id' in pg_get_functiondef(p.oid))=0
      and position('assert_non_partner_staff_context' in pg_get_functiondef(p.oid))=0
      and position('assert_no_partner_context' in pg_get_functiondef(p.oid))=0
      and p.proname not like 'get_my_%'
      and p.proname not like 'submit_%partner%'
      and p.proname not like 'submit_equipment_condition_%_response'
    order by p.proname,pg_get_function_identity_arguments(p.oid)
  loop
    select pg_get_functiondef(r.oid) into v_def;

    v_patched:=regexp_replace(
      v_def,
      E'\\nbegin\\n',
      E'\\nbegin\\n  perform private.assert_no_partner_context();\\n',
      1,1,'i'
    );

    if v_patched=v_def then
      raise exception 'STAFF_CONTEXT_PATCH_POINT_NOT_FOUND:public.%(%)',r.proname,r.args;
    end if;

    execute v_patched;
  end loop;
end
$$;

-- This is the only staff API in the target set implemented as LANGUAGE SQL.
-- Convert it to PL/pgSQL so the same fail-fast context check runs before any query.
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
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  perform private.assert_no_partner_context();

  return query
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
  order by d.created_at desc;
end
$$;

revoke all on function public.get_equipment_risk_documents()
from public,anon,authenticated;
grant execute on function public.get_equipment_risk_documents()
to authenticated;

-- Extend the persistent Phase 41 baseline with partner-context/staff-API separation.
create or replace function private.production_farm_security_baseline_violations()
returns table(
  violation_code text,
  function_signature text,
  details text
)
language sql
stable
set search_path=''
as $$
  with scoped as (
    select
      p.oid,
      p.proname,
      pg_get_function_identity_arguments(p.oid) args,
      p.prosecdef,
      p.proconfig,
      pg_get_functiondef(p.oid) def,
      has_function_privilege('anon',p.oid,'EXECUTE') anon_execute,
      has_function_privilege('authenticated',p.oid,'EXECUTE') auth_execute,
      p.prorettype='pg_catalog.trigger'::regtype returns_trigger
    from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public'
      and p.prosecdef
      and (
        p.proname ilike '%equipment%'
        or p.proname ilike '%production%'
      )
  ),
  violations as (
    select
      'UNSAFE_SEARCH_PATH'::text violation_code,
      format('public.%I(%s)',proname,args) function_signature,
      coalesce(array_to_string(proconfig,','),'NO search_path configuration') details
    from scoped
    where not coalesce('search_path=""'=any(proconfig),false)

    union all

    select
      'ANON_SECURITY_DEFINER_EXECUTE',
      format('public.%I(%s)',proname,args),
      'anon role can execute SECURITY DEFINER function'
    from scoped
    where anon_execute

    union all

    select
      'INTERNAL_FUNCTION_CLIENT_EXECUTE',
      format('public.%I(%s)',proname,args),
      'internal/trigger SECURITY DEFINER is executable by authenticated'
    from scoped
    where auth_execute
      and (
        returns_trigger
        or proname ilike '%\_internal' escape '\'
        or proname ilike '%\_trigger' escape '\'
      )

    union all

    select
      'AUTH_RPC_WITHOUT_SCOPE_GUARD',
      format('public.%I(%s)',proname,args),
      'authenticated SECURITY DEFINER RPC has no recognized tenant/partner scope guard'
    from scoped
    where auth_execute
      and not (
        def ilike '%private.assert_%'
        or def ilike '%current_user_organization_id(%'
        or def ilike '%current_partner_id(%'
        or def ilike '%equipment_payment_contract_tenant_org(%'
        or def ilike '%equipment_condition_claim_financial_tenant_org(%'
      )

    union all

    select
      'PARTNER_CONTEXT_STAFF_API',
      format('public.%I(%s)',proname,args),
      'staff permission-gated RPC does not explicitly reject or handle partner context'
    from scoped
    where auth_execute
      and def ilike '%has_permission(%'
      and def not ilike '%current_partner_id(%'
      and def not ilike '%assert_non_partner_staff_context(%'
      and def not ilike '%assert_no_partner_context(%'
  )
  select violation_code,function_signature,details
  from violations
  order by violation_code,function_signature
$$;

select private.assert_production_farm_security_baseline();
