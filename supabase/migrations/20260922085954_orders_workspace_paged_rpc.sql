create or replace function public.get_orders_workspace_page(
  p_query text default '',
  p_status text default '',
  p_unit text default '',
  p_attention text default '',
  p_page integer default 1,
  p_page_size integer default 50
)
returns table (
  id uuid,
  order_number bigint,
  business_unit text,
  customer_id uuid,
  assigned_to uuid,
  status text,
  total numeric,
  source text,
  model_name text,
  created_at timestamptz,
  due_at timestamptz,
  fulfillment_partner_id uuid,
  partner_direction text,
  partner_workflow text,
  partner_fulfillment_status text,
  customer_full_name text,
  customer_company_name text,
  customer_phone text,
  customer_email text,
  executor_name text,
  item_name text,
  paid_amount numeric,
  has_production boolean,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with payment_totals as (
    select p.order_id, coalesce(sum(p.amount),0)::numeric as paid_amount
    from public.payments p
    where upper(coalesce(p.status,'')) not in ('CANCELLED','FAILED','REFUNDED')
    group by p.order_id
  ),
  production_flags as (
    select distinct j.order_id from public.production_jobs j where j.order_id is not null
  ),
  scoped as (
    select
      o.id,o.order_number,o.business_unit::text as business_unit,o.customer_id,o.assigned_to,
      o.status::text as status,coalesce(o.total,0)::numeric as total,o.source,o.model_name,
      o.created_at,o.due_at,o.fulfillment_partner_id,coalesce(o.partner_direction,'NONE') as partner_direction,
      coalesce(o.partner_workflow,'NONE') as partner_workflow,o.partner_fulfillment_status,
      c.full_name as customer_full_name,c.company_name as customer_company_name,
      c.phone as customer_phone,c.email as customer_email,ep.name as executor_name,
      oi.name as item_name,coalesce(pt.paid_amount,0)::numeric as paid_amount,
      (pf.order_id is not null) as has_production,
      greatest(coalesce(o.total,0)-coalesce(pt.paid_amount,0),0)::numeric as debt,
      extract(epoch from (now()-o.created_at))/3600.0 as age_hours
    from public.orders o
    left join public.customers c on c.id=o.customer_id
    left join public.partners ep on ep.id=o.fulfillment_partner_id
    left join payment_totals pt on pt.order_id=o.id
    left join production_flags pf on pf.order_id=o.id
    left join lateral (
      select x.name from public.order_items x
      where x.order_id=o.id order by x.id limit 1
    ) oi on true
    where upper(coalesce(o.source,'')) <> 'KASSA'
      and upper(coalesce(o.partner_direction,'NONE')) in ('NONE','OUTBOUND')
      and (
        (upper(coalesce(o.partner_direction,'NONE'))='OUTBOUND'
          and o.fulfillment_partner_id is not null
          and upper(coalesce(o.partner_workflow,'NONE')) <> 'NONE')
        or
        (upper(coalesce(o.partner_direction,'NONE'))='NONE' and o.partner_id is null)
      )
  ),
  filtered as (
    select s.* from scoped s
    where (
      nullif(trim(p_query),'') is null
      or lower(concat_ws(' ',s.order_number::text,s.model_name,s.source,s.customer_full_name,
        s.customer_company_name,s.customer_phone,s.customer_email,s.executor_name,s.item_name,
        s.partner_fulfillment_status)) like '%'||lower(trim(p_query))||'%'
    )
    and (
      nullif(trim(p_status),'') is null
      or (upper(trim(p_status))='WORK' and s.status in ('CONFIRMED','IN_PROGRESS'))
      or (upper(trim(p_status))<>'WORK' and s.status=upper(trim(p_status)))
    )
    and (nullif(trim(p_unit),'') is null or s.business_unit=upper(trim(p_unit)))
    and (
      nullif(trim(p_attention),'') is null
      or (upper(trim(p_attention))='UNPAID' and s.debt > 0.01)
      or (upper(trim(p_attention))='OVERDUE_PAYMENT' and s.debt > 0.01 and (s.age_hours >= 24 or s.status in ('READY','ON_HOLD')))
      or (
        upper(trim(p_attention))='OVERDUE_PRODUCTION' and s.status in ('CONFIRMED','IN_PROGRESS')
        and ((s.due_at is not null and s.due_at < now()) or (s.due_at is null and s.age_hours >= 72))
      )
      or (
        upper(trim(p_attention))='NO_PRODUCTION'
        and s.status in ('NEW','CONFIRMED','IN_PROGRESS','READY') and s.has_production=false
      )
      or (
        upper(trim(p_attention))='ATTENTION'
        and (
          s.status='ON_HOLD'
          or (s.status='NEW' and s.age_hours >= 24)
          or (s.status in ('CONFIRMED','IN_PROGRESS')
            and ((s.due_at is not null and s.due_at < now()) or (s.due_at is null and s.age_hours >= 72)))
          or (s.status='READY' and s.age_hours >= 48)
          or (s.debt > 0.01 and (s.age_hours >= 24 or s.status in ('READY','ON_HOLD')))
        )
      )
    )
  )
  select
    f.id,f.order_number,f.business_unit,f.customer_id,f.assigned_to,f.status,f.total,f.source,
    f.model_name,f.created_at,f.due_at,f.fulfillment_partner_id,f.partner_direction,f.partner_workflow,
    f.partner_fulfillment_status,f.customer_full_name,f.customer_company_name,f.customer_phone,
    f.customer_email,f.executor_name,f.item_name,f.paid_amount,f.has_production,
    count(*) over()::bigint as total_count
  from filtered f
  order by f.created_at desc,f.order_number desc
  limit greatest(1,least(coalesce(p_page_size,50),100))
  offset (greatest(coalesce(p_page,1),1)-1)*greatest(1,least(coalesce(p_page_size,50),100));
$$;

create or replace function public.get_orders_workspace_metrics()
returns table (
  all_count bigint,
  new_count bigint,
  work_count bigint,
  ready_count bigint,
  attention_count bigint,
  active_total numeric
)
language sql
stable
security invoker
set search_path = ''
as $$
  with payment_totals as (
    select p.order_id, coalesce(sum(p.amount),0)::numeric as paid_amount
    from public.payments p
    where upper(coalesce(p.status,'')) not in ('CANCELLED','FAILED','REFUNDED')
    group by p.order_id
  ),
  scoped as (
    select o.status::text as status,coalesce(o.total,0)::numeric as total,o.created_at,o.due_at,
      greatest(coalesce(o.total,0)-coalesce(pt.paid_amount,0),0)::numeric as debt,
      extract(epoch from (now()-o.created_at))/3600.0 as age_hours
    from public.orders o
    left join payment_totals pt on pt.order_id=o.id
    where upper(coalesce(o.source,'')) <> 'KASSA'
      and upper(coalesce(o.partner_direction,'NONE')) in ('NONE','OUTBOUND')
      and (
        (upper(coalesce(o.partner_direction,'NONE'))='OUTBOUND'
          and o.fulfillment_partner_id is not null
          and upper(coalesce(o.partner_workflow,'NONE')) <> 'NONE')
        or
        (upper(coalesce(o.partner_direction,'NONE'))='NONE' and o.partner_id is null)
      )
  )
  select
    count(*)::bigint,
    count(*) filter (where s.status='NEW')::bigint,
    count(*) filter (where s.status in ('CONFIRMED','IN_PROGRESS'))::bigint,
    count(*) filter (where s.status='READY')::bigint,
    count(*) filter (
      where s.status='ON_HOLD'
        or (s.status='NEW' and s.age_hours >= 24)
        or (s.status in ('CONFIRMED','IN_PROGRESS')
          and ((s.due_at is not null and s.due_at < now()) or (s.due_at is null and s.age_hours >= 72)))
        or (s.status='READY' and s.age_hours >= 48)
        or (s.debt > 0.01 and (s.age_hours >= 24 or s.status in ('READY','ON_HOLD')))
    )::bigint,
    coalesce(sum(s.total) filter (where s.status in ('NEW','CONFIRMED','IN_PROGRESS','READY')),0)::numeric
  from scoped s;
$$;

revoke execute on function public.get_orders_workspace_page(text,text,text,text,integer,integer) from public;
revoke execute on function public.get_orders_workspace_page(text,text,text,text,integer,integer) from anon;
grant execute on function public.get_orders_workspace_page(text,text,text,text,integer,integer) to authenticated;
grant execute on function public.get_orders_workspace_page(text,text,text,text,integer,integer) to service_role;
revoke execute on function public.get_orders_workspace_metrics() from public;
revoke execute on function public.get_orders_workspace_metrics() from anon;
grant execute on function public.get_orders_workspace_metrics() to authenticated;
grant execute on function public.get_orders_workspace_metrics() to service_role;
