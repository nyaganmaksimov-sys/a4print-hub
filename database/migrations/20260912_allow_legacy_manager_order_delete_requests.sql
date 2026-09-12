create or replace function public.request_order_deletion(p_order_id uuid, p_reason text default null::text)
returns jsonb
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_user public.users;
  v_order public.orders;
  v_request public.order_deletion_requests;
  v_customer_name text;
  v_is_admin boolean := false;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not (public.has_role('MANAGER') or public.has_role('ADMIN')) then raise exception 'ACCESS_DENIED'; end if;
  v_is_admin := public.has_role('ADMIN');

  select * into v_user
  from public.users
  where auth_user_id=auth.uid() and is_active=true
  limit 1;
  if v_user.id is null then raise exception 'STAFF_PROFILE_REQUIRED'; end if;

  select * into v_order from public.orders where id=p_order_id;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if upper(coalesce(v_order.source,''))='KASSA' then raise exception 'POS_ORDER_DELETE_FORBIDDEN'; end if;
  if upper(coalesce(v_order.partner_direction::text,'NONE'))<>'NONE'
     or v_order.partner_id is not null
     or v_order.fulfillment_partner_id is not null then
    raise exception 'PARTNER_ORDER_DELETE_FORBIDDEN';
  end if;

  if v_order.created_by is not null
     and v_order.created_by <> v_user.id
     and not v_is_admin then
    raise exception 'ONLY_OWN_ORDER_CAN_BE_REQUESTED';
  end if;

  select * into v_request
  from public.order_deletion_requests
  where order_id=p_order_id and status='NEW'
  order by created_at desc
  limit 1;
  if v_request.id is not null then
    return jsonb_build_object('id',v_request.id,'status',v_request.status,'already_pending',true);
  end if;

  select coalesce(c.company_name,c.full_name)
    into v_customer_name
  from public.customers c
  where c.id=v_order.customer_id;

  insert into public.order_deletion_requests(
    order_id,order_number,order_total,order_source,order_status,customer_name,
    requested_by,requester_name,requester_email,reason
  ) values (
    v_order.id,v_order.order_number,v_order.total,v_order.source,v_order.status::text,v_customer_name,
    v_user.id,v_user.full_name,v_user.email,nullif(btrim(coalesce(p_reason,'')),'')
  ) returning * into v_request;

  insert into public.activity_log(user_id,action,entity_type,entity_id,details)
  values(v_user.id,'ORDER_DELETE_REQUESTED','ORDER',v_order.id,
    jsonb_build_object(
      'request_id',v_request.id,
      'order_number',v_order.order_number,
      'reason',v_request.reason,
      'legacy_owner_unknown',v_order.created_by is null
    ));

  insert into public.notifications(user_id,title,body,type,entity_type,entity_id)
  select distinct ur.user_id,
    'Запрос на удаление заказа',
    'Менеджер '||v_user.full_name||' запросил удаление заказа №'||v_order.order_number::text,
    'ORDER_DELETE_REQUEST','ORDER_DELETE_REQUEST',v_request.id
  from public.user_roles ur
  join public.roles r on r.id=ur.role_id
  join public.users au on au.id=ur.user_id and au.is_active=true
  where r.name='ADMIN';

  return jsonb_build_object(
    'id',v_request.id,
    'status',v_request.status,
    'already_pending',false,
    'legacy_owner_unknown',v_order.created_by is null
  );
end;
$function$;

grant execute on function public.request_order_deletion(uuid,text) to authenticated;
