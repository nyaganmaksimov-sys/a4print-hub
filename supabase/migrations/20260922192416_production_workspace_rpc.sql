create index if not exists production_jobs_org_status_priority_idx
  on public.production_jobs (organization_id, status, priority desc, created_at desc);

create or replace function public.get_production_workspace_jobs(
  p_query text default '',
  p_unit text default '',
  p_assignee uuid default null,
  p_priority text default '',
  p_done_limit integer default 50,
  p_cancelled_limit integer default 20
)
returns table (
  id uuid, order_id uuid, order_item_id uuid, assigned_to uuid, equipment_id uuid,
  status text, title text, priority integer, operation_type text, quantity numeric,
  planned_machine_minutes numeric, actual_machine_minutes numeric, operation_amount numeric,
  primary_material_id uuid, production_cost numeric, planned_start timestamptz,
  planned_end timestamptz, deadline_at timestamptz, started_at timestamptz,
  completed_at timestamptz, notes text, created_at timestamptz, updated_at timestamptz,
  order_number bigint, order_status text, order_total numeric, order_business_unit text,
  order_model_name text, order_source text, order_due_at timestamptz,
  assignee_name text, assignee_email text
)
language sql stable security invoker set search_path = ''
as $$
  with scoped as (
    select j.id,j.order_id,j.order_item_id,j.assigned_to,j.equipment_id,j.status::text,
      j.title,j.priority,j.operation_type,j.quantity,j.planned_machine_minutes,j.actual_machine_minutes,
      j.operation_amount,j.primary_material_id,j.production_cost,j.planned_start,j.planned_end,j.deadline_at,
      j.started_at,j.completed_at,j.notes,j.created_at,j.updated_at,
      o.order_number,o.status::text,o.total,o.business_unit::text,o.model_name,o.source,o.due_at,
      u.full_name,u.email
    from public.production_jobs j
    left join public.orders o on o.id=j.order_id
    left join public.users u on u.id=j.assigned_to
    where (nullif(trim(p_query),'') is null
      or lower(concat_ws(' ',j.title,j.notes,j.operation_type,o.order_number::text,o.model_name,o.source,u.full_name,u.email))
        like '%'||lower(trim(p_query))||'%')
      and (nullif(trim(p_unit),'') is null or o.business_unit::text=upper(trim(p_unit)))
      and (p_assignee is null or j.assigned_to=p_assignee)
      and (nullif(trim(p_priority),'') is null
        or (lower(trim(p_priority))='high' and coalesce(j.priority,0)>=70)
        or (lower(trim(p_priority))='normal' and coalesce(j.priority,0)<70))
  ),
  active_rows as (select * from scoped where status in ('NEW','QUEUED','IN_PROGRESS','PAUSED')),
  done_rows as (
    select * from scoped where status='DONE'
    order by coalesce(completed_at,updated_at,created_at) desc
    limit greatest(0,least(coalesce(p_done_limit,50),200))
  ),
  cancelled_rows as (
    select * from scoped where status='CANCELLED'
    order by updated_at desc
    limit greatest(0,least(coalesce(p_cancelled_limit,20),100))
  )
  select * from active_rows
  union all select * from done_rows
  union all select * from cancelled_rows;
$$;

create or replace function public.get_production_workspace_metrics()
returns table (
  all_count bigint, queue_count bigint, work_count bigint,
  overdue_count bigint, done_count bigint, cancelled_count bigint
)
language sql stable security invoker set search_path = ''
as $$
  select count(*)::bigint,
    count(*) filter (where j.status::text in ('NEW','QUEUED'))::bigint,
    count(*) filter (where j.status::text in ('IN_PROGRESS','PAUSED'))::bigint,
    count(*) filter (
      where j.status::text not in ('DONE','CANCELLED')
        and coalesce(j.deadline_at,o.due_at) is not null
        and coalesce(j.deadline_at,o.due_at)<now()
    )::bigint,
    count(*) filter (where j.status::text='DONE')::bigint,
    count(*) filter (where j.status::text='CANCELLED')::bigint
  from public.production_jobs j left join public.orders o on o.id=j.order_id;
$$;

revoke execute on function public.get_production_workspace_jobs(text,text,uuid,text,integer,integer) from public,anon;
grant execute on function public.get_production_workspace_jobs(text,text,uuid,text,integer,integer) to authenticated,service_role;
revoke execute on function public.get_production_workspace_metrics() from public,anon;
grant execute on function public.get_production_workspace_metrics() to authenticated,service_role;
