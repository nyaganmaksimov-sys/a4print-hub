-- A4PRINT HUB: private receipt attachments for company expenses.
-- Employees may upload receipts to their own folder; leaders may upload/read all.

alter table public.expenses
  add column if not exists receipt_path text,
  add column if not exists receipt_name text,
  add column if not exists receipt_mime text,
  add column if not exists receipt_size bigint;

create or replace function public.current_hub_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select u.id
  from public.users u
  where u.auth_user_id = auth.uid()
    and u.is_active = true
  limit 1;
$$;

revoke all on function public.current_hub_profile_id() from public;
grant execute on function public.current_hub_profile_id() to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'expense-receipts',
  'expense-receipts',
  false,
  15728640,
  array['image/jpeg','image/png','image/webp','image/heic','image/heif','image/tiff','application/pdf']::text[]
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists expense_receipts_insert_own on storage.objects;
create policy expense_receipts_insert_own
on storage.objects for insert to authenticated
with check (
  bucket_id = 'expense-receipts'
  and (
    (storage.foldername(name))[1] = public.current_hub_profile_id()::text
    or public.is_hub_leader()
  )
);

drop policy if exists expense_receipts_select_allowed on storage.objects;
create policy expense_receipts_select_allowed
on storage.objects for select to authenticated
using (
  bucket_id = 'expense-receipts'
  and (
    (storage.foldername(name))[1] = public.current_hub_profile_id()::text
    or public.is_hub_leader()
  )
);

drop policy if exists expense_receipts_delete_allowed on storage.objects;
create policy expense_receipts_delete_allowed
on storage.objects for delete to authenticated
using (
  bucket_id = 'expense-receipts'
  and (
    (storage.foldername(name))[1] = public.current_hub_profile_id()::text
    or public.is_hub_leader()
  )
);

drop function if exists public.list_expenses_masked(date,date);
create function public.list_expenses_masked(p_from date default null, p_to date default null)
returns table(
  id uuid,
  expense_number bigint,
  expense_date date,
  category text,
  title text,
  amount numeric,
  payment_method text,
  counterparty text,
  status text,
  note text,
  document_url text,
  receipt_path text,
  receipt_name text,
  receipt_mime text,
  receipt_size bigint,
  has_receipt boolean,
  created_by uuid,
  created_by_name text,
  created_at timestamptz,
  can_view_amount boolean,
  is_own boolean
)
language sql
stable
security definer
set search_path = public
as $$
  with me as (
    select u.id as user_id, public.is_hub_leader() as is_leader
    from public.users u
    where u.auth_user_id = auth.uid() and u.is_active = true
    limit 1
  )
  select
    e.id,
    e.expense_number,
    e.expense_date,
    e.category,
    e.title,
    case when me.is_leader or e.created_by = me.user_id then e.amount else null end,
    e.payment_method,
    e.counterparty,
    e.status,
    e.note,
    case when me.is_leader or e.created_by = me.user_id then e.document_url else null end,
    case when me.is_leader or e.created_by = me.user_id then e.receipt_path else null end,
    case when me.is_leader or e.created_by = me.user_id then e.receipt_name else null end,
    case when me.is_leader or e.created_by = me.user_id then e.receipt_mime else null end,
    case when me.is_leader or e.created_by = me.user_id then e.receipt_size else null end,
    (e.receipt_path is not null or e.document_url is not null),
    e.created_by,
    coalesce(author.full_name,'Сотрудник'),
    e.created_at,
    (me.is_leader or e.created_by = me.user_id),
    (e.created_by = me.user_id)
  from public.expenses e
  cross join me
  left join public.users author on author.id = e.created_by
  where (p_from is null or e.expense_date >= p_from)
    and (p_to is null or e.expense_date < p_to)
  order by e.expense_date desc, e.created_at desc;
$$;

revoke all on function public.list_expenses_masked(date,date) from public;
grant execute on function public.list_expenses_masked(date,date) to authenticated;
