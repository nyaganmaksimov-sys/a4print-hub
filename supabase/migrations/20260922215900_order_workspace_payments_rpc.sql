create or replace function public.get_order_workspace_payments(p_order_id uuid)
returns table (
  id uuid,
  order_id uuid,
  customer_document_id uuid,
  payment_number text,
  status text,
  amount numeric,
  payment_method text,
  paid_at timestamptz,
  created_at timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  select
    p.id,p.order_id,p.customer_document_id,p.payment_number,p.status,p.amount,
    p.payment_method,p.paid_at,p.created_at
  from public.payments p
  where p.order_id=p_order_id
     or exists (
       select 1
       from public.customer_documents d
       where d.id=p.customer_document_id
         and d.order_id=p_order_id
     )
  order by coalesce(p.paid_at,p.created_at) desc,p.created_at desc;
$$;

revoke execute on function public.get_order_workspace_payments(uuid) from public;
revoke execute on function public.get_order_workspace_payments(uuid) from anon;
grant execute on function public.get_order_workspace_payments(uuid) to authenticated;
grant execute on function public.get_order_workspace_payments(uuid) to service_role;
