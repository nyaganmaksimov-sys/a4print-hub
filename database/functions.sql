-- Transactional API function for creating a customer + order + items.
-- Run after schema.sql in Supabase SQL Editor.

create or replace function create_order_from_api(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  customer_id uuid;
  order_id uuid;
  item jsonb;
  created_order orders%rowtype;
begin
  if payload is null then
    raise exception 'payload is required';
  end if;

  -- Reuse customer by email, then phone. Otherwise create a new card.
  select id into customer_id
  from customers
  where (nullif(payload->'customer'->>'email','') is not null and lower(email)=lower(payload->'customer'->>'email'))
     or (nullif(payload->'customer'->>'phone','') is not null and phone=payload->'customer'->>'phone')
  order by created_at asc
  limit 1;

  if customer_id is null then
    insert into customers(full_name, email, phone)
    values (
      coalesce(nullif(payload->'customer'->>'full_name',''), 'Клиент'),
      nullif(payload->'customer'->>'email',''),
      nullif(payload->'customer'->>'phone','')
    )
    returning id into customer_id;
  else
    update customers set
      full_name = coalesce(nullif(payload->'customer'->>'full_name',''), full_name),
      email = coalesce(nullif(payload->'customer'->>'email',''), email),
      phone = coalesce(nullif(payload->'customer'->>'phone',''), phone),
      updated_at = now()
    where id = customer_id;
  end if;

  insert into orders(
    business_unit, customer_id, total, customer_comment, source,
    model_name, model_url
  ) values (
    (payload->>'business_unit')::business_unit,
    customer_id,
    coalesce((payload->>'total')::numeric, 0),
    payload->>'comment',
    payload->>'source',
    payload->'model'->>'name',
    payload->'model'->>'source_url'
  ) returning * into created_order;

  order_id := created_order.id;

  if jsonb_typeof(payload->'items') = 'array' then
    for item in select * from jsonb_array_elements(payload->'items') loop
      insert into order_items(order_id, name, quantity, unit_price, total_price, parameters)
      values (
        order_id,
        coalesce(item->>'name', 'Позиция'),
        coalesce((item->>'quantity')::numeric, 1),
        coalesce((item->>'unit_price')::numeric, 0),
        coalesce((item->>'total_price')::numeric, (item->>'unit_price')::numeric * coalesce((item->>'quantity')::numeric, 1), 0),
        coalesce(item->'parameters', '{}'::jsonb)
      );
    end loop;
  end if;

  insert into order_status_history(order_id, old_status, new_status)
  values(order_id, null, 'NEW');

  return jsonb_build_object(
    'id', created_order.id,
    'order_number', created_order.order_number,
    'business_unit', created_order.business_unit,
    'status', created_order.status,
    'total', created_order.total,
    'model_name', created_order.model_name,
    'model_url', created_order.model_url,
    'created_at', created_order.created_at
  );
end;
$$;
