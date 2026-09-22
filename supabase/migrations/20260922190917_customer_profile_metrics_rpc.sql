create or replace function public.get_customer_profile_metrics(p_customer_id uuid)
returns table (
  orders_count bigint,
  order_value numeric,
  paid_total numeric,
  pos_total numeric,
  invoiced_total numeric,
  invoice_outstanding numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with order_metrics as (
    select count(*)::bigint as orders_count,
      coalesce(sum(o.total) filter (where upper(coalesce(o.status::text,'')) not in ('CANCELLED','CANCELED')),0)::numeric as order_value
    from public.orders o
    where o.customer_id=p_customer_id and upper(coalesce(o.source::text,'')) <> 'KASSA'
  ),
  payment_metrics as (
    select coalesce(sum(p.amount),0)::numeric as paid_total
    from public.payments p
    where p.customer_id=p_customer_id
      and upper(coalesce(p.status::text,'')) in ('PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED')
  ),
  pos_metrics as (
    select coalesce(sum(s.total),0)::numeric as pos_total
    from public.pos_sales s
    where s.customer_id=p_customer_id
      and upper(coalesce(s.sync_status::text,'')) not in ('FAILED','ERROR','CANCELLED')
  ),
  docs as (
    select d.id,coalesce(d.amount,0)::numeric as amount
    from public.customer_documents d
    where d.customer_id=p_customer_id and upper(coalesce(d.status,'')) <> 'CANCELLED'
  ),
  doc_paid as (
    select p.customer_document_id,coalesce(sum(p.amount),0)::numeric as paid
    from public.payments p join docs d on d.id=p.customer_document_id
    where upper(coalesce(p.status::text,'')) in ('PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED')
    group by p.customer_document_id
  ),
  doc_metrics as (
    select coalesce(sum(d.amount),0)::numeric as invoiced_total,
      coalesce(sum(greatest(d.amount-coalesce(dp.paid,0),0)),0)::numeric as invoice_outstanding
    from docs d left join doc_paid dp on dp.customer_document_id=d.id
  )
  select o.orders_count,o.order_value,p.paid_total,s.pos_total,d.invoiced_total,d.invoice_outstanding
  from order_metrics o cross join payment_metrics p cross join pos_metrics s cross join doc_metrics d;
$$;

revoke execute on function public.get_customer_profile_metrics(uuid) from public;
revoke execute on function public.get_customer_profile_metrics(uuid) from anon;
grant execute on function public.get_customer_profile_metrics(uuid) to authenticated;
grant execute on function public.get_customer_profile_metrics(uuid) to service_role;
