create or replace function public.get_customers_workspace_page(
  p_query text default '',
  p_type text default '',
  p_activity text default '',
  p_sort text default 'activity',
  p_page integer default 1,
  p_page_size integer default 50
)
returns table (
  id uuid,
  customer_type text,
  full_name text,
  company_name text,
  legal_name text,
  phone text,
  email text,
  inn text,
  telegram text,
  whatsapp text,
  vk text,
  created_at timestamptz,
  updated_at timestamptz,
  orders_count bigint,
  order_sum numeric,
  paid_total numeric,
  pos_total numeric,
  last_activity timestamptz,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with activity as (
    select o.customer_id,1::bigint as orders_count,
      case when upper(coalesce(o.status::text,'')) not in ('CANCELLED','CANCELED') then coalesce(o.total,0) else 0 end::numeric as order_sum,
      0::numeric as paid_total,0::numeric as pos_total,o.created_at as activity_at
    from public.orders o
    where o.customer_id is not null and upper(coalesce(o.source::text,'')) <> 'KASSA'
    union all
    select p.customer_id,0::bigint,0::numeric,coalesce(p.amount,0)::numeric,0::numeric,coalesce(p.paid_at,p.created_at)
    from public.payments p
    where p.customer_id is not null
      and upper(coalesce(p.status::text,'')) in ('PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED')
    union all
    select s.customer_id,0::bigint,0::numeric,0::numeric,coalesce(s.total,0)::numeric,coalesce(s.sold_at,s.created_at)
    from public.pos_sales s
    where s.customer_id is not null
      and upper(coalesce(s.sync_status::text,'')) not in ('FAILED','ERROR','CANCELLED')
  ),
  metrics as (
    select a.customer_id,sum(a.orders_count)::bigint as orders_count,sum(a.order_sum)::numeric as order_sum,
      sum(a.paid_total)::numeric as paid_total,sum(a.pos_total)::numeric as pos_total,max(a.activity_at) as last_activity
    from activity a group by a.customer_id
  ),
  scoped as (
    select c.id,c.customer_type,c.full_name,c.company_name,c.legal_name,c.phone,c.email,c.inn,c.telegram,c.whatsapp,c.vk,
      c.created_at,c.updated_at,coalesce(m.orders_count,0)::bigint as orders_count,coalesce(m.order_sum,0)::numeric as order_sum,
      coalesce(m.paid_total,0)::numeric as paid_total,coalesce(m.pos_total,0)::numeric as pos_total,
      greatest(coalesce(c.updated_at,'epoch'::timestamptz),coalesce(c.created_at,'epoch'::timestamptz),coalesce(m.last_activity,'epoch'::timestamptz)) as last_activity
    from public.customers c left join metrics m on m.customer_id=c.id
  ),
  filtered as (
    select s.* from scoped s
    where (
      nullif(trim(p_query),'') is null
      or lower(concat_ws(' ',s.full_name,s.company_name,s.legal_name,s.phone,s.email,s.inn,s.telegram,s.whatsapp,s.vk))
         like '%'||lower(trim(p_query))||'%'
    )
    and (nullif(trim(p_type),'') is null or upper(coalesce(s.customer_type,''))=upper(trim(p_type)))
    and (
      nullif(trim(p_activity),'') is null
      or (lower(trim(p_activity))='orders' and s.orders_count>0)
      or (lower(trim(p_activity))='pos' and s.pos_total>0)
      or (lower(trim(p_activity))='none' and s.orders_count=0 and s.pos_total=0 and s.paid_total=0)
    )
  )
  select f.id,f.customer_type,f.full_name,f.company_name,f.legal_name,f.phone,f.email,f.inn,f.telegram,f.whatsapp,f.vk,
    f.created_at,f.updated_at,f.orders_count,f.order_sum,f.paid_total,f.pos_total,f.last_activity,count(*) over()::bigint
  from filtered f
  order by
    case when lower(coalesce(p_sort,'activity'))='name' then lower(coalesce(f.full_name,f.company_name,f.legal_name,'')) end asc nulls last,
    case when lower(coalesce(p_sort,'activity'))='orders' then f.orders_count end desc nulls last,
    case when lower(coalesce(p_sort,'activity'))='value' then f.order_sum end desc nulls last,
    case when lower(coalesce(p_sort,'activity')) in ('activity','orders','value') then f.last_activity end desc nulls last,
    f.id
  limit greatest(1,least(coalesce(p_page_size,50),100))
  offset (greatest(coalesce(p_page,1),1)-1)*greatest(1,least(coalesce(p_page_size,50),100));
$$;

create or replace function public.get_customers_workspace_summary()
returns table (customers_count bigint,companies_count bigint,with_orders_count bigint,paid_total numeric)
language sql
stable
security invoker
set search_path = ''
as $$
  with order_customers as (
    select distinct o.customer_id from public.orders o
    where o.customer_id is not null and upper(coalesce(o.source::text,'')) <> 'KASSA'
  ),
  paid as (
    select coalesce(sum(p.amount),0)::numeric as total from public.payments p
    where p.customer_id is not null
      and upper(coalesce(p.status::text,'')) in ('PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED')
  )
  select count(*)::bigint,
    count(*) filter (where upper(coalesce(c.customer_type,'')) in ('LEGAL','IP') or nullif(trim(coalesce(c.company_name,'')),'') is not null)::bigint,
    count(*) filter (where oc.customer_id is not null)::bigint,
    (select total from paid)::numeric
  from public.customers c left join order_customers oc on oc.customer_id=c.id;
$$;

revoke execute on function public.get_customers_workspace_page(text,text,text,text,integer,integer) from public;
revoke execute on function public.get_customers_workspace_page(text,text,text,text,integer,integer) from anon;
grant execute on function public.get_customers_workspace_page(text,text,text,text,integer,integer) to authenticated;
grant execute on function public.get_customers_workspace_page(text,text,text,text,integer,integer) to service_role;
revoke execute on function public.get_customers_workspace_summary() from public;
revoke execute on function public.get_customers_workspace_summary() from anon;
grant execute on function public.get_customers_workspace_summary() to authenticated;
grant execute on function public.get_customers_workspace_summary() to service_role;
