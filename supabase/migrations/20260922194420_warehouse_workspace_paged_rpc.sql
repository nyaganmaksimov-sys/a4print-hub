create or replace function public.get_warehouse_catalog_page(
  p_query text default '',
  p_type text default '',
  p_source text default '',
  p_stock text default '',
  p_ms_ids uuid[] default null,
  p_page integer default 1,
  p_page_size integer default 50
)
returns table (
  id uuid,
  organization_id uuid,
  sku text,
  name text,
  item_type text,
  category text,
  unit text,
  description text,
  sale_price numeric,
  cost_price numeric,
  min_stock numeric,
  is_active boolean,
  external_source text,
  external_id text,
  external_href text,
  article text,
  barcode text,
  external_updated_at timestamptz,
  last_synced_at timestamptz,
  local_balance numeric,
  total_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with balances as (
    select b.catalog_item_id,coalesce(sum(b.quantity),0)::numeric as local_balance
    from public.inventory_balances b
    group by b.catalog_item_id
  ),
  scoped as (
    select
      c.id,c.organization_id,c.sku,c.name,c.item_type,c.category,c.unit,c.description,
      c.sale_price,c.cost_price,c.min_stock,c.is_active,c.external_source,c.external_id,
      c.external_href,c.article,c.barcode,c.external_updated_at,c.last_synced_at,
      coalesce(b.local_balance,0)::numeric as local_balance,
      (c.external_source='MOYSKLAD' and c.external_id is not null) as is_ms
    from public.catalog_items c
    left join balances b on b.catalog_item_id=c.id
  ),
  filtered as (
    select s.*
    from scoped s
    where (
      nullif(trim(p_query),'') is null
      or lower(concat_ws(' ',s.name,s.sku,s.article,s.barcode,s.category))
        like '%'||lower(trim(p_query))||'%'
    )
    and (nullif(trim(p_type),'') is null or s.item_type=upper(trim(p_type)))
    and (
      nullif(trim(p_source),'') is null
      or (upper(trim(p_source))='MS' and s.is_ms)
      or (upper(trim(p_source))='LOCAL' and not s.is_ms)
    )
    and (
      nullif(trim(p_stock),'') is null
      or (
        s.item_type<>'SERVICE'
        and (
          (s.is_ms and s.id=any(coalesce(p_ms_ids,'{}'::uuid[])))
          or (
            not s.is_ms
            and (
              (lower(trim(p_stock))='positive' and s.local_balance>0)
              or (lower(trim(p_stock))='zero' and s.local_balance=0)
              or (lower(trim(p_stock))='low' and s.local_balance<=coalesce(s.min_stock,0))
            )
          )
        )
      )
    )
  )
  select
    f.id,f.organization_id,f.sku,f.name,f.item_type,f.category,f.unit,f.description,
    f.sale_price,f.cost_price,f.min_stock,f.is_active,f.external_source,f.external_id,
    f.external_href,f.article,f.barcode,f.external_updated_at,f.last_synced_at,
    f.local_balance,count(*) over()::bigint
  from filtered f
  order by lower(coalesce(f.name,'')),f.id
  limit greatest(1,least(coalesce(p_page_size,50),100))
  offset (greatest(coalesce(p_page,1),1)-1)*greatest(1,least(coalesce(p_page_size,50),100));
$$;

create or replace function public.get_warehouse_catalog_metrics()
returns table (
  items_count bigint,
  linked_count bigint,
  local_available_count bigint,
  local_low_count bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  with balances as (
    select b.catalog_item_id,coalesce(sum(b.quantity),0)::numeric as local_balance
    from public.inventory_balances b
    group by b.catalog_item_id
  )
  select
    count(*)::bigint,
    count(*) filter (where c.external_source='MOYSKLAD' and c.external_id is not null)::bigint,
    count(*) filter (
      where not (c.external_source='MOYSKLAD' and c.external_id is not null)
        and c.item_type<>'SERVICE'
        and coalesce(b.local_balance,0)>0
    )::bigint,
    count(*) filter (
      where not (c.external_source='MOYSKLAD' and c.external_id is not null)
        and c.item_type<>'SERVICE'
        and coalesce(b.local_balance,0)<=coalesce(c.min_stock,0)
    )::bigint
  from public.catalog_items c
  left join balances b on b.catalog_item_id=c.id;
$$;

create or replace function public.get_warehouse_moysklad_stock_index()
returns table (
  id uuid,
  external_id text,
  min_stock numeric,
  item_type text
)
language sql
stable
security invoker
set search_path = ''
as $$
  select c.id,c.external_id,c.min_stock,c.item_type
  from public.catalog_items c
  where c.external_source='MOYSKLAD'
    and c.external_id is not null
    and c.item_type<>'SERVICE'
  order by c.id;
$$;

revoke execute on function public.get_warehouse_catalog_page(text,text,text,text,uuid[],integer,integer) from public,anon;
grant execute on function public.get_warehouse_catalog_page(text,text,text,text,uuid[],integer,integer) to authenticated,service_role;
revoke execute on function public.get_warehouse_catalog_metrics() from public,anon;
grant execute on function public.get_warehouse_catalog_metrics() to authenticated,service_role;
revoke execute on function public.get_warehouse_moysklad_stock_index() from public,anon;
grant execute on function public.get_warehouse_moysklad_stock_index() to authenticated,service_role;
