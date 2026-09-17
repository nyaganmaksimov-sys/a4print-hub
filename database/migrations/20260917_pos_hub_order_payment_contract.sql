-- A4PRINT HUB: reproducible POS <-> HUB order payment contract.
--
-- Production already uses this contract. This migration records the live schema
-- and RPCs in version control so a clean/restored environment behaves the same.
-- All DDL below is intentionally idempotent.

alter table public.pos_sales
  add column if not exists order_id uuid;

alter table public.payments
  add column if not exists pos_sale_id uuid;

do $$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.pos_sales'::regclass
       and conname = 'pos_sales_order_id_fkey'
  ) then
    alter table public.pos_sales
      add constraint pos_sales_order_id_fkey
      foreign key (order_id) references public.orders(id) on delete set null;
  end if;

  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.payments'::regclass
       and conname = 'payments_pos_sale_id_fkey'
  ) then
    alter table public.payments
      add constraint payments_pos_sale_id_fkey
      foreign key (pos_sale_id) references public.pos_sales(id) on delete set null;
  end if;
end;
$$;

create index if not exists pos_sales_order_id_idx
  on public.pos_sales(order_id);

create unique index if not exists payments_pos_sale_id_uidx
  on public.payments(pos_sale_id)
  where pos_sale_id is not null;

create or replace function public.get_pos_hub_orders(
  p_query text default ''::text,
  p_limit integer default 50
)
returns table(
  id uuid,
  order_number bigint,
  status public.order_status,
  total numeric,
  customer_id uuid,
  customer_name text,
  source text,
  created_at timestamptz,
  paid numeric,
  debt numeric
)
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if not (public.has_role('ADMIN') or public.has_role('POS_OPERATOR')) then
    raise exception 'POS_ACCESS_REQUIRED';
  end if;

  return query
  select
    o.id,
    o.order_number,
    o.status,
    o.total,
    o.customer_id,
    coalesce(nullif(c.company_name,''),nullif(c.full_name,''),'Клиент не указан') as customer_name,
    o.source,
    o.created_at,
    coalesce(sum(case
      when p.status='PAID' and p.payment_type='INCOME' then p.amount
      when p.status='PAID' and p.payment_type='REFUND' then -p.amount
      else 0
    end),0)::numeric as paid,
    greatest(o.total-coalesce(sum(case
      when p.status='PAID' and p.payment_type='INCOME' then p.amount
      when p.status='PAID' and p.payment_type='REFUND' then -p.amount
      else 0
    end),0),0)::numeric as debt
  from public.orders o
  left join public.customers c on c.id=o.customer_id
  left join public.payments p on p.order_id=o.id
  where o.status<>'CANCELLED'
    and (
      coalesce(trim(p_query),'')=''
      or o.order_number::text ilike '%'||trim(p_query)||'%'
      or coalesce(c.full_name,'') ilike '%'||trim(p_query)||'%'
      or coalesce(c.company_name,'') ilike '%'||trim(p_query)||'%'
      or coalesce(c.phone,'') ilike '%'||trim(p_query)||'%'
    )
  group by o.id,c.company_name,c.full_name
  having greatest(o.total-coalesce(sum(case
    when p.status='PAID' and p.payment_type='INCOME' then p.amount
    when p.status='PAID' and p.payment_type='REFUND' then -p.amount
    else 0
  end),0),0)>0
  order by o.created_at desc
  limit greatest(1,least(coalesce(p_limit,50),100));
end;
$$;

create or replace function public.get_pos_hub_order(p_order_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v jsonb;
begin
  if not (public.has_role('ADMIN') or public.has_role('POS_OPERATOR')) then
    raise exception 'POS_ACCESS_REQUIRED';
  end if;

  select jsonb_build_object(
    'id',o.id,
    'order_number',o.order_number,
    'status',o.status,
    'total',o.total,
    'customer_id',o.customer_id,
    'customer',case when c.id is null then null else jsonb_build_object(
      'id',c.id,
      'full_name',c.full_name,
      'company_name',c.company_name,
      'phone',c.phone,
      'email',c.email
    ) end,
    'source',o.source,
    'model_name',o.model_name,
    'created_at',o.created_at,
    'paid',coalesce((select sum(case
      when p.status='PAID' and p.payment_type='INCOME' then p.amount
      when p.status='PAID' and p.payment_type='REFUND' then -p.amount
      else 0
    end) from public.payments p where p.order_id=o.id),0),
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',i.id,
      'name',i.name,
      'quantity',i.quantity,
      'unit_price',i.unit_price,
      'total_price',i.total_price
    ) order by i.id) from public.order_items i where i.order_id=o.id),'[]'::jsonb)
  ) into v
  from public.orders o
  left join public.customers c on c.id=o.customer_id
  where o.id=p_order_id;

  if v is null then
    raise exception 'ORDER_NOT_FOUND';
  end if;
  return v;
end;
$$;

create or replace function public.record_pos_sale_v2(
  p_moysklad_sale_id text,
  p_moysklad_sale_name text,
  p_moysklad_shift_id text,
  p_operator_id uuid,
  p_customer_id uuid,
  p_cash_account_id uuid,
  p_payment_method text,
  p_total numeric,
  p_items jsonb,
  p_order_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_org uuid;
  v_self uuid;
  v_operator uuid;
  v_admin boolean;
  v_shift uuid;
  v_sale uuid;
  v_item_count numeric := 0;
  v_category uuid;
  v_order uuid;
  v_payment uuid;
  v_existing_order public.orders%rowtype;
  v_item jsonb;
begin
  if coalesce(trim(p_moysklad_sale_id),'')='' then
    raise exception 'SALE_ID_REQUIRED';
  end if;
  if coalesce(p_total,0)<0 then
    raise exception 'INVALID_TOTAL';
  end if;

  select id into v_org
  from public.organizations
  where code='A4PRINT'
  limit 1;

  select id into v_self
  from public.users
  where auth_user_id=auth.uid() and is_active=true
  limit 1;

  if v_org is null or v_self is null then
    raise exception 'POS_CONTEXT_NOT_FOUND';
  end if;

  v_admin := public.has_role('ADMIN');
  if not v_admin and not public.has_role('POS_OPERATOR') then
    raise exception 'POS_ACCESS_REQUIRED';
  end if;

  v_operator := v_self;
  if v_admin
     and p_operator_id is not null
     and exists(select 1 from public.users where id=p_operator_id and is_active=true) then
    v_operator := p_operator_id;
  end if;

  if not exists(
    select 1 from public.cash_accounts
    where id=p_cash_account_id and organization_id=v_org and is_active=true
  ) then
    raise exception 'INVALID_CASH_ACCOUNT';
  end if;

  select id into v_shift
  from public.pos_shift_sessions
  where organization_id=v_org and moysklad_shift_id=p_moysklad_shift_id
  order by opened_at desc
  limit 1;

  select coalesce(sum(coalesce((x->>'qty')::numeric,0)),0)
    into v_item_count
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x;

  v_order := p_order_id;
  if v_order is not null then
    select * into v_existing_order
    from public.orders
    where id=v_order;
    if not found then
      raise exception 'ORDER_NOT_FOUND';
    end if;
  else
    insert into public.orders(
      business_unit,customer_id,assigned_to,status,total,internal_comment,source
    ) values (
      'A4_PRINT',p_customer_id,v_operator,'COMPLETED',coalesce(p_total,0),
      'Создан автоматически из продажи A4PRINT KASSA','KASSA'
    ) returning id into v_order;

    for v_item in
      select * from jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
    loop
      insert into public.order_items(
        order_id,product_id,service_id,name,quantity,unit_price,total_price,parameters
      ) values (
        v_order,null,null,
        coalesce(nullif(v_item->>'name',''),'Позиция'),
        greatest(coalesce((v_item->>'qty')::numeric,1),0.000001),
        greatest(coalesce((v_item->>'price')::numeric,0),0),
        greatest(coalesce((v_item->>'qty')::numeric,1),0.000001)
          * greatest(coalesce((v_item->>'price')::numeric,0),0),
        jsonb_build_object(
          'source','KASSA',
          'catalog_item_id',nullif(v_item->>'id',''),
          'article',coalesce(v_item->>'article','')
        )
      );
    end loop;
  end if;

  insert into public.pos_sales(
    organization_id,shift_session_id,moysklad_shift_id,moysklad_sale_id,moysklad_sale_name,
    operator_id,customer_id,cash_account_id,payment_method,total,item_count,items,sold_at,
    sync_status,updated_at,order_id
  ) values (
    v_org,v_shift,p_moysklad_shift_id,p_moysklad_sale_id,p_moysklad_sale_name,
    v_operator,p_customer_id,p_cash_account_id,p_payment_method,coalesce(p_total,0),v_item_count,
    coalesce(p_items,'[]'::jsonb),now(),'SYNCED',now(),v_order
  )
  on conflict (organization_id,moysklad_sale_id) do update set
    moysklad_sale_name=excluded.moysklad_sale_name,
    shift_session_id=coalesce(excluded.shift_session_id,pos_sales.shift_session_id),
    operator_id=excluded.operator_id,
    customer_id=excluded.customer_id,
    cash_account_id=excluded.cash_account_id,
    payment_method=excluded.payment_method,
    total=excluded.total,
    item_count=excluded.item_count,
    items=excluded.items,
    sync_status='SYNCED',
    sync_error=null,
    updated_at=now(),
    order_id=coalesce(pos_sales.order_id,excluded.order_id)
  returning id,order_id into v_sale,v_order;

  insert into public.payments(
    organization_id,customer_id,order_id,payment_number,payment_type,status,amount,currency,
    payment_method,paid_at,note,created_by,pos_sale_id
  ) values (
    v_org,p_customer_id,v_order,
    'KASSA-'||coalesce(nullif(p_moysklad_sale_name,''),left(p_moysklad_sale_id,24)),
    'INCOME','PAID',greatest(coalesce(p_total,0),0.01),'RUB',
    coalesce(nullif(p_payment_method,''),'Наличные'),now(),
    'Оплата через A4PRINT KASSA · чек МойСклад '||coalesce(p_moysklad_sale_name,p_moysklad_sale_id),
    v_operator,v_sale
  )
  on conflict (pos_sale_id) where pos_sale_id is not null do update set
    order_id=excluded.order_id,
    customer_id=excluded.customer_id,
    amount=excluded.amount,
    payment_method=excluded.payment_method,
    status='PAID',
    paid_at=excluded.paid_at,
    note=excluded.note,
    updated_at=now()
  returning id into v_payment;

  select id into v_category
  from public.cash_categories
  where organization_id=v_org and direction='INCOME' and name='Оплата заказа'
  limit 1;

  if not exists(
    select 1 from public.cash_transactions
    where organization_id=v_org
      and external_source='MOYSKLAD_POS'
      and external_id=p_moysklad_sale_id
      and direction='INCOME'
  ) then
    insert into public.cash_transactions(
      organization_id,cash_account_id,category_id,customer_id,direction,amount,payment_method,
      description,transaction_date,created_by,external_source,external_id
    ) values (
      v_org,p_cash_account_id,v_category,p_customer_id,'INCOME',greatest(coalesce(p_total,0),0),
      p_payment_method,
      'Касса A4PRINT HUB · МойСклад '||coalesce(p_moysklad_sale_name,p_moysklad_sale_id),
      current_date,v_operator,'MOYSKLAD_POS',p_moysklad_sale_id
    );
  end if;

  return jsonb_build_object('sale_id',v_sale,'order_id',v_order,'payment_id',v_payment);
end;
$$;

revoke all on function public.get_pos_hub_orders(text,integer) from public, anon;
revoke all on function public.get_pos_hub_order(uuid) from public, anon;
revoke all on function public.record_pos_sale_v2(text,text,text,uuid,uuid,uuid,text,numeric,jsonb,uuid) from public, anon;

grant execute on function public.get_pos_hub_orders(text,integer) to authenticated;
grant execute on function public.get_pos_hub_order(uuid) to authenticated;
grant execute on function public.record_pos_sale_v2(text,text,text,uuid,uuid,uuid,text,numeric,jsonb,uuid) to authenticated;
