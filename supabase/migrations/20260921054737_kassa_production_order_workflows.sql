create or replace function public.create_kassa_production_order(
  p_customer jsonb,
  p_order jsonb,
  p_comment text default null,
  p_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_org uuid;
  v_staff uuid;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_number bigint;
  v_workflow text;
  v_business_unit public.business_unit;
  v_direction_title text;
  v_item_name text;
  v_qty numeric;
  v_price numeric;
  v_planned_unit_cost numeric;
  v_total numeric;
  v_planned_cost numeric;
  v_customer_type text;
  v_full_name text;
  v_company_name text;
  v_phone text;
  v_email text;
  v_inn text;
  v_parameters jsonb;
begin
  if not (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('POS_OPERATOR')) then
    raise exception 'POS_ACCESS_REQUIRED';
  end if;

  select o.id into v_org
  from public.organizations o
  where o.code='A4PRINT' and o.is_active=true
  limit 1;
  if v_org is null then raise exception 'A4PRINT_ORGANIZATION_REQUIRED'; end if;

  select u.id into v_staff
  from public.users u
  where u.auth_user_id=auth.uid() and u.is_active=true
  limit 1;
  if v_staff is null then raise exception 'AUTH_REQUIRED'; end if;

  if jsonb_typeof(coalesce(p_customer,'{}'::jsonb))<>'object' then raise exception 'INVALID_CUSTOMER'; end if;
  if jsonb_typeof(coalesce(p_order,'{}'::jsonb))<>'object' then raise exception 'INVALID_ORDER'; end if;

  v_workflow:=upper(nullif(btrim(coalesce(p_order->>'workflow','')),''));
  case v_workflow
    when 'WIDE_FORMAT' then
      v_business_unit:='A4_PRINT';
      v_direction_title:='Широкоформатная печать';
    when 'THREE_D' then
      v_business_unit:='3D_ARTPRINT';
      v_direction_title:='3D-печать';
    when 'OUTDOOR' then
      v_business_unit:='3D_ARTPRINT';
      v_direction_title:='Наружная реклама';
    else
      raise exception 'INVALID_PRODUCTION_WORKFLOW';
  end case;

  v_item_name:=nullif(btrim(coalesce(p_order->>'item_name','')),'');
  if v_item_name is null then raise exception 'ITEM_NAME_REQUIRED'; end if;

  begin v_qty:=coalesce(nullif(p_order->>'quantity','')::numeric,1); exception when others then raise exception 'INVALID_QUANTITY'; end;
  begin v_price:=coalesce(nullif(p_order->>'unit_price','')::numeric,0); exception when others then raise exception 'INVALID_PRICE'; end;
  begin v_planned_unit_cost:=coalesce(nullif(p_order->>'planned_unit_cost','')::numeric,0); exception when others then raise exception 'INVALID_PLANNED_COST'; end;
  if v_qty<=0 then raise exception 'QUANTITY_MUST_BE_POSITIVE'; end if;
  if v_price<0 then raise exception 'PRICE_CANNOT_BE_NEGATIVE'; end if;
  if v_planned_unit_cost<0 then raise exception 'PLANNED_COST_CANNOT_BE_NEGATIVE'; end if;

  v_total:=round(v_qty*v_price,2);
  v_planned_cost:=round(v_qty*v_planned_unit_cost,2);

  v_customer_type:=upper(coalesce(nullif(btrim(p_customer->>'customer_type'),''),'PERSON'));
  if v_customer_type not in ('PERSON','IP','LEGAL') then raise exception 'INVALID_CUSTOMER_TYPE'; end if;
  v_full_name:=nullif(btrim(coalesce(p_customer->>'full_name','')),'');
  v_company_name:=nullif(btrim(coalesce(p_customer->>'company_name','')),'');
  v_phone:=nullif(btrim(coalesce(p_customer->>'phone','')),'');
  v_email:=nullif(btrim(coalesce(p_customer->>'email','')),'');
  v_inn:=nullif(btrim(coalesce(p_customer->>'inn','')),'');

  begin
    v_customer_id:=nullif(p_customer->>'id','')::uuid;
  exception when others then
    raise exception 'INVALID_CUSTOMER_ID';
  end;

  if v_customer_id is not null then
    if not exists(
      select 1 from public.customers c
      where c.id=v_customer_id and c.organization_id=v_org
    ) then raise exception 'CUSTOMER_NOT_AVAILABLE'; end if;
  else
    if v_phone is not null then
      select c.id into v_customer_id
      from public.customers c
      where c.organization_id=v_org and c.phone=v_phone
      order by c.updated_at desc
      limit 1;
    end if;
    if v_customer_id is null and v_inn is not null then
      select c.id into v_customer_id
      from public.customers c
      where c.organization_id=v_org and c.inn=v_inn
      order by c.updated_at desc
      limit 1;
    end if;
  end if;

  if v_full_name is null then v_full_name:=v_company_name; end if;
  if v_full_name is null then raise exception 'CUSTOMER_NAME_REQUIRED'; end if;

  if v_customer_id is null then
    insert into public.customers(
      organization_id,full_name,company_name,email,phone,customer_type,inn,updated_at
    ) values(
      v_org,v_full_name,v_company_name,v_email,v_phone,v_customer_type,v_inn,now()
    ) returning id into v_customer_id;
  else
    update public.customers c set
      full_name=coalesce(v_full_name,c.full_name),
      company_name=coalesce(v_company_name,c.company_name),
      email=coalesce(v_email,c.email),
      phone=coalesce(v_phone,c.phone),
      customer_type=v_customer_type,
      inn=coalesce(v_inn,c.inn),
      updated_at=now()
    where c.id=v_customer_id and c.organization_id=v_org;
  end if;

  v_parameters:=jsonb_strip_nulls(
    p_order ||
    jsonb_build_object(
      'kind','PRODUCTION_ORDER',
      'workflow',v_workflow,
      'direction_title',v_direction_title,
      'planned_total_cost',v_planned_cost
    )
  );

  insert into public.orders(
    organization_id,business_unit,customer_id,assigned_to,created_by,status,total,
    customer_comment,internal_comment,source,model_name,partner_direction,
    due_at,deadline_note
  ) values(
    v_org,v_business_unit,v_customer_id,v_staff,v_staff,'NEW',v_total,
    nullif(btrim(coalesce(p_comment,'')),''),
    'Производственный заказ из A4-Касса · '||v_direction_title,
    'KASSA_PRODUCTION_ORDER',
    v_direction_title||' · '||v_item_name,
    'NONE',
    p_due_at,
    v_direction_title
  ) returning id,order_number into v_order_id,v_order_number;

  insert into public.order_items(order_id,name,quantity,unit_price,total_price,parameters)
  values(v_order_id,v_item_name,v_qty,v_price,v_total,v_parameters);

  insert into public.order_status_history(order_id,old_status,new_status,changed_by,comment)
  values(v_order_id,null,'NEW',v_staff,'Производственный заказ создан в A4-Касса');

  return jsonb_build_object(
    'id',v_order_id,
    'order_number',v_order_number,
    'customer_id',v_customer_id,
    'total',v_total,
    'business_unit',v_business_unit,
    'workflow',v_workflow,
    'direction_title',v_direction_title,
    'planned_total_cost',v_planned_cost
  );
end
$function$;

revoke all on function public.create_kassa_production_order(jsonb,jsonb,text,timestamptz) from public;
revoke all on function public.create_kassa_production_order(jsonb,jsonb,text,timestamptz) from anon;
grant execute on function public.create_kassa_production_order(jsonb,jsonb,text,timestamptz) to authenticated;

create or replace function private.kassa_special_order_file_access(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
  select
    (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('POS_OPERATOR'))
    and exists (
      select 1
      from public.orders o
      join public.organizations org on org.id=o.organization_id
      where o.id=p_order_id
        and org.code='A4PRINT'
        and o.source in ('KASSA_STAMP_ORDER','KASSA_PARTNER_ORDER','KASSA_PRODUCTION_ORDER')
    );
$function$;

revoke all on function private.kassa_special_order_file_access(uuid) from public;
revoke all on function private.kassa_special_order_file_access(uuid) from anon;
grant execute on function private.kassa_special_order_file_access(uuid) to authenticated;
