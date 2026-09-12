-- A4PRINT HUB: moderated deletion of manager-created orders.
-- Managers can request deletion only for orders they created. ADMIN approves/rejects.

alter table public.orders
  add column if not exists created_by uuid references public.users(id) on delete set null;

create index if not exists idx_orders_created_by on public.orders(created_by, created_at desc);

create table if not exists public.order_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  order_number bigint not null,
  order_total numeric(12,2) not null default 0,
  order_source text,
  order_status text,
  customer_name text,
  requested_by uuid not null references public.users(id) on delete restrict,
  requester_name text not null,
  requester_email text,
  reason text,
  status text not null default 'NEW' check (status in ('NEW','APPROVED','REJECTED')),
  reviewed_by uuid references public.users(id) on delete set null,
  reviewer_name text,
  reviewer_comment text,
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create unique index if not exists uq_order_deletion_requests_pending
  on public.order_deletion_requests(order_id)
  where status='NEW' and order_id is not null;
create index if not exists idx_order_deletion_requests_status_created
  on public.order_deletion_requests(status, created_at desc);
create index if not exists idx_order_deletion_requests_requested_by
  on public.order_deletion_requests(requested_by, created_at desc);

alter table public.order_deletion_requests enable row level security;
revoke insert, update, delete on public.order_deletion_requests from authenticated;
grant select on public.order_deletion_requests to authenticated;

drop policy if exists order_deletion_requests_select on public.order_deletion_requests;
create policy order_deletion_requests_select
on public.order_deletion_requests
for select
to authenticated
using (
  requested_by = (select u.id from public.users u where u.auth_user_id=auth.uid() limit 1)
  or public.has_role('ADMIN')
);

create or replace function public.request_order_deletion(
  p_order_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_user public.users;
  v_order public.orders;
  v_request public.order_deletion_requests;
  v_customer_name text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not (public.has_role('MANAGER') or public.has_role('ADMIN')) then raise exception 'ACCESS_DENIED'; end if;

  select * into v_user
  from public.users
  where auth_user_id=auth.uid() and is_active=true
  limit 1;
  if v_user.id is null then raise exception 'STAFF_PROFILE_REQUIRED'; end if;

  select * into v_order from public.orders where id=p_order_id;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;
  if upper(coalesce(v_order.source,''))='KASSA' then raise exception 'POS_ORDER_DELETE_FORBIDDEN'; end if;
  if v_order.created_by is null then raise exception 'ORDER_OWNER_UNKNOWN'; end if;
  if v_order.created_by <> v_user.id then raise exception 'ONLY_OWN_ORDER_CAN_BE_REQUESTED'; end if;

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
    jsonb_build_object('request_id',v_request.id,'order_number',v_order.order_number,'reason',v_request.reason));

  insert into public.notifications(user_id,title,body,type,entity_type,entity_id)
  select distinct ur.user_id,
    'Запрос на удаление заказа',
    'Менеджер '||v_user.full_name||' запросил удаление заказа №'||v_order.order_number::text,
    'ORDER_DELETE_REQUEST','ORDER_DELETE_REQUEST',v_request.id
  from public.user_roles ur
  join public.roles r on r.id=ur.role_id
  join public.users au on au.id=ur.user_id and au.is_active=true
  where r.name='ADMIN';

  return jsonb_build_object('id',v_request.id,'status',v_request.status,'already_pending',false);
end;
$$;

revoke all on function public.request_order_deletion(uuid,text) from public,anon;
grant execute on function public.request_order_deletion(uuid,text) to authenticated;

create or replace function public.moderate_order_deletion(
  p_request_id uuid,
  p_approve boolean,
  p_comment text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  v_admin public.users;
  v_request public.order_deletion_requests;
  v_order_id uuid;
  v_order_number bigint;
  v_deleted boolean := false;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_role('ADMIN') then raise exception 'ADMIN_REQUIRED'; end if;

  select * into v_admin
  from public.users
  where auth_user_id=auth.uid() and is_active=true
  limit 1;
  if v_admin.id is null then raise exception 'STAFF_PROFILE_REQUIRED'; end if;

  select * into v_request
  from public.order_deletion_requests
  where id=p_request_id
  for update;
  if v_request.id is null then raise exception 'REQUEST_NOT_FOUND'; end if;
  if v_request.status <> 'NEW' then raise exception 'REQUEST_ALREADY_REVIEWED'; end if;

  v_order_id := v_request.order_id;
  v_order_number := v_request.order_number;

  if p_approve then
    update public.order_deletion_requests
    set status='APPROVED',reviewed_by=v_admin.id,reviewer_name=v_admin.full_name,
        reviewer_comment=nullif(btrim(coalesce(p_comment,'')),''),reviewed_at=now()
    where id=p_request_id;

    if v_order_id is not null then
      delete from public.orders where id=v_order_id;
      v_deleted := found;
    end if;

    insert into public.activity_log(user_id,action,entity_type,entity_id,details)
    values(v_admin.id,'ORDER_DELETE_APPROVED','ORDER',v_order_id,
      jsonb_build_object('request_id',p_request_id,'order_number',v_order_number,'deleted',v_deleted,'comment',nullif(btrim(coalesce(p_comment,'')),'')));
  else
    update public.order_deletion_requests
    set status='REJECTED',reviewed_by=v_admin.id,reviewer_name=v_admin.full_name,
        reviewer_comment=nullif(btrim(coalesce(p_comment,'')),''),reviewed_at=now()
    where id=p_request_id;

    insert into public.activity_log(user_id,action,entity_type,entity_id,details)
    values(v_admin.id,'ORDER_DELETE_REJECTED','ORDER',v_order_id,
      jsonb_build_object('request_id',p_request_id,'order_number',v_order_number,'comment',nullif(btrim(coalesce(p_comment,'')),'')));
  end if;

  insert into public.notifications(user_id,title,body,type,entity_type,entity_id)
  values(
    v_request.requested_by,
    case when p_approve then 'Удаление заказа одобрено' else 'Удаление заказа отклонено' end,
    case when p_approve
      then 'Заказ №'||v_order_number::text||' удалён после модерации.'
      else 'Запрос на удаление заказа №'||v_order_number::text||' отклонён.'||case when nullif(btrim(coalesce(p_comment,'')),'') is not null then ' Комментарий: '||btrim(p_comment) else '' end
    end,
    case when p_approve then 'ORDER_DELETE_APPROVED' else 'ORDER_DELETE_REJECTED' end,
    'ORDER_DELETE_REQUEST',p_request_id
  );

  return jsonb_build_object('id',p_request_id,'status',case when p_approve then 'APPROVED' else 'REJECTED' end,'deleted',v_deleted,'order_number',v_order_number);
end;
$$;

revoke all on function public.moderate_order_deletion(uuid,boolean,text) from public,anon;
grant execute on function public.moderate_order_deletion(uuid,boolean,text) to authenticated;

create or replace function public.create_hub_manual_order(
  p_customer_id uuid,
  p_customer_name text,
  p_customer_phone text,
  p_business_unit text,
  p_item_name text,
  p_quantity numeric,
  p_unit_price numeric,
  p_comment text default null,
  p_source text default 'HUB_MANUAL'
)
returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_customer_id uuid := p_customer_id;
  v_order_id uuid;
  v_order_number bigint;
  v_unit public.business_unit;
  v_qty numeric := coalesce(p_quantity,1);
  v_price numeric := coalesce(p_unit_price,0);
  v_total numeric;
  v_user_id uuid;
begin
  if not (public.has_role('ADMIN') or public.has_role('MANAGER')) then raise exception 'ACCESS_DENIED'; end if;
  select id into v_user_id from public.users where auth_user_id=auth.uid() and is_active=true limit 1;
  if v_user_id is null then raise exception 'STAFF_PROFILE_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_item_name,'')),'') is null then raise exception 'ITEM_NAME_REQUIRED'; end if;
  if v_qty <= 0 then raise exception 'QUANTITY_MUST_BE_POSITIVE'; end if;
  if v_price < 0 then raise exception 'PRICE_CANNOT_BE_NEGATIVE'; end if;
  begin
    v_unit := coalesce(nullif(p_business_unit,''),'A4_PRINT')::public.business_unit;
  exception when others then
    raise exception 'INVALID_BUSINESS_UNIT';
  end;

  if v_customer_id is null and nullif(btrim(coalesce(p_customer_name,'')),'') is not null then
    if nullif(btrim(coalesce(p_customer_phone,'')),'') is not null then
      select id into v_customer_id from public.customers
      where phone=btrim(p_customer_phone) order by created_at limit 1;
    end if;
    if v_customer_id is null then
      insert into public.customers(full_name,phone)
      values(btrim(p_customer_name),nullif(btrim(coalesce(p_customer_phone,'')),''))
      returning id into v_customer_id;
    end if;
  end if;

  v_total := round(v_qty*v_price,2);
  insert into public.orders(business_unit,customer_id,created_by,status,total,customer_comment,source,partner_direction)
  values(v_unit,v_customer_id,v_user_id,'NEW',v_total,nullif(btrim(coalesce(p_comment,'')),''),nullif(btrim(coalesce(p_source,'')),''),'NONE')
  returning id,order_number into v_order_id,v_order_number;

  insert into public.order_items(order_id,name,quantity,unit_price,total_price,parameters)
  values(v_order_id,btrim(p_item_name),v_qty,v_price,v_total,'{}'::jsonb);

  insert into public.order_status_history(order_id,old_status,new_status,changed_by,comment)
  values(v_order_id,null,'NEW',v_user_id,'Заказ создан сотрудником HUB');

  return jsonb_build_object('id',v_order_id,'order_number',v_order_number,'total',v_total,'customer_id',v_customer_id,'created_by',v_user_id);
end;
$$;

revoke all on function public.create_hub_manual_order(uuid,text,text,text,text,numeric,numeric,text,text) from public,anon;
grant execute on function public.create_hub_manual_order(uuid,text,text,text,text,numeric,numeric,text,text) to authenticated;
