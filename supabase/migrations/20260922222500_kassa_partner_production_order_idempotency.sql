do $$
begin
  if to_regprocedure('public.create_kassa_partner_order_impl(jsonb,jsonb,text,timestamptz)') is null
     and to_regprocedure('public.create_kassa_partner_order(jsonb,jsonb,text,timestamptz)') is not null then
    alter function public.create_kassa_partner_order(jsonb,jsonb,text,timestamptz)
      rename to create_kassa_partner_order_impl;
  end if;

  if to_regprocedure('public.create_kassa_production_order_impl(jsonb,jsonb,text,timestamptz)') is null
     and to_regprocedure('public.create_kassa_production_order(jsonb,jsonb,text,timestamptz)') is not null then
    alter function public.create_kassa_production_order(jsonb,jsonb,text,timestamptz)
      rename to create_kassa_production_order_impl;
  end if;
end $$;

revoke all on function public.create_kassa_partner_order_impl(jsonb,jsonb,text,timestamptz) from public;
revoke all on function public.create_kassa_partner_order_impl(jsonb,jsonb,text,timestamptz) from anon;
revoke all on function public.create_kassa_partner_order_impl(jsonb,jsonb,text,timestamptz) from authenticated;

revoke all on function public.create_kassa_production_order_impl(jsonb,jsonb,text,timestamptz) from public;
revoke all on function public.create_kassa_production_order_impl(jsonb,jsonb,text,timestamptz) from anon;
revoke all on function public.create_kassa_production_order_impl(jsonb,jsonb,text,timestamptz) from authenticated;

create or replace function public.create_kassa_partner_order(
  p_customer jsonb,
  p_order jsonb,
  p_comment text default null,
  p_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org uuid;
  v_key text;
  v_fingerprint text;
  v_response jsonb;
  v_result jsonb;
begin
  if not (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('POS_OPERATOR')) then
    raise exception 'POS_ACCESS_REQUIRED';
  end if;

  select o.id into v_org
  from public.organizations o
  where o.code='A4PRINT' and o.is_active=true
  limit 1;
  if v_org is null then raise exception 'A4PRINT_ORGANIZATION_REQUIRED'; end if;

  v_fingerprint:=md5(
    coalesce(auth.uid()::text,'')||'|'||
    coalesce(p_customer,'{}'::jsonb)::text||'|'||
    coalesce(p_order,'{}'::jsonb)::text||'|'||
    coalesce(p_comment,'')||'|'||
    coalesce(p_due_at::text,'')
  );
  v_key:='auto:'||v_fingerprint;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_fingerprint,0));

  select r.response_json into v_response
  from private.kassa_special_order_requests r
  where r.organization_id=v_org
    and r.operation_kind='PARTNER_AUTO'
    and r.client_operation_id=v_key
    and r.created_at>=pg_catalog.now()-interval '2 minutes';

  if v_response is not null then
    return v_response;
  end if;

  delete from private.kassa_special_order_requests r
  where r.organization_id=v_org
    and r.operation_kind='PARTNER_AUTO'
    and r.client_operation_id=v_key;

  insert into private.kassa_special_order_requests(
    organization_id,operation_kind,client_operation_id,requested_by_auth_user_id
  ) values(
    v_org,'PARTNER_AUTO',v_key,auth.uid()
  );

  v_result:=public.create_kassa_partner_order_impl(p_customer,p_order,p_comment,p_due_at);

  update private.kassa_special_order_requests r
  set response_json=v_result,
      order_id=nullif(v_result->>'id','')::uuid
  where r.organization_id=v_org
    and r.operation_kind='PARTNER_AUTO'
    and r.client_operation_id=v_key;

  return v_result;
end
$function$;

create or replace function public.create_kassa_production_order(
  p_customer jsonb,
  p_order jsonb,
  p_comment text default null,
  p_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org uuid;
  v_key text;
  v_fingerprint text;
  v_response jsonb;
  v_result jsonb;
begin
  if not (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('POS_OPERATOR')) then
    raise exception 'POS_ACCESS_REQUIRED';
  end if;

  select o.id into v_org
  from public.organizations o
  where o.code='A4PRINT' and o.is_active=true
  limit 1;
  if v_org is null then raise exception 'A4PRINT_ORGANIZATION_REQUIRED'; end if;

  v_fingerprint:=md5(
    coalesce(auth.uid()::text,'')||'|'||
    coalesce(p_customer,'{}'::jsonb)::text||'|'||
    coalesce(p_order,'{}'::jsonb)::text||'|'||
    coalesce(p_comment,'')||'|'||
    coalesce(p_due_at::text,'')
  );
  v_key:='auto:'||v_fingerprint;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_fingerprint,0));

  select r.response_json into v_response
  from private.kassa_special_order_requests r
  where r.organization_id=v_org
    and r.operation_kind='PRODUCTION_AUTO'
    and r.client_operation_id=v_key
    and r.created_at>=pg_catalog.now()-interval '2 minutes';

  if v_response is not null then
    return v_response;
  end if;

  delete from private.kassa_special_order_requests r
  where r.organization_id=v_org
    and r.operation_kind='PRODUCTION_AUTO'
    and r.client_operation_id=v_key;

  insert into private.kassa_special_order_requests(
    organization_id,operation_kind,client_operation_id,requested_by_auth_user_id
  ) values(
    v_org,'PRODUCTION_AUTO',v_key,auth.uid()
  );

  v_result:=public.create_kassa_production_order_impl(p_customer,p_order,p_comment,p_due_at);

  update private.kassa_special_order_requests r
  set response_json=v_result,
      order_id=nullif(v_result->>'id','')::uuid
  where r.organization_id=v_org
    and r.operation_kind='PRODUCTION_AUTO'
    and r.client_operation_id=v_key;

  return v_result;
end
$function$;

create or replace function public.create_kassa_partner_order_v2(
  p_client_operation_id text,
  p_customer jsonb,
  p_order jsonb,
  p_comment text default null,
  p_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org uuid;
  v_claimed text;
  v_response jsonb;
  v_result jsonb;
begin
  if not (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('POS_OPERATOR')) then
    raise exception 'POS_ACCESS_REQUIRED';
  end if;

  if nullif(pg_catalog.btrim(coalesce(p_client_operation_id,'')),'') is null
     or pg_catalog.length(p_client_operation_id) > 160 then
    raise exception 'INVALID_CLIENT_OPERATION_ID';
  end if;

  select o.id into v_org
  from public.organizations o
  where o.code='A4PRINT' and o.is_active=true
  limit 1;
  if v_org is null then raise exception 'A4PRINT_ORGANIZATION_REQUIRED'; end if;

  insert into private.kassa_special_order_requests(
    organization_id,operation_kind,client_operation_id,requested_by_auth_user_id
  ) values(
    v_org,'PARTNER',p_client_operation_id,auth.uid()
  )
  on conflict do nothing
  returning client_operation_id into v_claimed;

  if v_claimed is null then
    select r.response_json into v_response
    from private.kassa_special_order_requests r
    where r.organization_id=v_org
      and r.operation_kind='PARTNER'
      and r.client_operation_id=p_client_operation_id;

    if v_response is null then
      raise exception 'PARTNER_ORDER_REQUEST_IN_PROGRESS';
    end if;
    return v_response;
  end if;

  v_result:=public.create_kassa_partner_order_impl(p_customer,p_order,p_comment,p_due_at);

  update private.kassa_special_order_requests r
  set response_json=v_result,
      order_id=nullif(v_result->>'id','')::uuid
  where r.organization_id=v_org
    and r.operation_kind='PARTNER'
    and r.client_operation_id=p_client_operation_id;

  return v_result;
end
$function$;

create or replace function public.create_kassa_production_order_v2(
  p_client_operation_id text,
  p_customer jsonb,
  p_order jsonb,
  p_comment text default null,
  p_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_org uuid;
  v_claimed text;
  v_response jsonb;
  v_result jsonb;
begin
  if not (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('POS_OPERATOR')) then
    raise exception 'POS_ACCESS_REQUIRED';
  end if;

  if nullif(pg_catalog.btrim(coalesce(p_client_operation_id,'')),'') is null
     or pg_catalog.length(p_client_operation_id) > 160 then
    raise exception 'INVALID_CLIENT_OPERATION_ID';
  end if;

  select o.id into v_org
  from public.organizations o
  where o.code='A4PRINT' and o.is_active=true
  limit 1;
  if v_org is null then raise exception 'A4PRINT_ORGANIZATION_REQUIRED'; end if;

  insert into private.kassa_special_order_requests(
    organization_id,operation_kind,client_operation_id,requested_by_auth_user_id
  ) values(
    v_org,'PRODUCTION',p_client_operation_id,auth.uid()
  )
  on conflict do nothing
  returning client_operation_id into v_claimed;

  if v_claimed is null then
    select r.response_json into v_response
    from private.kassa_special_order_requests r
    where r.organization_id=v_org
      and r.operation_kind='PRODUCTION'
      and r.client_operation_id=p_client_operation_id;

    if v_response is null then
      raise exception 'PRODUCTION_ORDER_REQUEST_IN_PROGRESS';
    end if;
    return v_response;
  end if;

  v_result:=public.create_kassa_production_order_impl(p_customer,p_order,p_comment,p_due_at);

  update private.kassa_special_order_requests r
  set response_json=v_result,
      order_id=nullif(v_result->>'id','')::uuid
  where r.organization_id=v_org
    and r.operation_kind='PRODUCTION'
    and r.client_operation_id=p_client_operation_id;

  return v_result;
end
$function$;

revoke all on function public.create_kassa_partner_order(jsonb,jsonb,text,timestamptz) from public;
revoke all on function public.create_kassa_partner_order(jsonb,jsonb,text,timestamptz) from anon;
grant execute on function public.create_kassa_partner_order(jsonb,jsonb,text,timestamptz) to authenticated;

revoke all on function public.create_kassa_production_order(jsonb,jsonb,text,timestamptz) from public;
revoke all on function public.create_kassa_production_order(jsonb,jsonb,text,timestamptz) from anon;
grant execute on function public.create_kassa_production_order(jsonb,jsonb,text,timestamptz) to authenticated;

revoke all on function public.create_kassa_partner_order_v2(text,jsonb,jsonb,text,timestamptz) from public;
revoke all on function public.create_kassa_partner_order_v2(text,jsonb,jsonb,text,timestamptz) from anon;
grant execute on function public.create_kassa_partner_order_v2(text,jsonb,jsonb,text,timestamptz) to authenticated;

revoke all on function public.create_kassa_production_order_v2(text,jsonb,jsonb,text,timestamptz) from public;
revoke all on function public.create_kassa_production_order_v2(text,jsonb,jsonb,text,timestamptz) from anon;
grant execute on function public.create_kassa_production_order_v2(text,jsonb,jsonb,text,timestamptz) to authenticated;
