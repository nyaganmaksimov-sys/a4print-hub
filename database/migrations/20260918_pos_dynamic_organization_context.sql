-- PHASE 2: dynamic POS organization context for multi-company operation.

create schema if not exists private;

create or replace function private.current_user_organization_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $$
  select ou.organization_id
  from public.users u
  join public.organization_units ou on ou.id = u.organization_unit_id
  where u.auth_user_id = auth.uid()
    and u.is_active = true
    and ou.is_active = true
  limit 1
$$;

revoke all on function private.current_user_organization_id() from public, anon;
grant execute on function private.current_user_organization_id() to authenticated;

create or replace function public.get_pos_operators()
returns table(id uuid, full_name text, email text, is_active boolean, is_self boolean)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $$
declare
  v_user_id uuid;
  v_org uuid;
  v_admin boolean;
begin
  select u.id, ou.organization_id
  into v_user_id, v_org
  from public.users u
  join public.organization_units ou on ou.id=u.organization_unit_id and ou.is_active=true
  where u.auth_user_id=auth.uid() and u.is_active=true
  limit 1;

  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_org is null then raise exception 'POS_ORGANIZATION_REQUIRED'; end if;

  v_admin := public.has_role('ADMIN');
  if not v_admin and not public.has_role('POS_OPERATOR') then raise exception 'POS_ACCESS_REQUIRED'; end if;

  if v_admin then
    return query
    select distinct u.id,u.full_name,coalesce(u.email,''),u.is_active,(u.id=v_user_id)
    from public.users u
    join public.organization_units ou on ou.id=u.organization_unit_id
    left join public.user_roles ur on ur.user_id=u.id
    left join public.roles r on r.id=ur.role_id
    where u.is_active=true
      and ou.is_active=true
      and ou.organization_id=v_org
      and (r.name='POS_OPERATOR' or u.id=v_user_id)
    order by (u.id=v_user_id) desc,u.full_name;
  else
    return query
    select u.id,u.full_name,coalesce(u.email,''),u.is_active,true
    from public.users u
    where u.id=v_user_id and u.is_active=true;
  end if;
end
$$;

revoke all on function public.get_pos_operators() from public, anon;
grant execute on function public.get_pos_operators() to authenticated;

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
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, auth
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
  v_cash_account uuid;
begin
  if coalesce(trim(p_moysklad_sale_id),'')='' then raise exception 'SALE_ID_REQUIRED'; end if;
  if coalesce(p_total,0)<0 then raise exception 'INVALID_TOTAL'; end if;

  select u.id, ou.organization_id
  into v_self, v_org
  from public.users u
  join public.organization_units ou on ou.id=u.organization_unit_id and ou.is_active=true
  where u.auth_user_id=auth.uid() and u.is_active=true
  limit 1;

  if v_org is null or v_self is null then raise exception 'POS_CONTEXT_NOT_FOUND'; end if;

  v_admin := public.has_role('ADMIN');
  if not v_admin and not public.has_role('POS_OPERATOR') then raise exception 'POS_ACCESS_REQUIRED'; end if;

  v_operator := v_self;
  if v_admin and p_operator_id is not null and exists(
    select 1
    from public.users u
    join public.organization_units ou on ou.id=u.organization_unit_id
    where u.id=p_operator_id and u.is_active=true and ou.is_active=true and ou.organization_id=v_org
  ) then
    v_operator := p_operator_id;
  end if;

  if p_customer_id is not null and not exists(
    select 1 from public.customers c
    where c.id=p_customer_id and c.organization_id=v_org
  ) then
    raise exception 'CUSTOMER_NOT_AVAILABLE';
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
$$;

revoke all on function public.record_pos_sale(text,text,text,uuid,uuid,uuid,text,numeric,jsonb) from public, anon;
grant execute on function public.record_pos_sale(text,text,text,uuid,uuid,uuid,text,numeric,jsonb) to authenticated;
