create or replace function public.record_pos_sale(
  p_moysklad_sale_id text,
  p_moysklad_sale_name text,
  p_moysklad_shift_id text,
  p_operator_id uuid,
  p_customer_id uuid,
  p_cash_account_id uuid,
  p_payment_method text,
  p_total numeric,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_org uuid;
  v_self uuid;
  v_operator uuid;
  v_admin boolean;
  v_shift uuid;
  v_sale uuid;
  v_item_count numeric := 0;
  v_category uuid;
  v_cash_account uuid;
begin
  if coalesce(trim(p_moysklad_sale_id),'')='' then raise exception 'SALE_ID_REQUIRED'; end if;
  if coalesce(p_total,0)<0 then raise exception 'INVALID_TOTAL'; end if;

  select id into v_org from public.organizations where code='A4PRINT' limit 1;
  select id into v_self from public.users where auth_user_id=auth.uid() and is_active=true limit 1;
  if v_org is null or v_self is null then raise exception 'POS_CONTEXT_NOT_FOUND'; end if;

  v_admin := public.has_role('ADMIN');
  if not v_admin and not public.has_role('POS_OPERATOR') then raise exception 'POS_ACCESS_REQUIRED'; end if;

  v_operator := v_self;
  if v_admin and p_operator_id is not null and exists(select 1 from public.users where id=p_operator_id and is_active=true) then
    v_operator := p_operator_id;
  end if;

  select id into v_cash_account
  from public.cash_accounts
  where id=p_cash_account_id and organization_id=v_org and is_active=true
  limit 1;

  if v_cash_account is null then
    select id into v_cash_account
    from public.cash_accounts
    where organization_id=v_org and is_active=true
    order by case when account_type='CASH' then 0 else 1 end, created_at
    limit 1;
  end if;

  if v_cash_account is null then raise exception 'INVALID_CASH_ACCOUNT'; end if;

  select id into v_shift
  from public.pos_shift_sessions
  where organization_id=v_org and moysklad_shift_id=p_moysklad_shift_id
  order by opened_at desc
  limit 1;

  select coalesce(sum(coalesce((x->>'qty')::numeric,0)),0)
  into v_item_count
  from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x;

  insert into public.pos_sales(
    organization_id,shift_session_id,moysklad_shift_id,moysklad_sale_id,moysklad_sale_name,
    operator_id,customer_id,cash_account_id,payment_method,total,item_count,items,sold_at,sync_status,updated_at
  ) values(
    v_org,v_shift,p_moysklad_shift_id,p_moysklad_sale_id,p_moysklad_sale_name,
    v_operator,p_customer_id,v_cash_account,p_payment_method,coalesce(p_total,0),v_item_count,
    coalesce(p_items,'[]'::jsonb),now(),'SYNCED',now()
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
    updated_at=now()
  returning id into v_sale;

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
    ) values(
      v_org,v_cash_account,v_category,p_customer_id,'INCOME',greatest(coalesce(p_total,0),0),p_payment_method,
      'Касса A4PRINT HUB · МойСклад '||coalesce(p_moysklad_sale_name,p_moysklad_sale_id),
      current_date,v_operator,'MOYSKLAD_POS',p_moysklad_sale_id
    );
  end if;

  return v_sale;
end
$function$;
