create or replace function public.get_reports_workspace(p_start timestamptz default null)
returns table (
  orders_count bigint, orders_value numeric, paid_total numeric, kassa_gross numeric,
  kassa_returns numeric, attention_count bigint, status_counts jsonb,
  payment_methods jsonb, activity jsonb
)
language sql stable security invoker set search_path=''
as $$
with ordinary_orders as (
  select o.id,o.status::text as status,coalesce(o.total,0)::numeric as total,o.created_at
  from public.orders o
  where (p_start is null or o.created_at>=p_start)
    and upper(coalesce(o.source,''))<>'KASSA'
    and upper(coalesce(o.partner_direction,''))<>'OUTBOUND'
    and o.partner_id is null and o.fulfillment_partner_id is null
),
all_order_payments as (
  select p.order_id,coalesce(sum(p.amount),0)::numeric as paid
  from public.payments p
  where p.order_id is not null
    and upper(coalesce(p.status,'')) in ('PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED')
  group by p.order_id
),
period_payments as (
  select p.id,p.order_id,p.status,p.amount,p.payment_method,p.created_at
  from public.payments p
  left join ordinary_orders o on o.id=p.order_id
  where (p_start is null or p.created_at>=p_start) and (p.order_id is null or o.id is not null)
),
valid_sales as (
  select s.id,coalesce(s.total,0)::numeric as total,coalesce(nullif(s.payment_method,''),'Не указан') as payment_method,
         coalesce(s.sold_at,s.created_at) as event_time,s.moysklad_sale_name
  from public.pos_sales s
  where (p_start is null or coalesce(s.sold_at,s.created_at)>=p_start)
    and upper(coalesce(s.sync_status,'')) not in ('FAILED','ERROR','CANCELLED')
),
valid_returns as (
  select r.id,coalesce(r.amount,0)::numeric as amount,coalesce(nullif(r.payment_method,''),'Не указан') as payment_method,
         coalesce(r.returned_at,r.created_at) as event_time,r.moysklad_return_name
  from public.pos_returns r
  where (p_start is null or coalesce(r.returned_at,r.created_at)>=p_start)
    and upper(coalesce(r.sync_status,'')) not in ('FAILED','ERROR','CANCELLED')
),
status_group as (
  select case when upper(status)='DONE' then 'COMPLETED' else upper(coalesce(status,'UNKNOWN')) end as status_key,count(*)::bigint as count
  from ordinary_orders group by 1
),
status_json as (select coalesce(jsonb_object_agg(status_key,count),'{}'::jsonb) as value from status_group),
attention_rows as (
  select o.id
  from ordinary_orders o
  left join all_order_payments ap on ap.order_id=o.id
  where upper(coalesce(o.status,'')) not in ('COMPLETED','DONE','CANCELLED')
    and (
      upper(coalesce(o.status,''))='ON_HOLD'
      or (upper(coalesce(o.status,''))='NEW' and now()-o.created_at>=interval '24 hours')
      or (upper(coalesce(o.status,'')) in ('CONFIRMED','IN_PROGRESS') and now()-o.created_at>=interval '72 hours')
      or (upper(coalesce(o.status,''))='READY' and now()-o.created_at>=interval '48 hours')
      or (o.total>0 and greatest(o.total-coalesce(ap.paid,0),0)>.01
        and (now()-o.created_at>=interval '24 hours' or upper(coalesce(o.status,'')) in ('READY','ON_HOLD')))
    )
),
method_events as (
  select s.payment_method,s.total as sales,0::numeric as returns,1::bigint as sale_count from valid_sales s
  union all
  select r.payment_method,0::numeric,r.amount,0::bigint from valid_returns r
),
method_group as (
  select payment_method,sum(sales)::numeric as sales,sum(returns)::numeric as returns,sum(sale_count)::bigint as count
  from method_events group by payment_method
),
method_json as (
  select coalesce(jsonb_agg(jsonb_build_object('name',payment_method,'sales',sales,'returns',returns,'count',count)
    order by (sales-returns) desc,payment_method),'[]'::jsonb) as value from method_group
),
activity_events as (
  select o.created_at as event_time,'ORDER'::text as kind,o.status as status,null::text as ref,o.total as amount,'order'::text as tone from ordinary_orders o
  union all
  select s.event_time,'SALE',null,s.moysklad_sale_name,s.total,'plus' from valid_sales s
  union all
  select r.event_time,'RETURN',null,r.moysklad_return_name,r.amount,'minus' from valid_returns r
),
activity_json as (
  select coalesce(jsonb_agg(jsonb_build_object('time',event_time,'kind',kind,'status',status,'ref',ref,'amount',amount,'tone',tone)
    order by event_time desc),'[]'::jsonb) as value
  from (select * from activity_events order by event_time desc limit 10) e
)
select
  (select count(*)::bigint from ordinary_orders),
  (select coalesce(sum(total),0)::numeric from ordinary_orders where upper(coalesce(status,''))<>'CANCELLED'),
  (select coalesce(sum(amount),0)::numeric from period_payments where upper(coalesce(status,'')) in ('PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED')),
  (select coalesce(sum(total),0)::numeric from valid_sales),
  (select coalesce(sum(amount),0)::numeric from valid_returns),
  (select count(*)::bigint from attention_rows),
  (select value from status_json),(select value from method_json),(select value from activity_json);
$$;

create or replace function public.get_reports_order_drilldown(
  p_start timestamptz default null,p_status text default 'ATTENTION',p_page integer default 1,p_page_size integer default 50
)
returns table (
  id uuid,order_number bigint,status text,total numeric,created_at timestamptz,model_name text,
  business_unit text,source text,customer_full_name text,customer_company_name text,debt numeric,
  attention_reason_codes text[],total_count bigint
)
language sql stable security invoker set search_path=''
as $$
with base as (
  select o.id,o.order_number,o.status::text as status,coalesce(o.total,0)::numeric as total,o.created_at,
         o.model_name,o.business_unit::text as business_unit,o.source,o.customer_id
  from public.orders o
  where (p_start is null or o.created_at>=p_start)
    and upper(coalesce(o.source,''))<>'KASSA'
    and upper(coalesce(o.partner_direction,''))<>'OUTBOUND'
    and o.partner_id is null and o.fulfillment_partner_id is null
),
payments as (
  select p.order_id,coalesce(sum(p.amount),0)::numeric as paid
  from public.payments p join base b on b.id=p.order_id
  where upper(coalesce(p.status,'')) in ('PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED')
  group by p.order_id
),
prepared as (
  select b.*,c.full_name as customer_full_name,c.company_name as customer_company_name,
    greatest(b.total-coalesce(p.paid,0),0)::numeric as debt,
    array_remove(array[
      case when upper(coalesce(b.status,''))='ON_HOLD' then 'ON_HOLD' end,
      case when upper(coalesce(b.status,''))='NEW' and now()-b.created_at>=interval '24 hours' then 'NEW_24H' end,
      case when upper(coalesce(b.status,'')) in ('CONFIRMED','IN_PROGRESS') and now()-b.created_at>=interval '72 hours' then 'WORK_72H' end,
      case when upper(coalesce(b.status,''))='READY' and now()-b.created_at>=interval '48 hours' then 'READY_48H' end,
      case when b.total>0 and greatest(b.total-coalesce(p.paid,0),0)>.01
        and (now()-b.created_at>=interval '24 hours' or upper(coalesce(b.status,'')) in ('READY','ON_HOLD')) then 'DEBT' end
    ],null)::text[] as attention_reason_codes
  from base b left join payments p on p.order_id=b.id left join public.customers c on c.id=b.customer_id
),
filtered as (
  select * from prepared
  where case
    when upper(coalesce(p_status,''))='ATTENTION'
      then upper(coalesce(status,'')) not in ('COMPLETED','DONE','CANCELLED') and cardinality(attention_reason_codes)>0
    when upper(coalesce(p_status,'')) in ('COMPLETED','DONE')
      then upper(coalesce(status,'')) in ('COMPLETED','DONE')
    else upper(coalesce(status,''))=upper(coalesce(p_status,''))
  end
)
select f.id,f.order_number,f.status,f.total,f.created_at,f.model_name,f.business_unit,f.source,
       f.customer_full_name,f.customer_company_name,f.debt,f.attention_reason_codes,count(*) over()::bigint
from filtered f
order by f.created_at desc,f.id
limit greatest(1,least(coalesce(p_page_size,50),100))
offset (greatest(coalesce(p_page,1),1)-1)*greatest(1,least(coalesce(p_page_size,50),100));
$$;

revoke execute on function public.get_reports_workspace(timestamptz) from public,anon;
grant execute on function public.get_reports_workspace(timestamptz) to authenticated,service_role;
revoke execute on function public.get_reports_order_drilldown(timestamptz,text,integer,integer) from public,anon;
grant execute on function public.get_reports_order_drilldown(timestamptz,text,integer,integer) to authenticated,service_role;
