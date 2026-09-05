create or replace function public.create_order_from_telegram(p_message_id uuid, p_business_unit text default 'A4_PRINT')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_msg public.telegram_messages%rowtype;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_number bigint;
  v_sender text;
  v_telegram text;
  v_unit business_unit;
begin
  select * into v_msg
  from public.telegram_messages
  where id = p_message_id
  for update;

  if not found then
    raise exception 'Telegram message not found';
  end if;

  if v_msg.linked_order_id is not null then
    select order_number into v_order_number from public.orders where id = v_msg.linked_order_id;
    return jsonb_build_object('id', v_msg.linked_order_id, 'order_number', v_order_number, 'already_created', true);
  end if;

  v_unit := case when upper(coalesce(p_business_unit, '')) = '3D_ARTPRINT' then '3D_ARTPRINT'::business_unit else 'A4_PRINT'::business_unit end;
  v_sender := nullif(trim(concat_ws(' ', v_msg.first_name, v_msg.last_name)), '');
  if v_sender is null then
    v_sender := case when nullif(v_msg.username, '') is not null then '@' || v_msg.username else 'Telegram ' || v_msg.chat_id::text end;
  end if;
  v_telegram := case when nullif(v_msg.username, '') is not null then '@' || v_msg.username else v_msg.chat_id::text end;

  select id into v_customer_id
  from public.customers
  where telegram = v_telegram
  order by created_at
  limit 1;

  if v_customer_id is null then
    insert into public.customers(full_name, customer_type, telegram, notes)
    values (v_sender, 'PERSON', v_telegram, 'Клиент создан из входящего сообщения Telegram')
    returning id into v_customer_id;
  end if;

  insert into public.orders(
    order_number,
    business_unit,
    customer_id,
    status,
    total,
    customer_comment,
    source
  ) values (
    nextval('public.orders_order_number_seq'),
    v_unit,
    v_customer_id,
    'NEW',
    0,
    concat_ws(E'\n', 'Заявка из Telegram', 'Telegram: ' || v_telegram, nullif(v_msg.message_text, '')),
    'TELEGRAM'
  ) returning id, order_number into v_order_id, v_order_number;

  insert into public.order_status_history(order_id, old_status, new_status, comment)
  values (v_order_id, null, 'NEW', 'Заявка создана из Telegram');

  update public.telegram_messages
  set status = 'ORDER_CREATED', linked_order_id = v_order_id, updated_at = now()
  where id = p_message_id;

  return jsonb_build_object('id', v_order_id, 'order_number', v_order_number, 'already_created', false);
end;
$$;

revoke all on function public.create_order_from_telegram(uuid,text) from public, anon, authenticated;
grant execute on function public.create_order_from_telegram(uuid,text) to service_role;
