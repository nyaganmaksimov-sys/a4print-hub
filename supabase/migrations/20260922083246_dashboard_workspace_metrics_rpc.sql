create or replace function public.get_dashboard_workspace_metrics(p_day_start timestamptz)
returns table (
  new_count bigint,
  work_count bigint,
  ready_count bigint,
  overdue_count bigint,
  unassigned_count bigint,
  a4_active bigint,
  a4_ready bigint,
  d3_active bigint,
  d3_ready bigint,
  low_stock_count bigint,
  low_stock_items jsonb,
  production_queued bigint,
  production_work bigint,
  production_done bigint,
  production_issues bigint,
  production_total bigint,
  pos_sales_count bigint,
  pos_sales_total numeric,
  pos_returns_count bigint,
  pos_returns_total numeric,
  pos_sync_issues bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with order_metrics as (
    select
      count(*) filter (where o.status::text = 'NEW')::bigint as new_count,
      count(*) filter (where o.status::text in ('CONFIRMED','IN_PROGRESS'))::bigint as work_count,
      count(*) filter (where o.status::text = 'READY')::bigint as ready_count,
      count(*) filter (where o.due_at is not null and o.due_at < now() and o.status::text not in ('COMPLETED','CANCELLED'))::bigint as overdue_count,
      count(*) filter (where o.assigned_to is null and o.status::text in ('NEW','CONFIRMED','IN_PROGRESS'))::bigint as unassigned_count,
      count(*) filter (where o.business_unit::text = 'A4_PRINT' and o.status::text in ('NEW','CONFIRMED','IN_PROGRESS'))::bigint as a4_active,
      count(*) filter (where o.business_unit::text = 'A4_PRINT' and o.status::text = 'READY')::bigint as a4_ready,
      count(*) filter (where o.business_unit::text = '3D_ARTPRINT' and o.status::text in ('NEW','CONFIRMED','IN_PROGRESS'))::bigint as d3_active,
      count(*) filter (where o.business_unit::text = '3D_ARTPRINT' and o.status::text = 'READY')::bigint as d3_ready
    from public.orders o
  ),
  stock_rows as (
    select c.id,c.name,coalesce(c.min_stock,0)::numeric as min_stock,
      coalesce(sum(case when it.transaction_type in ('RECEIPT','TRANSFER_IN','PRODUCTION_IN','ADJUSTMENT')
        then coalesce(it.quantity,0) else -coalesce(it.quantity,0) end),0)::numeric as quantity
    from public.catalog_items c
    left join public.inventory_transactions it on it.catalog_item_id = c.id
    where c.is_active = true
    group by c.id,c.name,c.min_stock
  ),
  low_stock as (
    select * from stock_rows where quantity <= min_stock
  ),
  stock_metrics as (
    select count(*)::bigint as low_stock_count,
      coalesce((select jsonb_agg(jsonb_build_object('id',x.id,'name',x.name,'qty',x.quantity,'min_stock',x.min_stock)
        order by x.quantity asc,x.name asc)
        from (select id,name,quantity,min_stock from low_stock order by quantity asc,name asc limit 5) x),'[]'::jsonb) as low_stock_items
    from low_stock
  ),
  production_metrics as (
    select
      count(*) filter (where p.status::text in ('NEW','QUEUED'))::bigint as production_queued,
      count(*) filter (where p.status::text in ('IN_PROGRESS','PAUSED'))::bigint as production_work,
      count(*) filter (where p.status::text = 'DONE')::bigint as production_done,
      count(*) filter (where p.status::text = 'PAUSED' or (p.deadline_at is not null and p.deadline_at < now() and p.status::text not in ('DONE','CANCELLED')))::bigint as production_issues,
      count(*)::bigint as production_total
    from public.production_jobs p
  ),
  sales_metrics as (
    select count(*) filter (where s.sold_at >= p_day_start)::bigint as pos_sales_count,
      coalesce(sum(s.total) filter (where s.sold_at >= p_day_start),0)::numeric as pos_sales_total,
      count(*) filter (where s.sync_status in ('FAILED','WARNING'))::bigint as sales_sync_issues
    from public.pos_sales s
  ),
  returns_metrics as (
    select count(*) filter (where r.returned_at >= p_day_start)::bigint as pos_returns_count,
      coalesce(sum(r.amount) filter (where r.returned_at >= p_day_start),0)::numeric as pos_returns_total,
      count(*) filter (where r.sync_status in ('FAILED','WARNING'))::bigint as return_sync_issues
    from public.pos_returns r
  )
  select o.new_count,o.work_count,o.ready_count,o.overdue_count,o.unassigned_count,
    o.a4_active,o.a4_ready,o.d3_active,o.d3_ready,s.low_stock_count,s.low_stock_items,
    p.production_queued,p.production_work,p.production_done,p.production_issues,p.production_total,
    x.pos_sales_count,x.pos_sales_total,r.pos_returns_count,r.pos_returns_total,
    (x.sales_sync_issues + r.return_sync_issues)::bigint as pos_sync_issues
  from order_metrics o
  cross join stock_metrics s
  cross join production_metrics p
  cross join sales_metrics x
  cross join returns_metrics r;
$$;

revoke execute on function public.get_dashboard_workspace_metrics(timestamptz) from public;
revoke execute on function public.get_dashboard_workspace_metrics(timestamptz) from anon;
grant execute on function public.get_dashboard_workspace_metrics(timestamptz) to authenticated;
grant execute on function public.get_dashboard_workspace_metrics(timestamptz) to service_role;
