-- A4PRINT HUB: Production Farm Phase 41 — persistent equipment/production security baseline.

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
  )
  select violation_code,function_signature,details
  from violations
  order by violation_code,function_signature
$$;

revoke all on function private.production_farm_security_baseline_violations()
from public,anon,authenticated;

create or replace function private.assert_production_farm_security_baseline()
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  v_count integer;
  v_sample text;
begin
  select count(*),
         string_agg(
           v.violation_code||':'||v.function_signature,
           '; ' order by v.violation_code,v.function_signature
         )
    into v_count,v_sample
  from private.production_farm_security_baseline_violations() v;

  if v_count>0 then
    raise exception 'PRODUCTION_FARM_SECURITY_BASELINE_FAILED:%:%',
      v_count,left(coalesce(v_sample,''),1500);
  end if;
end
$$;

revoke all on function private.assert_production_farm_security_baseline()
from public,anon,authenticated;

select private.assert_production_farm_security_baseline();
