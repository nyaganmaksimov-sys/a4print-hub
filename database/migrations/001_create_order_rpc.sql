-- Transactional order creation used by the API.
-- Apply after database/schema.sql.

create or replace function public.create_order_from_api(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
  v_model_id uuid;
  v_order_id uuid;
  v_order_number bigint;
  v_item jsonb;
  v_item_total numeric(12,2);
  v_total numeric(12,2);
  v_business_unit business_unit;
  v_status order_status;
begin
  if payload->>'business_unit' is null then
    raise exception 'business_unit is required';
  end if;

  v_business_unit := (payload->>'business_unit')::business_unit;
  v_total := coalesce((payload->>'total')::numeric, 0);

  if v_total < 0 then
    raise exception 'total cannot be negative';
  end if;

  -- Reuse a customer by email first, then phone.
  if nullif(payload->'customer'->>'email', '') is not null then
    select id into v_customer_id
    from customers
    where lower(email) = lower(payload->'customer'->>'email')
    order by created_at
    limit 1;
  end if;

  if v_customer_id is null and nullif(payload->'customer'->>'phone', '') is not null then
    select id into v_customer_id
    from customers
    where phone = payload->'customer'->>'phone'
    order by created_at
    limit 1;
  end if;

  if v_customer_id is null and nullif(payload->'customer'->>'full_name', '') is not null then
    insert into customers(full_name, email, phone)
    values (
      payload->'customer'->>'full_name',
      nullif(payload->'customer'->>'email', ''),
      nullif(payload->'customer'->>'phone', '')
    )
    returning id into v_customer_id;
  elsif v_customer_id is not null then
    update customers
    set full_name = coalesce(nullif(payload->'customer'->>'full_name', ''), full_name),
        email = coalesce(nullif(payload->'customer'->>'email', ''), email),
        phone = coalesce(nullif(payload->'customer'->>'phone', ''), phone),
        updated_at = now()
    where id = v_customer_id;
  end if;

  if nullif(payload->'model'->>'source_url', '') is not null then
    insert into models_3d(name, source_url, source_name)
    values (
      coalesce(nullif(payload->'model'->>'name', ''), 'Модель из заказа'),
      payload->'model'->>'source_url',
      nullif(payload->'model'->>'source_name', '')
    )
    returning id into v_model_id;
  end if;

  insert into orders(
    business_unit,
    customer_id,
    status,
    total,
    customer_comment,
    source,
    model_id,
    model_name,
    model_url
  )
  values (
    v_business_unit,
    v_customer_id,
    'NEW',
    v_total,
    nullif(payload->>'comment', ''),
    nullif(payload->>'source', ''),
    v_model_id,
    nullif(payload->'model'->>'name', ''),
    nullif(payload->'model'->>'source_url', '')
  )
  returning id, order_number, status into v_order_id, v_order_number, v_status;

  for v_item in select value from jsonb_array_elements(coalesce(payload->'items', '[]'::jsonb)) loop
    v_item_total := coalesce((v_item->>'total_price')::numeric,
                             (v_item->>'quantity')::numeric * (v_item->>'unit_price')::numeric,
                             0);

    insert into order_items(
      order_id,
      product_id,
      service_id,
      name,
      quantity,
      unit_price,
      total_price,
      parameters
    )
    values (
      v_order_id,
      nullif(v_item->>'product_id', '')::uuid,
      nullif(v_item->>'service_id', '')::uuid,
      coalesce(nullif(v_item->>'name', ''), 'Позиция заказа'),
      coalesce((v_item->>'quantity')::numeric, 1),
      coalesce((v_item->>'unit_price')::numeric, 0),
      v_item_total,
      coalesce(v_item->'parameters', '{}'::jsonb)
    );
  end loop;

  insert into order_status_history(order_id, old_status, new_status, comment)
  values (v_order_id, null, 'NEW', 'Заказ создан через API');

  return jsonb_build_object(
    'id', v_order_id,
    'order_number', v_order_number,
    'status', v_status
  );
end;
$$;

revoke all on function public.create_order_from_api(jsonb) from public;
