-- Keep HUB orders and the production board in sync.
-- Orders are the business source of truth; production_jobs is the execution board.
-- A single automatic root job is created per order while manual child/extra jobs
-- remain unrestricted.

alter table public.production_jobs
  add column if not exists auto_created boolean not null default false;

create index if not exists production_jobs_order_id_idx
  on public.production_jobs(order_id)
  where order_id is not null;

create unique index if not exists production_jobs_one_auto_per_order_idx
  on public.production_jobs(order_id)
  where order_id is not null and auto_created = true;

-- Existing production -> order sync is kept, but made idempotent. Without this
-- guard, a DONE job writing READY to an already READY order can bounce back into
-- the reverse order -> production trigger forever.
create or replace function public.on_production_job_status_sync_order()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order_status text;
  v_remaining integer;
begin
  if new.order_id is null then
    return new;
  end if;

  if tg_op = 'UPDATE' and new.status is not distinct from old.status then
    return new;
  end if;

  select status::text
    into v_order_status
    from public.orders
   where id = new.order_id;

  if v_order_status is null or v_order_status in ('COMPLETED','CANCELLED') then
    return new;
  end if;

  if new.status::text = 'IN_PROGRESS' and v_order_status in ('NEW','CONFIRMED') then
    update public.orders
       set status = 'IN_PROGRESS',
           updated_at = now()
     where id = new.order_id
       and status::text in ('NEW','CONFIRMED');
  elsif new.status::text = 'DONE' then
    select count(*)
      into v_remaining
      from public.production_jobs
     where order_id = new.order_id
       and status::text not in ('DONE','CANCELLED');

    if v_remaining = 0 and v_order_status <> 'READY' then
      update public.orders
         set status = 'READY',
             updated_at = now()
       where id = new.order_id
         and status::text not in ('READY','COMPLETED','CANCELLED');
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.sync_order_to_production_job()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.production_status;
  v_auto_id uuid;
  v_first_item text;
  v_item_count integer := 0;
  v_title text;
  v_now timestamptz := now();
begin
  -- Ignore status rewrites that do not actually change any production-relevant
  -- order field. This is the second half of the recursion guard.
  if tg_op = 'UPDATE'
     and new.status is not distinct from old.status
     and new.due_at is not distinct from old.due_at
     and new.source is not distinct from old.source
     and new.model_name is not distinct from old.model_name
     and new.order_number is not distinct from old.order_number then
    return new;
  end if;

  -- POS receipts and orders sent to external partners are not internal production.
  if upper(coalesce(new.source, '')) in ('KASSA', 'PARTNER_OUTBOUND') then
    return new;
  end if;

  select p.id
    into v_auto_id
    from public.production_jobs p
   where p.order_id = new.id
     and p.auto_created = true
   order by p.created_at
   limit 1;

  -- Closed orders only close an already existing automatic job. They must not
  -- create historical production rows after the fact.
  if new.status::text in ('COMPLETED', 'CANCELLED') then
    if v_auto_id is not null then
      v_status := case
                    when new.status::text = 'COMPLETED' then 'DONE'::public.production_status
                    else 'CANCELLED'::public.production_status
                  end;
      update public.production_jobs
         set status = v_status,
             completed_at = case
                              when v_status = 'DONE'::public.production_status then coalesce(completed_at, new.updated_at, v_now)
                              else null
                            end,
             planned_end = coalesce(new.due_at, planned_end),
             updated_at = v_now
       where id = v_auto_id
         and (
           status is distinct from v_status
           or (new.due_at is not null and planned_end is distinct from new.due_at)
           or (v_status = 'DONE'::public.production_status and completed_at is null)
         );
    end if;
    return new;
  end if;

  v_status := case new.status::text
    when 'CONFIRMED' then 'QUEUED'::public.production_status
    when 'IN_PROGRESS' then 'IN_PROGRESS'::public.production_status
    when 'READY' then 'DONE'::public.production_status
    when 'ON_HOLD' then 'PAUSED'::public.production_status
    else null
  end;

  if v_status is null then
    return new;
  end if;

  select oi.name
    into v_first_item
    from public.order_items oi
   where oi.order_id = new.id
   order by oi.total_price desc nulls last, oi.name, oi.id
   limit 1;

  select count(*)::integer
    into v_item_count
    from public.order_items oi
   where oi.order_id = new.id;

  v_title := 'Заказ №' || new.order_number::text || ' · ' ||
    coalesce(nullif(trim(v_first_item), ''), nullif(trim(new.model_name), ''), nullif(trim(new.source), ''), 'Производство');

  if v_item_count > 1 then
    v_title := v_title || ' + ещё ' || (v_item_count - 1)::text;
  end if;

  if v_auto_id is not null then
    update public.production_jobs
       set status = v_status,
           title = v_title,
           planned_end = new.due_at,
           started_at = case
                          when v_status = 'IN_PROGRESS'::public.production_status then coalesce(started_at, new.updated_at, v_now)
                          else started_at
                        end,
           completed_at = case
                            when v_status = 'DONE'::public.production_status then coalesce(completed_at, new.updated_at, v_now)
                            else null
                          end,
           updated_at = v_now
     where id = v_auto_id
       and (
         status is distinct from v_status
         or title is distinct from v_title
         or planned_end is distinct from new.due_at
         or (v_status = 'IN_PROGRESS'::public.production_status and started_at is null)
         or (v_status = 'DONE'::public.production_status and completed_at is null)
         or (v_status <> 'DONE'::public.production_status and completed_at is not null)
       );
    return new;
  end if;

  -- If somebody already created a manual production plan for this order, do not
  -- add a duplicate automatic root task.
  if exists (
    select 1
      from public.production_jobs p
     where p.order_id = new.id
       and p.status <> 'CANCELLED'::public.production_status
  ) then
    return new;
  end if;

  insert into public.production_jobs (
    order_id,
    status,
    title,
    priority,
    planned_end,
    started_at,
    completed_at,
    notes,
    auto_created,
    created_at,
    updated_at
  ) values (
    new.id,
    v_status,
    v_title,
    50,
    new.due_at,
    case when v_status = 'IN_PROGRESS'::public.production_status then coalesce(new.updated_at, v_now) else null end,
    case when v_status = 'DONE'::public.production_status then coalesce(new.updated_at, v_now) else null end,
    'Автоматически создано из заказа A4PRINT HUB',
    true,
    v_now,
    v_now
  );

  return new;
end;
$$;

revoke all on function public.sync_order_to_production_job() from public;

drop trigger if exists trg_orders_sync_production_job on public.orders;
create trigger trg_orders_sync_production_job
after insert or update of status, due_at, source, model_name, order_number
on public.orders
for each row
execute function public.sync_order_to_production_job();

-- Backfill the currently active/ready internal orders. This is intentionally
-- limited to orders that should already be visible on the production board.
insert into public.production_jobs (
  order_id,
  status,
  title,
  priority,
  planned_end,
  started_at,
  completed_at,
  notes,
  auto_created,
  created_at,
  updated_at
)
select
  o.id,
  case o.status::text
    when 'CONFIRMED' then 'QUEUED'::public.production_status
    when 'IN_PROGRESS' then 'IN_PROGRESS'::public.production_status
    when 'READY' then 'DONE'::public.production_status
    when 'ON_HOLD' then 'PAUSED'::public.production_status
  end,
  'Заказ №' || o.order_number::text || ' · ' ||
    coalesce(nullif(trim(item.name), ''), nullif(trim(o.model_name), ''), nullif(trim(o.source), ''), 'Производство') ||
    case when item.item_count > 1 then ' + ещё ' || (item.item_count - 1)::text else '' end,
  50,
  o.due_at,
  case when o.status::text = 'IN_PROGRESS' then coalesce(o.updated_at, o.created_at, now()) else null end,
  case when o.status::text = 'READY' then coalesce(o.updated_at, o.created_at, now()) else null end,
  'Автоматически создано из заказа A4PRINT HUB',
  true,
  now(),
  now()
from public.orders o
left join lateral (
  select
    (array_agg(oi.name order by oi.total_price desc nulls last, oi.name, oi.id))[1] as name,
    count(*)::integer as item_count
  from public.order_items oi
  where oi.order_id = o.id
) item on true
where o.status::text in ('CONFIRMED', 'IN_PROGRESS', 'READY', 'ON_HOLD')
  and upper(coalesce(o.source, '')) not in ('KASSA', 'PARTNER_OUTBOUND')
  and not exists (
    select 1 from public.production_jobs p where p.order_id = o.id
  )
on conflict do nothing;
