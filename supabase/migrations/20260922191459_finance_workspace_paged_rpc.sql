create index if not exists payments_organization_created_at_idx on public.payments (organization_id, created_at desc);
create index if not exists customer_documents_created_at_idx on public.customer_documents (created_at desc);
create index if not exists documents_created_at_idx on public.documents (created_at desc);

create or replace function public.get_payments_workspace_page(
  p_query text default '', p_status text default '', p_method text default '',
  p_page integer default 1, p_page_size integer default 50
)
returns table (
  id uuid, customer_id uuid, order_id uuid, customer_document_id uuid,
  payment_number text, status text, amount numeric, currency text, payment_method text,
  paid_at timestamptz, note text, created_at timestamptz,
  customer_full_name text, customer_company_name text, order_number bigint,
  document_number text, total_count bigint
)
language sql stable security invoker set search_path = ''
as $$
  select p.id,p.customer_id,p.order_id,p.customer_document_id,p.payment_number,p.status,
    p.amount,p.currency,p.payment_method,p.paid_at,p.note,p.created_at,
    c.full_name,c.company_name,o.order_number,d.document_number,count(*) over()::bigint
  from public.payments p
  left join public.customers c on c.id=p.customer_id
  left join public.orders o on o.id=p.order_id
  left join public.customer_documents d on d.id=p.customer_document_id
  where p.organization_id=public.current_user_organization_id()
    and (nullif(trim(p_query),'') is null
      or lower(concat_ws(' ',p.payment_number,p.note,p.payment_method,p.status,
        c.full_name,c.company_name,o.order_number::text,d.document_number))
        like '%'||lower(trim(p_query))||'%')
    and (nullif(trim(p_status),'') is null or upper(coalesce(p.status,''))=upper(trim(p_status)))
    and (nullif(trim(p_method),'') is null or lower(coalesce(p.payment_method,''))=lower(trim(p_method)))
  order by p.created_at desc,p.id
  limit greatest(1,least(coalesce(p_page_size,50),100))
  offset (greatest(coalesce(p_page,1),1)-1)*greatest(1,least(coalesce(p_page_size,50),100));
$$;

create or replace function public.get_payments_workspace_metrics()
returns table (payments_count bigint,confirmed_total numeric,pending_total numeric,unlinked_count bigint)
language sql stable security invoker set search_path = ''
as $$
  select count(*)::bigint,
    coalesce(sum(p.amount) filter (where upper(coalesce(p.status,'')) in ('PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED')),0)::numeric,
    coalesce(sum(p.amount) filter (where upper(coalesce(p.status,'')) not in ('PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED','CANCELLED','FAILED','REFUNDED')),0)::numeric,
    count(*) filter (where p.order_id is null and p.customer_document_id is null)::bigint
  from public.payments p
  where p.organization_id=public.current_user_organization_id();
$$;

create or replace function public.get_documents_workspace_page(
  p_query text default '', p_source text default '', p_status text default '',
  p_page integer default 1, p_page_size integer default 50
)
returns table (
  kind text,id uuid,document_number text,status text,title text,description text,
  customer_id uuid,order_id uuid,issue_date date,due_date date,valid_until date,notes text,
  display_amount numeric,paid_amount numeric,outstanding_amount numeric,is_overdue boolean,
  created_at timestamptz,customer_full_name text,customer_company_name text,
  order_number bigint,total_count bigint
)
language sql stable security invoker set search_path = ''
as $$
  with payment_totals as (
    select p.customer_document_id,coalesce(sum(p.amount),0)::numeric as paid
    from public.payments p
    where p.customer_document_id is not null
      and p.organization_id=public.current_user_organization_id()
      and upper(coalesce(p.status,'')) in ('PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED')
    group by p.customer_document_id
  ),
  invoice_rows as (
    select 'INVOICE'::text as kind,d.id,d.document_number,d.status::text,d.title,d.description,
      d.customer_id,d.order_id,d.issue_date,d.due_date,null::date as valid_until,d.notes,
      coalesce(d.amount,0)::numeric as display_amount,coalesce(pt.paid,0)::numeric as paid_amount,
      greatest(coalesce(d.amount,0)-coalesce(pt.paid,0),0)::numeric as outstanding_amount,
      (d.due_date is not null and d.due_date<current_date
        and greatest(coalesce(d.amount,0)-coalesce(pt.paid,0),0)>0
        and upper(coalesce(d.status,'')) not in ('PAID','CANCELLED','ARCHIVED')) as is_overdue,
      d.created_at,c.full_name,c.company_name,o.order_number
    from public.customer_documents d
    left join payment_totals pt on pt.customer_document_id=d.id
    left join public.customers c on c.id=d.customer_id
    left join public.orders o on o.id=d.order_id
  ),
  hub_rows as (
    select 'HUB'::text,d.id,d.document_number,d.status::text,d.title,null::text,
      d.customer_id,d.order_id,d.issue_date,null::date,d.valid_until,d.notes,
      case when coalesce(d.metadata->>'amount','') ~ '^-?[0-9]+([.][0-9]+)?$'
        then (d.metadata->>'amount')::numeric else 0::numeric end,
      0::numeric,0::numeric,false,d.created_at,c.full_name,c.company_name,o.order_number
    from public.documents d
    left join public.customers c on c.id=d.customer_id
    left join public.orders o on o.id=d.order_id
  ),
  combined as (select * from invoice_rows union all select * from hub_rows),
  filtered as (
    select x.* from combined x
    where (nullif(trim(p_query),'') is null
      or lower(concat_ws(' ',x.document_number,x.title,x.description,x.notes,
        x.customer_full_name,x.customer_company_name,x.order_number::text))
        like '%'||lower(trim(p_query))||'%')
      and (nullif(trim(p_source),'') is null or x.kind=upper(trim(p_source)))
      and (nullif(trim(p_status),'') is null or upper(coalesce(x.status,''))=upper(trim(p_status)))
  )
  select f.kind,f.id,f.document_number,f.status,f.title,f.description,f.customer_id,f.order_id,
    f.issue_date,f.due_date,f.valid_until,f.notes,f.display_amount,f.paid_amount,f.outstanding_amount,
    f.is_overdue,f.created_at,f.customer_full_name,f.customer_company_name,f.order_number,
    count(*) over()::bigint
  from filtered f
  order by f.created_at desc,f.id
  limit greatest(1,least(coalesce(p_page_size,50),100))
  offset (greatest(coalesce(p_page,1),1)-1)*greatest(1,least(coalesce(p_page_size,50),100));
$$;

create or replace function public.get_documents_workspace_metrics()
returns table (docs_count bigint,invoice_count bigint,issued_total numeric,overdue_total numeric)
language sql stable security invoker set search_path = ''
as $$
  with payment_totals as (
    select p.customer_document_id,coalesce(sum(p.amount),0)::numeric as paid
    from public.payments p
    where p.customer_document_id is not null
      and p.organization_id=public.current_user_organization_id()
      and upper(coalesce(p.status,'')) in ('PAID','COMPLETED','SUCCESS','SUCCESSFUL','CONFIRMED','CAPTURED')
    group by p.customer_document_id
  ),
  invoice_metrics as (
    select count(*)::bigint as invoice_count,
      coalesce(sum(d.amount) filter (where upper(coalesce(d.status,''))<>'CANCELLED'),0)::numeric as issued_total,
      coalesce(sum(greatest(coalesce(d.amount,0)-coalesce(pt.paid,0),0)) filter (
        where d.due_date is not null and d.due_date<current_date
          and greatest(coalesce(d.amount,0)-coalesce(pt.paid,0),0)>0
          and upper(coalesce(d.status,'')) not in ('PAID','CANCELLED','ARCHIVED')
      ),0)::numeric as overdue_total
    from public.customer_documents d left join payment_totals pt on pt.customer_document_id=d.id
  ),
  hub_metrics as (select count(*)::bigint as hub_count from public.documents)
  select (i.invoice_count+h.hub_count)::bigint,i.invoice_count,i.issued_total,i.overdue_total
  from invoice_metrics i cross join hub_metrics h;
$$;

revoke execute on function public.get_payments_workspace_page(text,text,text,integer,integer) from public,anon;
grant execute on function public.get_payments_workspace_page(text,text,text,integer,integer) to authenticated,service_role;
revoke execute on function public.get_payments_workspace_metrics() from public,anon;
grant execute on function public.get_payments_workspace_metrics() to authenticated,service_role;
revoke execute on function public.get_documents_workspace_page(text,text,text,integer,integer) from public,anon;
grant execute on function public.get_documents_workspace_page(text,text,text,integer,integer) to authenticated,service_role;
revoke execute on function public.get_documents_workspace_metrics() from public,anon;
grant execute on function public.get_documents_workspace_metrics() to authenticated,service_role;
