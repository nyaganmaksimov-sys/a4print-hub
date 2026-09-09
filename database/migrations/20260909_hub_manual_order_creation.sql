-- A4PRINT HUB: manual order creation from the Orders workspace.
-- Transactional and restricted to ADMIN / MANAGER through existing has_role().
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
begin
  if not (public.has_role('ADMIN') or public.has_role('MANAGER')) then
    raise exception 'ACCESS_DENIED';
  end if;
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
      select id into v_customer_id
      from public.customers
      where phone=btrim(p_customer_phone)
      order by created_at
      limit 1;
    end if;
    if v_customer_id is null then
      insert into public.customers(full_name,phone)
      values(btrim(p_customer_name),nullif(btrim(coalesce(p_customer_phone,'')),''))
      returning id into v_customer_id;
    end if;
  end if;

  v_total := round(v_qty*v_price,2);
  insert into public.orders(business_unit,customer_id,status,total,customer_comment,source,partner_direction)
  values(v_unit,v_customer_id,'NEW',v_total,nullif(btrim(coalesce(p_comment,'')),''),nullif(btrim(coalesce(p_source,'')),''),'NONE')
  returning id,order_number into v_order_id,v_order_number;

  insert into public.order_items(order_id,name,quantity,unit_price,total_price,parameters)
  values(v_order_id,btrim(p_item_name),v_qty,v_price,v_total,'{}'::jsonb);

  insert into public.order_status_history(order_id,old_status,new_status,comment)
  values(v_order_id,null,'NEW','Заказ создан сотрудником HUB');

  return jsonb_build_object('id',v_order_id,'order_number',v_order_number,'total',v_total,'customer_id',v_customer_id);
end;
$$;

revoke all on function public.create_hub_manual_order(uuid,text,text,text,text,numeric,numeric,text,text) from public,anon;
grant execute on function public.create_hub_manual_order(uuid,text,text,text,text,numeric,numeric,text,text) to authenticated;
