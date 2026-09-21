do $$
begin
  if to_regprocedure('public.create_kassa_stamp_order_impl(jsonb,jsonb,text,timestamptz)') is null
     and to_regprocedure('public.create_kassa_stamp_order(jsonb,jsonb,text,timestamptz)') is not null then
    alter function public.create_kassa_stamp_order(jsonb,jsonb,text,timestamptz)
      rename to create_kassa_stamp_order_impl;
  end if;
end $$;

revoke all on function public.create_kassa_stamp_order_impl(jsonb,jsonb,text,timestamptz) from public;
revoke all on function public.create_kassa_stamp_order_impl(jsonb,jsonb,text,timestamptz) from anon;
revoke all on function public.create_kassa_stamp_order_impl(jsonb,jsonb,text,timestamptz) from authenticated;

create or replace function public.create_kassa_stamp_order(
  p_customer jsonb,
  p_items jsonb,
  p_comment text default null,
  p_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, private, auth
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
    coalesce(p_items,'[]'::jsonb)::text||'|'||
    coalesce(p_comment,'')||'|'||
    coalesce(p_due_at::text,'')
  );
  v_key:='auto:'||v_fingerprint;

  perform pg_advisory_xact_lock(hashtextextended(v_fingerprint,0));

  select r.response_json into v_response
  from private.kassa_special_order_requests r
  where r.organization_id=v_org
    and r.operation_kind='STAMP_AUTO'
    and r.client_operation_id=v_key
    and r.created_at>=now()-interval '2 minutes';

  if v_response is not null then
    return v_response;
  end if;

  delete from private.kassa_special_order_requests r
  where r.organization_id=v_org
    and r.operation_kind='STAMP_AUTO'
    and r.client_operation_id=v_key;

  insert into private.kassa_special_order_requests(
    organization_id,operation_kind,client_operation_id,requested_by_auth_user_id
  ) values(
    v_org,'STAMP_AUTO',v_key,auth.uid()
  );

  v_result:=public.create_kassa_stamp_order_impl(p_customer,p_items,p_comment,p_due_at);

  update private.kassa_special_order_requests r
  set response_json=v_result,
      order_id=nullif(v_result->>'id','')::uuid
  where r.organization_id=v_org
    and r.operation_kind='STAMP_AUTO'
    and r.client_operation_id=v_key;

  return v_result;
end
$function$;

revoke all on function public.create_kassa_stamp_order(jsonb,jsonb,text,timestamptz) from public;
revoke all on function public.create_kassa_stamp_order(jsonb,jsonb,text,timestamptz) from anon;
grant execute on function public.create_kassa_stamp_order(jsonb,jsonb,text,timestamptz) to authenticated;
