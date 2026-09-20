-- A4PRINT KASSA: dedicated order workflow for seals and stamps.
-- Source categories are aligned with the public A4-Print seals/stamps page.
-- The RPC is available to ADMIN / MANAGER / POS_OPERATOR and always creates
-- an A4PRINT customer order, regardless of the staff account's HUB company.

create or replace function public.search_a4print_stamp_customers(
  p_query text default '',
  p_limit integer default 30
)
returns table(
  id uuid,
  full_name text,
  company_name text,
  email text,
  phone text,
  customer_type text,
  legal_name text,
  inn text,
  kpp text,
  ogrn text,
  legal_address text,
  actual_address text,
  bank_name text,
  bik text,
  settlement_account text,
  correspondent_account text,
  signatory_name text,
  signatory_title text,
  signatory_basis text
)
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_org uuid;
  v_q text := btrim(coalesce(p_query,''));
  v_limit integer := least(greatest(coalesce(p_limit,30),1),100);
begin
  if not (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('POS_OPERATOR')) then
    raise exception 'POS_ACCESS_REQUIRED';
  end if;

  select o.id into v_org
  from public.organizations o
  where o.code='A4PRINT' and o.is_active=true
  limit 1;
  if v_org is null then raise exception 'A4PRINT_ORGANIZATION_REQUIRED'; end if;

  return query
  select c.id,c.full_name,c.company_name,c.email,c.phone,c.customer_type,c.legal_name,
         c.inn,c.kpp,c.ogrn,c.legal_address,c.actual_address,c.bank_name,c.bik,
         c.settlement_account,c.correspondent_account,c.signatory_name,c.signatory_title,c.signatory_basis
  from public.customers c
  where c.organization_id=v_org
    and (
      v_q='' or
      coalesce(c.full_name,'') ilike '%'||v_q||'%' or
      coalesce(c.company_name,'') ilike '%'||v_q||'%' or
      coalesce(c.phone,'') ilike '%'||v_q||'%' or
      coalesce(c.email,'') ilike '%'||v_q||'%' or
      coalesce(c.inn,'') ilike '%'||v_q||'%'
    )
  order by c.updated_at desc nulls last,c.created_at desc
  limit v_limit;
end
$$;

revoke all on function public.search_a4print_stamp_customers(text,integer) from public,anon;
grant execute on function public.search_a4print_stamp_customers(text,integer) to authenticated;


create or replace function public.create_kassa_stamp_order(
  p_customer jsonb,
  p_items jsonb,
  p_comment text default null,
  p_due_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_org uuid;
  v_staff uuid;
  v_customer_id uuid;
  v_order_id uuid;
  v_order_number bigint;
  v_customer_type text;
  v_full_name text;
  v_company_name text;
  v_phone text;
  v_email text;
  v_inn text;
  v_total numeric(14,2) := 0;
  v_item jsonb;
  v_qty numeric;
  v_price numeric;
  v_type text;
  v_sample text;
  v_details text;
  v_first_name text;
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

  if jsonb_typeof(coalesce(p_customer,'{}'::jsonb))<>'object' then
    raise exception 'INVALID_CUSTOMER';
  end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' or jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then
    raise exception 'STAMP_ITEMS_REQUIRED';
  end if;

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
    if not exists(select 1 from public.customers c where c.id=v_customer_id and c.organization_id=v_org) then
      raise exception 'CUSTOMER_NOT_AVAILABLE';
    end if;
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

  if v_full_name is null then
    v_full_name:=coalesce(v_company_name,nullif(btrim(coalesce(p_customer->>'legal_name','')),''));
  end if;
  if v_full_name is null then raise exception 'CUSTOMER_NAME_REQUIRED'; end if;

  if v_customer_id is null then
    insert into public.customers(
      organization_id,full_name,company_name,email,phone,customer_type,legal_name,inn,kpp,ogrn,
      legal_address,actual_address,bank_name,bik,settlement_account,correspondent_account,
      signatory_name,signatory_title,signatory_basis,updated_at
    ) values(
      v_org,v_full_name,v_company_name,v_email,v_phone,v_customer_type,
      nullif(btrim(coalesce(p_customer->>'legal_name','')),''),
      v_inn,
      nullif(btrim(coalesce(p_customer->>'kpp','')),''),
      nullif(btrim(coalesce(p_customer->>'ogrn','')),''),
      nullif(btrim(coalesce(p_customer->>'legal_address','')),''),
      nullif(btrim(coalesce(p_customer->>'actual_address','')),''),
      nullif(btrim(coalesce(p_customer->>'bank_name','')),''),
      nullif(btrim(coalesce(p_customer->>'bik','')),''),
      nullif(btrim(coalesce(p_customer->>'settlement_account','')),''),
      nullif(btrim(coalesce(p_customer->>'correspondent_account','')),''),
      nullif(btrim(coalesce(p_customer->>'signatory_name','')),''),
      nullif(btrim(coalesce(p_customer->>'signatory_title','')),''),
      nullif(btrim(coalesce(p_customer->>'signatory_basis','')),''),
      now()
    ) returning id into v_customer_id;
  else
    update public.customers c set
      full_name=coalesce(v_full_name,c.full_name),
      company_name=coalesce(v_company_name,c.company_name),
      email=coalesce(v_email,c.email),
      phone=coalesce(v_phone,c.phone),
      customer_type=v_customer_type,
      legal_name=coalesce(nullif(btrim(coalesce(p_customer->>'legal_name','')),''),c.legal_name),
      inn=coalesce(v_inn,c.inn),
      kpp=coalesce(nullif(btrim(coalesce(p_customer->>'kpp','')),''),c.kpp),
      ogrn=coalesce(nullif(btrim(coalesce(p_customer->>'ogrn','')),''),c.ogrn),
      legal_address=coalesce(nullif(btrim(coalesce(p_customer->>'legal_address','')),''),c.legal_address),
      actual_address=coalesce(nullif(btrim(coalesce(p_customer->>'actual_address','')),''),c.actual_address),
      bank_name=coalesce(nullif(btrim(coalesce(p_customer->>'bank_name','')),''),c.bank_name),
      bik=coalesce(nullif(btrim(coalesce(p_customer->>'bik','')),''),c.bik),
      settlement_account=coalesce(nullif(btrim(coalesce(p_customer->>'settlement_account','')),''),c.settlement_account),
      correspondent_account=coalesce(nullif(btrim(coalesce(p_customer->>'correspondent_account','')),''),c.correspondent_account),
      signatory_name=coalesce(nullif(btrim(coalesce(p_customer->>'signatory_name','')),''),c.signatory_name),
      signatory_title=coalesce(nullif(btrim(coalesce(p_customer->>'signatory_title','')),''),c.signatory_title),
      signatory_basis=coalesce(nullif(btrim(coalesce(p_customer->>'signatory_basis','')),''),c.signatory_basis),
      updated_at=now()
    where c.id=v_customer_id and c.organization_id=v_org;
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_type:=nullif(btrim(coalesce(v_item->>'type','')),'');
    if v_type is null then raise exception 'STAMP_TYPE_REQUIRED'; end if;
    v_qty:=coalesce(nullif(v_item->>'quantity','')::numeric,1);
    v_price:=coalesce(nullif(v_item->>'unit_price','')::numeric,0);
    if v_qty<=0 then raise exception 'QUANTITY_MUST_BE_POSITIVE'; end if;
    if v_price<0 then raise exception 'PRICE_CANNOT_BE_NEGATIVE'; end if;
    v_total:=v_total+round(v_qty*v_price,2);
    if v_first_name is null then
      v_sample:=nullif(btrim(coalesce(v_item->>'sample_number','')),'');
      v_first_name:=v_type||case when v_sample is not null then ' · образец №'||v_sample else '' end;
    end if;
  end loop;

  insert into public.orders(
    organization_id,business_unit,customer_id,assigned_to,created_by,status,total,
    customer_comment,internal_comment,source,model_name,partner_direction,due_at,deadline_note
  ) values(
    v_org,'A4_PRINT',v_customer_id,v_staff,v_staff,'NEW',round(v_total,2),
    nullif(btrim(coalesce(p_comment,'')),''),
    'Спецзаказ из A4-Касса · печати и штампы',
    'KASSA_STAMP_ORDER',
    coalesce(v_first_name,'Печати и штампы'),
    'NONE',p_due_at,'Заказ печатей и штампов'
  ) returning id,order_number into v_order_id,v_order_number;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    v_type:=btrim(v_item->>'type');
    v_sample:=nullif(btrim(coalesce(v_item->>'sample_number','')),'');
    v_qty:=coalesce(nullif(v_item->>'quantity','')::numeric,1);
    v_price:=coalesce(nullif(v_item->>'unit_price','')::numeric,0);

    v_details:=concat_ws(' · ',
      case when v_sample is not null then 'образец №'||v_sample end,
      nullif(btrim(coalesce(v_item->>'shape','')),''),
      nullif(btrim(coalesce(v_item->>'size','')),''),
      nullif(btrim(coalesce(v_item->>'equipment','')),''),
      nullif(btrim(coalesce(v_item->>'ink_color','')),''),
      case when nullif(btrim(coalesce(v_item->>'stamp_text','')),'') is not null then 'текст: '||btrim(v_item->>'stamp_text') end,
      nullif(btrim(coalesce(v_item->>'details','')),'')
    );

    insert into public.order_items(order_id,name,quantity,unit_price,total_price,parameters)
    values(
      v_order_id,
      v_type||case when v_sample is not null then ' · образец №'||v_sample else '' end,
      v_qty,v_price,round(v_qty*v_price,2),
      jsonb_strip_nulls(jsonb_build_object(
        'kind','STAMP_ORDER',
        'stamp_type',v_type,
        'sample_number',v_sample,
        'shape',nullif(btrim(coalesce(v_item->>'shape','')),''),
        'size',nullif(btrim(coalesce(v_item->>'size','')),''),
        'equipment',nullif(btrim(coalesce(v_item->>'equipment','')),''),
        'ink_color',nullif(btrim(coalesce(v_item->>'ink_color','')),''),
        'stamp_text',nullif(btrim(coalesce(v_item->>'stamp_text','')),''),
        'details',nullif(v_details,''),
        'source_page','https://xn--4--6kc8azakhs.xn--p1ai/pechati_shtamp'
      ))
    );
  end loop;

  insert into public.order_status_history(order_id,old_status,new_status,changed_by,comment)
  values(v_order_id,null,'NEW',v_staff,'Заказ печатей/штампов создан в A4-Касса');

  return jsonb_build_object(
    'id',v_order_id,
    'order_number',v_order_number,
    'customer_id',v_customer_id,
    'total',round(v_total,2)
  );
end
$$;

revoke all on function public.create_kassa_stamp_order(jsonb,jsonb,text,timestamptz) from public,anon;
grant execute on function public.create_kassa_stamp_order(jsonb,jsonb,text,timestamptz) to authenticated;

-- Allow POS operators to attach customer artwork/signature files only to
-- dedicated A4PRINT stamp orders. Storage bucket access is already staff-only.
drop policy if exists order_files_kassa_stamp_pos_select on public.order_files;
create policy order_files_kassa_stamp_pos_select on public.order_files
for select to authenticated
using (
  public.has_role('POS_OPERATOR') and exists(
    select 1 from public.orders o
    join public.organizations org on org.id=o.organization_id
    where o.id=order_id and org.code='A4PRINT' and o.source='KASSA_STAMP_ORDER'
  )
);

drop policy if exists order_files_kassa_stamp_pos_insert on public.order_files;
create policy order_files_kassa_stamp_pos_insert on public.order_files
for insert to authenticated
with check (
  public.has_role('POS_OPERATOR') and exists(
    select 1 from public.orders o
    join public.organizations org on org.id=o.organization_id
    where o.id=order_id and org.code='A4PRINT' and o.source='KASSA_STAMP_ORDER'
  )
);
