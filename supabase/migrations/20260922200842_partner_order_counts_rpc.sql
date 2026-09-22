create or replace function public.get_partner_order_counts(p_partner_ids uuid[])
returns table(partner_id uuid, orders_count bigint)
language sql
stable
security invoker
set search_path = ''
as $$
  with refs as (
    select o.partner_id as partner_id
    from public.orders o
    where o.partner_id = any(coalesce(p_partner_ids,'{}'::uuid[]))
    union all
    select o.fulfillment_partner_id as partner_id
    from public.orders o
    where o.fulfillment_partner_id = any(coalesce(p_partner_ids,'{}'::uuid[]))
      and o.fulfillment_partner_id is distinct from o.partner_id
  )
  select r.partner_id,count(*)::bigint
  from refs r
  where r.partner_id is not null
  group by r.partner_id;
$$;

revoke execute on function public.get_partner_order_counts(uuid[]) from public;
revoke execute on function public.get_partner_order_counts(uuid[]) from anon;
revoke execute on function public.get_partner_order_counts(uuid[]) from authenticated;
grant execute on function public.get_partner_order_counts(uuid[]) to service_role;
