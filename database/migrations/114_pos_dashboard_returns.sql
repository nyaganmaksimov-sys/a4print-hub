-- POS analytics must use the authoritative POS return ledger, not an optional cash sync row.
create or replace function public.pos_dashboard(
  p_from timestamptz default (now()-interval '30 days'),
  p_to timestamptz default now(),
  p_operator_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_org uuid;
  v_self uuid;
  v_admin boolean;
  v_filter uuid;
  v_result jsonb;
begin
  select id into v_org from public.organizations where code='A4PRINT' limit 1;
  select id into v_self from public.users where auth_user_id=auth.uid() and is_active=true limit 1;
  if v_org is null or v_self is null then raise exception 'POS_CONTEXT_NOT_FOUND'; end if;

  v_admin:=public.has_role('ADMIN');
  if not v_admin and not public.has_role('POS_OPERATOR') then raise exception 'POS_ACCESS_REQUIRED'; end if;
  v_filter:=case when v_admin then p_operator_id else v_self end;

  with tin as (
    select ct.*
    from public.cash_transactions ct
    where ct.organization_id=v_org
      and ct.direction='INCOME'
      and ct.created_at>=p_from and ct.created_at<p_to
      and (ct.external_source='MOYSKLAD_POS' or ct.description ilike 'МойСклад %' or ct.description ilike 'Касса A4PRINT HUB%')
      and (v_filter is null or ct.created_by=v_filter)
  ), r as (
    select pr.*
    from public.pos_returns pr
    where pr.organization_id=v_org
      and pr.returned_at>=p_from and pr.returned_at<p_to
      and (v_filter is null or pr.operator_id=v_filter)
  ), s as (
    select ps.*
    from public.pos_sales ps
    where ps.organization_id=v_org
      and ps.sold_at>=p_from and ps.sold_at<p_to
      and (v_filter is null or ps.operator_id=v_filter)
  ), pay as (
    select coalesce(payment_method,'Не указано') k,count(*) n,sum(amount) amount
    from tin group by 1 order by amount desc
  ), ops as (
    select coalesce(u.full_name,'Неизвестно') k,count(*) n,sum(tin.amount) amount
    from tin left join public.users u on u.id=tin.created_by
    group by 1 order by amount desc
  ), items as (
    select coalesce(i->>'name','Позиция') k,
           sum(coalesce((i->>'qty')::numeric,0)) qty,
           sum(coalesce((i->>'qty')::numeric,0)*coalesce((i->>'price')::numeric,0)) amount
    from s cross join lateral jsonb_array_elements(coalesce(s.items,'[]'::jsonb)) i
    group by 1 order by amount desc limit 12
  ), recent as (
    select jsonb_agg(
      jsonb_build_object(
        'id',x.id,
        'sale_name',coalesce(x.external_id,x.description),
        'sold_at',x.created_at,
        'total',x.amount,
        'payment_method',x.payment_method,
        'operator',x.operator_name,
        'customer',x.customer_name
      ) order by x.created_at desc
    ) j
    from (
      select tin.*,u.full_name operator_name,c.full_name customer_name
      from tin
      left join public.users u on u.id=tin.created_by
      left join public.customers c on c.id=tin.customer_id
      order by tin.created_at desc limit 20
    ) x
  ), recent_returns as (
    select jsonb_agg(
      jsonb_build_object(
        'id',x.id,
        'return_name',coalesce(x.moysklad_return_name,x.moysklad_return_id),
        'sale_name',coalesce(x.moysklad_sale_name,x.moysklad_sale_id),
        'returned_at',x.returned_at,
        'amount',x.amount,
        'payment_method',x.payment_method,
        'reason',x.reason,
        'operator',x.operator_name,
        'item_count',x.item_count
      ) order by x.returned_at desc
    ) j
    from (
      select r.*,
             u.full_name operator_name,
             ps.moysklad_sale_name,
             ps.moysklad_sale_id,
             coalesce((select sum(coalesce((i->>'qty')::numeric,0)) from jsonb_array_elements(coalesce(r.items,'[]'::jsonb)) i),0) item_count
      from r
      left join public.users u on u.id=r.operator_id
      left join public.pos_sales ps on ps.id=r.pos_sale_id
      order by r.returned_at desc limit 20
    ) x
  )
  select jsonb_build_object(
    'from',p_from,
    'to',p_to,
    'sales_count',(select count(*) from tin),
    'sales_total',coalesce((select sum(amount) from tin),0),
    'items_count',coalesce((select sum(item_count) from s),0),
    'avg_check',coalesce((select avg(amount) from tin),0),
    'returns_count',(select count(*) from r),
    'returns_total',coalesce((select sum(amount) from r),0),
    'net_total',coalesce((select sum(amount) from tin),0)-coalesce((select sum(amount) from r),0),
    'payment_methods',coalesce((select jsonb_agg(jsonb_build_object('name',k,'count',n,'amount',amount)) from pay),'[]'::jsonb),
    'operators',coalesce((select jsonb_agg(jsonb_build_object('name',k,'count',n,'amount',amount)) from ops),'[]'::jsonb),
    'top_items',coalesce((select jsonb_agg(jsonb_build_object('name',k,'qty',qty,'amount',amount)) from items),'[]'::jsonb),
    'recent_sales',coalesce((select j from recent),'[]'::jsonb),
    'recent_returns',coalesce((select j from recent_returns),'[]'::jsonb),
    'catalog',jsonb_build_object(
      'active',(select count(*) from public.catalog_items where organization_id=v_org and is_active=true),
      'linked',(select count(*) from public.catalog_items where organization_id=v_org and is_active=true and external_source='MOYSKLAD' and external_id is not null),
      'last_sync',(select max(last_synced_at) from public.catalog_items where organization_id=v_org and external_source='MOYSKLAD')
    )
  ) into v_result;

  return v_result;
end$$;

revoke all on function public.pos_dashboard(timestamptz,timestamptz,uuid) from public;
grant execute on function public.pos_dashboard(timestamptz,timestamptz,uuid) to authenticated;

-- Backfill successful POS returns that were already written to pos_returns
-- but missed cash_transactions because of the earlier upsert conflict-target mismatch.
insert into public.cash_transactions (
  organization_id,cash_account_id,category_id,customer_id,direction,amount,payment_method,
  description,transaction_date,created_by,external_source,external_id
)
select
  pr.organization_id,
  pr.cash_account_id,
  cc.id,
  ps.customer_id,
  'EXPENSE',
  pr.amount,
  pr.payment_method,
  'Возврат по продаже ' || coalesce(ps.moysklad_sale_name,ps.moysklad_sale_id,'—') ||
    case when nullif(pr.reason,'') is not null then ' · ' || pr.reason else '' end,
  (pr.returned_at at time zone 'Europe/Moscow')::date,
  pr.operator_id,
  'MOYSKLAD_POS_RETURN',
  pr.moysklad_return_id
from public.pos_returns pr
left join public.pos_sales ps on ps.id=pr.pos_sale_id
left join public.cash_categories cc
  on cc.organization_id=pr.organization_id and cc.direction='EXPENSE' and cc.name='Возврат клиенту'
where pr.cash_account_id is not null
  and not exists (
    select 1 from public.cash_transactions ct
    where ct.organization_id=pr.organization_id
      and ct.external_source='MOYSKLAD_POS_RETURN'
      and ct.external_id=pr.moysklad_return_id
      and ct.direction='EXPENSE'
  );