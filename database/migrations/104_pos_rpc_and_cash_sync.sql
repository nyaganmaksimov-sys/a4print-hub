-- A4PRINT HUB POS v2: безопасная запись продаж, смен и аналитика.
alter table public.cash_transactions add column if not exists external_source text;
alter table public.cash_transactions add column if not exists external_id text;
create unique index if not exists uq_cash_transactions_external on public.cash_transactions(organization_id, external_source, external_id, direction) where external_id is not null;

create or replace function public.get_pos_operators()
returns table(id uuid, full_name text, email text, is_active boolean, is_self boolean)
language plpgsql security definer set search_path=public,auth as $$
declare v_user_id uuid; v_admin boolean;
begin
  select u.id into v_user_id from public.users u where u.auth_user_id=auth.uid() limit 1;
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  v_admin := public.has_role('ADMIN');
  if not v_admin and not public.has_role('POS_OPERATOR') then raise exception 'POS_ACCESS_REQUIRED'; end if;
  if v_admin then
    return query
    select distinct u.id,u.full_name,coalesce(u.email,''),u.is_active,(u.id=v_user_id)
    from public.users u
    left join public.user_roles ur on ur.user_id=u.id
    left join public.roles r on r.id=ur.role_id
    where u.is_active=true and (r.name='POS_OPERATOR' or u.id=v_user_id)
    order by (u.id=v_user_id) desc,u.full_name;
  else
    return query select u.id,u.full_name,coalesce(u.email,''),u.is_active,true from public.users u where u.id=v_user_id and u.is_active=true;
  end if;
end$$;
revoke all on function public.get_pos_operators() from public;
grant execute on function public.get_pos_operators() to authenticated;

create or replace function public.record_pos_shift(
  p_moysklad_shift_id text,
  p_moysklad_shift_name text default null,
  p_store_id text default null,
  p_store_name text default null,
  p_opened_at timestamptz default now(),
  p_closed_at timestamptz default null,
  p_status text default 'OPEN',
  p_operator_id uuid default null
) returns uuid
language plpgsql security definer set search_path=public,auth as $$
declare v_org uuid; v_self uuid; v_operator uuid; v_admin boolean; v_id uuid;
begin
  if coalesce(trim(p_moysklad_shift_id),'')='' then raise exception 'SHIFT_ID_REQUIRED'; end if;
  select id into v_org from public.organizations where code='A4PRINT' limit 1;
  select id into v_self from public.users where auth_user_id=auth.uid() and is_active=true limit 1;
  if v_org is null or v_self is null then raise exception 'POS_CONTEXT_NOT_FOUND'; end if;
  v_admin:=public.has_role('ADMIN');
  if not v_admin and not public.has_role('POS_OPERATOR') then raise exception 'POS_ACCESS_REQUIRED'; end if;
  v_operator:=v_self;
  if v_admin and p_operator_id is not null and exists(select 1 from public.users where id=p_operator_id and is_active=true) then v_operator:=p_operator_id; end if;
  insert into public.pos_shift_sessions(organization_id,moysklad_shift_id,moysklad_shift_name,store_id,store_name,opened_by,closed_by,opened_at,closed_at,status,updated_at)
  values(v_org,p_moysklad_shift_id,p_moysklad_shift_name,p_store_id,p_store_name,v_operator,case when upper(p_status)='CLOSED' then v_operator end,coalesce(p_opened_at,now()),p_closed_at,case when upper(p_status)='CLOSED' then 'CLOSED' else 'OPEN' end,now())
  on conflict (organization_id,moysklad_shift_id) do update set
    moysklad_shift_name=coalesce(excluded.moysklad_shift_name,pos_shift_sessions.moysklad_shift_name),
    store_id=coalesce(excluded.store_id,pos_shift_sessions.store_id),
    store_name=coalesce(excluded.store_name,pos_shift_sessions.store_name),
    closed_by=coalesce(excluded.closed_by,pos_shift_sessions.closed_by),
    closed_at=coalesce(excluded.closed_at,pos_shift_sessions.closed_at),
    status=excluded.status,
    updated_at=now()
  returning id into v_id;
  return v_id;
end$$;
revoke all on function public.record_pos_shift(text,text,text,text,timestamptz,timestamptz,text,uuid) from public;
grant execute on function public.record_pos_shift(text,text,text,text,timestamptz,timestamptz,text,uuid) to authenticated;

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
language plpgsql security definer set search_path=public,auth as $$
declare v_org uuid; v_self uuid; v_operator uuid; v_admin boolean; v_shift uuid; v_sale uuid; v_item_count numeric:=0; v_category uuid;
begin
  if coalesce(trim(p_moysklad_sale_id),'')='' then raise exception 'SALE_ID_REQUIRED'; end if;
  if coalesce(p_total,0)<0 then raise exception 'INVALID_TOTAL'; end if;
  select id into v_org from public.organizations where code='A4PRINT' limit 1;
  select id into v_self from public.users where auth_user_id=auth.uid() and is_active=true limit 1;
  if v_org is null or v_self is null then raise exception 'POS_CONTEXT_NOT_FOUND'; end if;
  v_admin:=public.has_role('ADMIN');
  if not v_admin and not public.has_role('POS_OPERATOR') then raise exception 'POS_ACCESS_REQUIRED'; end if;
  v_operator:=v_self;
  if v_admin and p_operator_id is not null and exists(select 1 from public.users where id=p_operator_id and is_active=true) then v_operator:=p_operator_id; end if;
  if not exists(select 1 from public.cash_accounts where id=p_cash_account_id and organization_id=v_org and is_active=true) then raise exception 'INVALID_CASH_ACCOUNT'; end if;
  select id into v_shift from public.pos_shift_sessions where organization_id=v_org and moysklad_shift_id=p_moysklad_shift_id order by opened_at desc limit 1;
  select coalesce(sum(coalesce((x->>'qty')::numeric,0)),0) into v_item_count from jsonb_array_elements(coalesce(p_items,'[]'::jsonb)) x;
  insert into public.pos_sales(organization_id,shift_session_id,moysklad_shift_id,moysklad_sale_id,moysklad_sale_name,operator_id,customer_id,cash_account_id,payment_method,total,item_count,items,sold_at,sync_status,updated_at)
  values(v_org,v_shift,p_moysklad_shift_id,p_moysklad_sale_id,p_moysklad_sale_name,v_operator,p_customer_id,p_cash_account_id,p_payment_method,coalesce(p_total,0),v_item_count,coalesce(p_items,'[]'::jsonb),now(),'SYNCED',now())
  on conflict (organization_id,moysklad_sale_id) do update set
    moysklad_sale_name=excluded.moysklad_sale_name, shift_session_id=coalesce(excluded.shift_session_id,pos_sales.shift_session_id), operator_id=excluded.operator_id,
    customer_id=excluded.customer_id,cash_account_id=excluded.cash_account_id,payment_method=excluded.payment_method,total=excluded.total,item_count=excluded.item_count,items=excluded.items,sync_status='SYNCED',sync_error=null,updated_at=now()
  returning id into v_sale;
  select id into v_category from public.cash_categories where organization_id=v_org and direction='INCOME' and name='Оплата заказа' limit 1;
  if not exists(select 1 from public.cash_transactions where organization_id=v_org and external_source='MOYSKLAD_POS' and external_id=p_moysklad_sale_id and direction='INCOME') then
    insert into public.cash_transactions(organization_id,cash_account_id,category_id,customer_id,direction,amount,payment_method,description,transaction_date,created_by,external_source,external_id)
    values(v_org,p_cash_account_id,v_category,p_customer_id,'INCOME',greatest(coalesce(p_total,0),0),p_payment_method,'Касса A4PRINT HUB · МойСклад '||coalesce(p_moysklad_sale_name,p_moysklad_sale_id),current_date,v_operator,'MOYSKLAD_POS',p_moysklad_sale_id);
  end if;
  return v_sale;
end$$;
revoke all on function public.record_pos_sale(text,text,text,uuid,uuid,uuid,text,numeric,jsonb) from public;
grant execute on function public.record_pos_sale(text,text,text,uuid,uuid,uuid,text,numeric,jsonb) to authenticated;

create or replace function public.pos_dashboard(p_from timestamptz default (now()-interval '30 days'), p_to timestamptz default now(), p_operator_id uuid default null)
returns jsonb
language plpgsql security definer set search_path=public,auth as $$
declare v_org uuid; v_self uuid; v_admin boolean; v_filter uuid; v_result jsonb;
begin
  select id into v_org from public.organizations where code='A4PRINT' limit 1;
  select id into v_self from public.users where auth_user_id=auth.uid() and is_active=true limit 1;
  if v_org is null or v_self is null then raise exception 'POS_CONTEXT_NOT_FOUND'; end if;
  v_admin:=public.has_role('ADMIN');
  if not v_admin and not public.has_role('POS_OPERATOR') then raise exception 'POS_ACCESS_REQUIRED'; end if;
  v_filter:=case when v_admin then p_operator_id else v_self end;
  with s as (
    select ps.* from public.pos_sales ps where ps.organization_id=v_org and ps.sold_at>=p_from and ps.sold_at<p_to and (v_filter is null or ps.operator_id=v_filter)
  ), r as (
    select pr.* from public.pos_returns pr where pr.organization_id=v_org and pr.returned_at>=p_from and pr.returned_at<p_to and (v_filter is null or pr.operator_id=v_filter)
  ), pay as (
    select coalesce(payment_method,'Не указано') k,count(*) n,sum(total) amount from s group by 1 order by amount desc
  ), ops as (
    select coalesce(u.full_name,'Неизвестно') k,count(*) n,sum(s.total) amount from s left join public.users u on u.id=s.operator_id group by 1 order by amount desc
  ), items as (
    select coalesce(i->>'name','Позиция') k,sum(coalesce((i->>'qty')::numeric,0)) qty,sum(coalesce((i->>'qty')::numeric,0)*coalesce((i->>'price')::numeric,0)) amount
    from s cross join lateral jsonb_array_elements(coalesce(s.items,'[]'::jsonb)) i group by 1 order by amount desc limit 12
  ), recent as (
    select jsonb_agg(jsonb_build_object('id',x.id,'sale_name',x.moysklad_sale_name,'sold_at',x.sold_at,'total',x.total,'payment_method',x.payment_method,'operator',x.operator_name,'customer',x.customer_name) order by x.sold_at desc) j
    from (select s.id,s.moysklad_sale_name,s.sold_at,s.total,s.payment_method,u.full_name operator_name,c.full_name customer_name from s left join public.users u on u.id=s.operator_id left join public.customers c on c.id=s.customer_id order by s.sold_at desc limit 20) x
  )
  select jsonb_build_object(
    'from',p_from,'to',p_to,
    'sales_count',(select count(*) from s),
    'sales_total',coalesce((select sum(total) from s),0),
    'items_count',coalesce((select sum(item_count) from s),0),
    'avg_check',coalesce((select avg(total) from s),0),
    'returns_count',(select count(*) from r),
    'returns_total',coalesce((select sum(amount) from r),0),
    'net_total',coalesce((select sum(total) from s),0)-coalesce((select sum(amount) from r),0),
    'payment_methods',coalesce((select jsonb_agg(jsonb_build_object('name',k,'count',n,'amount',amount)) from pay),'[]'::jsonb),
    'operators',coalesce((select jsonb_agg(jsonb_build_object('name',k,'count',n,'amount',amount)) from ops),'[]'::jsonb),
    'top_items',coalesce((select jsonb_agg(jsonb_build_object('name',k,'qty',qty,'amount',amount)) from items),'[]'::jsonb),
    'recent_sales',coalesce((select j from recent),'[]'::jsonb),
    'catalog',jsonb_build_object('active',(select count(*) from public.catalog_items where organization_id=v_org and is_active=true),'linked',(select count(*) from public.catalog_items where organization_id=v_org and is_active=true and external_source='MOYSKLAD' and external_id is not null),'last_sync',(select max(last_synced_at) from public.catalog_items where organization_id=v_org and external_source='MOYSKLAD'))
  ) into v_result;
  return v_result;
end$$;
revoke all on function public.pos_dashboard(timestamptz,timestamptz,uuid) from public;
grant execute on function public.pos_dashboard(timestamptz,timestamptz,uuid) to authenticated;
