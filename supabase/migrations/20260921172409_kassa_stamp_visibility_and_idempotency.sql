create table if not exists private.kassa_special_order_requests(
  organization_id uuid not null references public.organizations(id) on delete cascade,
  operation_kind text not null,
  client_operation_id text not null,
  requested_by_auth_user_id uuid,
  order_id uuid references public.orders(id) on delete set null,
  response_json jsonb,
  created_at timestamptz not null default now(),
  primary key(organization_id,operation_kind,client_operation_id)
);

revoke all on private.kassa_special_order_requests from public;
revoke all on private.kassa_special_order_requests from anon;
revoke all on private.kassa_special_order_requests from authenticated;

create or replace function public.create_kassa_stamp_order_v2(
  p_client_operation_id text,
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
  v_claimed text;
  v_response jsonb;
  v_result jsonb;
begin
  if not (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('POS_OPERATOR')) then
    raise exception 'POS_ACCESS_REQUIRED';
  end if;

  if nullif(btrim(coalesce(p_client_operation_id,'')),'') is null
     or length(p_client_operation_id) > 160 then
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
    v_org,'STAMP',p_client_operation_id,auth.uid()
  )
  on conflict do nothing
  returning client_operation_id into v_claimed;

  if v_claimed is null then
    select r.response_json into v_response
    from private.kassa_special_order_requests r
    where r.organization_id=v_org
      and r.operation_kind='STAMP'
      and r.client_operation_id=p_client_operation_id;

    if v_response is null then
      raise exception 'STAMP_ORDER_REQUEST_IN_PROGRESS';
    end if;
    return v_response;
  end if;

  v_result:=public.create_kassa_stamp_order(p_customer,p_items,p_comment,p_due_at);

  update private.kassa_special_order_requests r
  set response_json=v_result,
      order_id=nullif(v_result->>'id','')::uuid
  where r.organization_id=v_org
    and r.operation_kind='STAMP'
    and r.client_operation_id=p_client_operation_id;

  return v_result;
end
$function$;

revoke all on function public.create_kassa_stamp_order_v2(text,jsonb,jsonb,text,timestamptz) from public;
revoke all on function public.create_kassa_stamp_order_v2(text,jsonb,jsonb,text,timestamptz) from anon;
grant execute on function public.create_kassa_stamp_order_v2(text,jsonb,jsonb,text,timestamptz) to authenticated;

create or replace function public.get_pos_hub_orders(p_query text default ''::text,p_limit integer default 50)
returns table(
  id uuid,
  order_number bigint,
  status public.order_status,
  total numeric,
  customer_id uuid,
  customer_name text,
  source text,
  created_at timestamptz,
  paid numeric,
  debt numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_org uuid;
begin
  if not (public.has_role('ADMIN') or public.has_role('POS_OPERATOR')) then
    raise exception 'POS_ACCESS_REQUIRED';
  end if;

  select o.id into v_org
  from public.organizations o
  where o.code='A4PRINT' and o.is_active=true
  limit 1;
  if v_org is null then raise exception 'A4PRINT_ORGANIZATION_REQUIRED'; end if;

  return query
  select o.id,o.order_number,o.status,o.total,o.customer_id,
         coalesce(nullif(c.company_name,''),nullif(c.full_name,''),'Клиент не указан') as customer_name,
         o.source,o.created_at,
         coalesce(sum(case when p.status='PAID' and p.payment_type='INCOME' then p.amount when p.status='PAID' and p.payment_type='REFUND' then -p.amount else 0 end),0)::numeric as paid,
         greatest(o.total-coalesce(sum(case when p.status='PAID' and p.payment_type='INCOME' then p.amount when p.status='PAID' and p.payment_type='REFUND' then -p.amount else 0 end),0),0)::numeric as debt
  from public.orders o
  left join public.customers c on c.id=o.customer_id
  left join public.payments p on p.order_id=o.id
  where o.organization_id=v_org
    and o.status<>'CANCELLED'
    and (
      coalesce(trim(p_query),'')=''
      or o.order_number::text ilike '%'||trim(p_query)||'%'
      or coalesce(c.full_name,'') ilike '%'||trim(p_query)||'%'
      or coalesce(c.company_name,'') ilike '%'||trim(p_query)||'%'
      or coalesce(c.phone,'') ilike '%'||trim(p_query)||'%'
      or coalesce(o.model_name,'') ilike '%'||trim(p_query)||'%'
    )
  group by o.id,c.company_name,c.full_name
  having greatest(o.total-coalesce(sum(case when p.status='PAID' and p.payment_type='INCOME' then p.amount when p.status='PAID' and p.payment_type='REFUND' then -p.amount else 0 end),0),0)>0
  order by o.created_at desc
  limit greatest(1,least(coalesce(p_limit,50),100));
end
$function$;

create or replace function public.get_pos_hub_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v jsonb;
  v_org uuid;
begin
  if not (public.has_role('ADMIN') or public.has_role('POS_OPERATOR')) then
    raise exception 'POS_ACCESS_REQUIRED';
  end if;

  select o.id into v_org
  from public.organizations o
  where o.code='A4PRINT' and o.is_active=true
  limit 1;
  if v_org is null then raise exception 'A4PRINT_ORGANIZATION_REQUIRED'; end if;

  if not exists(
    select 1 from public.orders o
    where o.id=p_order_id and o.organization_id=v_org
  ) then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  select jsonb_build_object(
    'id',o.id,'order_number',o.order_number,'status',o.status,'total',o.total,'customer_id',o.customer_id,
    'customer',case when c.id is null then null else jsonb_build_object('id',c.id,'full_name',c.full_name,'company_name',c.company_name,'phone',c.phone,'email',c.email) end,
    'source',o.source,'model_name',o.model_name,'created_at',o.created_at,
    'paid',coalesce((select sum(case when p.status='PAID' and p.payment_type='INCOME' then p.amount when p.status='PAID' and p.payment_type='REFUND' then -p.amount else 0 end) from public.payments p where p.order_id=o.id),0),
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'quantity',i.quantity,'unit_price',i.unit_price,'total_price',i.total_price,'parameters',i.parameters) order by i.id) from public.order_items i where i.order_id=o.id),'[]'::jsonb)
  ) into v
  from public.orders o
  left join public.customers c on c.id=o.customer_id
  where o.id=p_order_id and o.organization_id=v_org;

  if v is null then raise exception 'ORDER_NOT_FOUND'; end if;
  return v;
end
$function$;

revoke all on function public.get_pos_hub_orders(text,integer) from anon;
grant execute on function public.get_pos_hub_orders(text,integer) to authenticated;
revoke all on function public.get_pos_hub_order(uuid) from anon;
grant execute on function public.get_pos_hub_order(uuid) to authenticated;
