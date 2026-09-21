create or replace function public.get_pos_hub_orders(p_query text default ''::text,p_limit integer default 50)
returns table(
  id uuid,
  order_number bigint,
  status public.order_status,
  total numeric,
  customer_id uuid,
  customer_name text,
  source text,
  created_at timestamptz,
  paid numeric,
  debt numeric
)
language plpgsql
security definer
set search_path = pg_catalog, public, auth
as $function$
declare
  v_org uuid;
begin
  if not (public.has_role('ADMIN') or public.has_role('POS_OPERATOR')) then
    raise exception 'POS_ACCESS_REQUIRED';
  end if;

  select o.id into v_org
  from public.organizations o
  where o.code='A4PRINT' and o.is_active=true
  limit 1;
  if v_org is null then raise exception 'A4PRINT_ORGANIZATION_REQUIRED'; end if;

  return query
  select o.id,o.order_number,o.status,o.total,o.customer_id,
         coalesce(nullif(c.company_name,''),nullif(c.full_name,''),'Клиент не указан') as customer_name,
         o.source,o.created_at,
         coalesce(sum(case when p.status='PAID' and p.payment_type='INCOME' then p.amount when p.status='PAID' and p.payment_type='REFUND' then -p.amount else 0 end),0)::numeric as paid,
         greatest(o.total-coalesce(sum(case when p.status='PAID' and p.payment_type='INCOME' then p.amount when p.status='PAID' and p.payment_type='REFUND' then -p.amount else 0 end),0),0)::numeric as debt
  from public.orders o
  left join public.customers c on c.id=o.customer_id
  left join public.payments p on p.order_id=o.id
  where o.organization_id=v_org
    and o.status<>'CANCELLED'
    and (
      coalesce(trim(p_query),'')=''
      or o.order_number::text ilike '%'||trim(p_query)||'%'
      or coalesce(c.full_name,'') ilike '%'||trim(p_query)||'%'
      or coalesce(c.company_name,'') ilike '%'||trim(p_query)||'%'
      or coalesce(c.phone,'') ilike '%'||trim(p_query)||'%'
      or coalesce(o.model_name,'') ilike '%'||trim(p_query)||'%'
    )
  group by o.id,c.company_name,c.full_name
  having
    greatest(o.total-coalesce(sum(case when p.status='PAID' and p.payment_type='INCOME' then p.amount when p.status='PAID' and p.payment_type='REFUND' then -p.amount else 0 end),0),0)>0
    or o.source in ('KASSA_STAMP_ORDER','KASSA_PARTNER_ORDER','KASSA_PRODUCTION_ORDER')
  order by o.created_at desc
  limit greatest(1,least(coalesce(p_limit,50),100));
end
$function$;
