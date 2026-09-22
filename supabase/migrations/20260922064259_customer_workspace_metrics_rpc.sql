create or replace function public.get_customer_workspace_metrics()
returns table (
  customer_id uuid,
  orders_count bigint,
  order_sum numeric,
  paid_total numeric,
  pos_total numeric,
  last_activity timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with activity as (
    select
      o.customer_id,
      1::bigint as orders_count,
      case
        when upper(coalesce(o.status::text,'')) not in ('CANCELLED','CANCELED') then coalesce(o.total,0)
        else 0
      end::numeric as order_sum,
      0::numeric as paid_total,
      0::numeric as pos_total,
      o.created_at as activity_at
    from public.orders o
    where o.customer_id is not null
      and upper(coalesce(o.source::text,'')) <> 'KASSA'

    union all

    select
      p.customer_id,
      0::bigint,
      0::numeric,
      coalesce(p.amount,0)::numeric,
      0::numeric,
      coalesce(p.paid_at,p.created_at)
    from public.payments p
    where p.customer_id is not null
      and upper(coalesce(p.status::text,'')) in ('PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED')

    union all

    select
      s.customer_id,
      0::bigint,
      0::numeric,
      0::numeric,
      coalesce(s.total,0)::numeric,
      coalesce(s.sold_at,s.created_at)
    from public.pos_sales s
    where s.customer_id is not null
      and upper(coalesce(s.sync_status::text,'')) not in ('FAILED','ERROR','CANCELLED')
  )
  select
    a.customer_id,
    sum(a.orders_count)::bigint,
    sum(a.order_sum)::numeric,
    sum(a.paid_total)::numeric,
    sum(a.pos_total)::numeric,
    max(a.activity_at)
  from activity a
  group by a.customer_id;
$$;

revoke execute on function public.get_customer_workspace_metrics() from public;
revoke execute on function public.get_customer_workspace_metrics() from anon;
grant execute on function public.get_customer_workspace_metrics() to authenticated;
grant execute on function public.get_customer_workspace_metrics() to service_role;
