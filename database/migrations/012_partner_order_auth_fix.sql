-- A4PRINT HUB: Partner order auth fix
-- Run after 011_partner_order_quote_fix.sql.
-- The portal already knows its partner_user.id after an RLS-protected lookup.
-- This RPC validates that id against the current auth.uid() before creating the order.

create or replace function public.create_partner_order_v2(
  p_partner_user_id uuid,
  p_service_id uuid,
  p_quantity numeric,
  p_customer_comment text default null,
  p_parameters jsonb default '{}'::jsonb,
  p_requested_total numeric default 0
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_partner_user public.partner_users%rowtype;
  v_partner public.partners%rowtype;
  v_service public.partner_services%rowtype;
  v_order_id uuid;
  v_price numeric(14,2);
  v_total numeric(14,2);
  v_parameters jsonb;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  select * into v_partner_user
  from public.partner_users
  where id=p_partner_user_id
    and auth_user_id=auth.uid()
    and is_active=true
  limit 1;

  if v_partner_user.id is null then
    raise exception 'PARTNER_ACCESS_REQUIRED';
  end if;

  select * into v_partner
  from public.partners
  where id=v_partner_user.partner_id
    and is_active=true
  limit 1;

  if v_partner.id is null then
    raise exception 'PARTNER_DISABLED';
  end if;

  select * into v_service
  from public.partner_services
  where id=p_service_id
    and is_active=true
  limit 1;

  if v_service.id is null then
    raise exception 'SERVICE_NOT_AVAILABLE';
  end if;

  if coalesce(p_quantity,0)<=0 then
    raise exception 'INVALID_QUANTITY';
  end if;

  select ppo.price into v_price
  from public.partner_price_overrides ppo
  where ppo.partner_id=v_partner.id
    and ppo.partner_service_id=v_service.id
  limit 1;

  v_price := coalesce(
    v_price,
    nullif(v_service.partner_price,0),
    nullif(v_service.base_price,0),
    0
  );

  v_total := v_price * p_quantity;

  v_parameters := coalesce(p_parameters,'{}'::jsonb)
    || jsonb_build_object(
      'partner_service_id',v_service.id,
      'partner_service_code',v_service.code,
      'category',v_service.category,
      'partner_requested_total',greatest(coalesce(p_requested_total,0),0)
    );

  insert into public.orders(
    business_unit,status,total,customer_comment,internal_comment,
    source,model_name,partner_id,partner_user_id
  )
  values(
    v_service.business_unit,'NEW',v_total,p_customer_comment,
    'Партнёрский заказ: '||v_partner.name,
    'PARTNER',v_service.name,v_partner.id,v_partner_user.id
  )
  returning id into v_order_id;

  insert into public.order_items(
    order_id,name,quantity,unit_price,total_price,parameters
  )
  values(
    v_order_id,v_service.name,p_quantity,v_price,v_total,v_parameters
  );

  return v_order_id;
end;
$$;

grant execute on function public.create_partner_order_v2(uuid,uuid,numeric,text,jsonb,numeric) to authenticated;
