alter table public.orders
  add column if not exists due_at timestamptz,
  add column if not exists deadline_remind_before_hours integer not null default 48,
  add column if not exists deadline_note text;

alter table public.orders drop constraint if exists orders_deadline_remind_before_hours_check;
alter table public.orders add constraint orders_deadline_remind_before_hours_check
  check (deadline_remind_before_hours between 0 and 720);

create index if not exists orders_due_at_idx on public.orders(due_at) where due_at is not null;

create or replace function public.update_hub_order_details_v2(
  p_order_id uuid,
  p_customer_id uuid,
  p_business_unit text,
  p_source text,
  p_model_name text,
  p_customer_comment text,
  p_internal_comment text,
  p_due_at timestamptz,
  p_deadline_remind_before_hours integer,
  p_deadline_note text,
  p_items jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_order public.orders%rowtype;
  v_unit public.business_unit;
  v_item jsonb;
  v_name text;
  v_qty numeric;
  v_price numeric;
  v_line_total numeric;
  v_total numeric := 0;
  v_count integer := 0;
  v_product_id uuid;
  v_service_id uuid;
  v_parameters jsonb;
  v_remind integer := coalesce(p_deadline_remind_before_hours,48);
begin
  if not (public.has_role('ADMIN') or public.has_role('MANAGER')) then
    raise exception 'ACCESS_DENIED';
  end if;

  select * into v_order from public.orders where id=p_order_id for update;
  if v_order.id is null then raise exception 'ORDER_NOT_FOUND'; end if;

  begin
    v_unit := coalesce(nullif(btrim(coalesce(p_business_unit,'')),''),v_order.business_unit::text)::public.business_unit;
  exception when others then
    raise exception 'INVALID_BUSINESS_UNIT';
  end;

  if p_customer_id is not null and not exists(select 1 from public.customers where id=p_customer_id) then
    raise exception 'CUSTOMER_NOT_FOUND';
  end if;
  if v_remind < 0 or v_remind > 720 then raise exception 'INVALID_REMINDER_HOURS'; end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items)=0 then
    raise exception 'ITEMS_REQUIRED';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_name := nullif(btrim(coalesce(v_item->>'name','')),'');
    if v_name is null then raise exception 'ITEM_NAME_REQUIRED'; end if;
    begin
      v_qty := coalesce((v_item->>'quantity')::numeric,0);
      v_price := coalesce((v_item->>'unit_price')::numeric,0);
    exception when others then
      raise exception 'INVALID_ITEM_NUMBER';
    end;
    if v_qty <= 0 then raise exception 'QUANTITY_MUST_BE_POSITIVE'; end if;
    if v_price < 0 then raise exception 'PRICE_CANNOT_BE_NEGATIVE'; end if;
    v_line_total := round(v_qty*v_price,2);
    v_total := v_total + v_line_total;
    v_count := v_count + 1;
  end loop;

  update public.orders
  set customer_id=p_customer_id,
      business_unit=v_unit,
      source=nullif(btrim(coalesce(p_source,'')),''),
      model_name=nullif(btrim(coalesce(p_model_name,'')),''),
      customer_comment=nullif(btrim(coalesce(p_customer_comment,'')),''),
      internal_comment=nullif(btrim(coalesce(p_internal_comment,'')),''),
      due_at=p_due_at,
      deadline_remind_before_hours=v_remind,
      deadline_note=nullif(btrim(coalesce(p_deadline_note,'')),''),
      total=round(v_total,2),
      updated_at=now()
  where id=p_order_id;

  delete from public.order_items where order_id=p_order_id;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_name := btrim(v_item->>'name');
    v_qty := (v_item->>'quantity')::numeric;
    v_price := (v_item->>'unit_price')::numeric;
    v_line_total := round(v_qty*v_price,2);
    begin v_product_id := nullif(v_item->>'product_id','')::uuid; exception when others then v_product_id := null; end;
    begin v_service_id := nullif(v_item->>'service_id','')::uuid; exception when others then v_service_id := null; end;
    v_parameters := case when jsonb_typeof(v_item->'parameters')='object' then v_item->'parameters' else '{}'::jsonb end;
    insert into public.order_items(order_id,product_id,service_id,name,quantity,unit_price,total_price,parameters)
    values(p_order_id,v_product_id,v_service_id,v_name,v_qty,v_price,v_line_total,coalesce(v_parameters,'{}'::jsonb));
  end loop;

  return jsonb_build_object('id',p_order_id,'total',round(v_total,2),'item_count',v_count,'due_at',p_due_at,'deadline_remind_before_hours',v_remind);
end;
$function$;

revoke all on function public.update_hub_order_details_v2(uuid,uuid,text,text,text,text,text,timestamptz,integer,text,jsonb) from public, anon;
grant execute on function public.update_hub_order_details_v2(uuid,uuid,text,text,text,text,text,timestamptz,integer,text,jsonb) to authenticated;
