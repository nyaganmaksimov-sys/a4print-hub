-- A4PRINT HUB: reimbursement workflow for employee expenses.
-- Expense payment status and reimbursement to the employee are tracked separately.

alter table public.expenses
  add column if not exists reimbursed_at timestamptz,
  add column if not exists reimbursed_by uuid references public.users(id) on delete set null;

create index if not exists expenses_reimbursed_at_idx on public.expenses(reimbursed_at);

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
  reimbursed_at timestamptz,
  reimbursed_by uuid,
  reimbursed_by_name text,
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
    e.reimbursed_at,
    e.reimbursed_by,
    coalesce(payer.full_name, case when e.reimbursed_at is not null then 'Руководитель' else null end),
    (me.is_leader or e.created_by = me.user_id),
    (e.created_by = me.user_id)
  from public.expenses e
  cross join me
  left join public.users author on author.id = e.created_by
  left join public.users payer on payer.id = e.reimbursed_by
  where (p_from is null or e.expense_date >= p_from)
    and (p_to is null or e.expense_date < p_to)
  order by e.expense_date desc, e.created_at desc;
$$;

revoke all on function public.list_expenses_masked(date,date) from public;
grant execute on function public.list_expenses_masked(date,date) to authenticated;

create or replace function public.reimburse_expense(p_expense_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_reimbursed_at timestamptz;
  v_actor uuid;
begin
  if not public.is_hub_leader() then
    raise exception 'Выплата расхода доступна только руководителю';
  end if;

  v_actor := public.current_hub_profile_id();
  if v_actor is null then
    raise exception 'Профиль руководителя не найден';
  end if;

  select e.status, e.reimbursed_at
    into v_status, v_reimbursed_at
  from public.expenses e
  where e.id = p_expense_id
  for update;

  if not found then
    raise exception 'Расход не найден';
  end if;

  if upper(coalesce(v_status,'')) <> 'PAID' then
    raise exception 'Выплатить можно только фактически оплаченный расход';
  end if;

  if v_reimbursed_at is not null then
    return true;
  end if;

  update public.expenses
  set reimbursed_at = now(),
      reimbursed_by = v_actor,
      updated_at = now()
  where id = p_expense_id;

  return true;
end;
$$;

revoke all on function public.reimburse_expense(uuid) from public;
grant execute on function public.reimburse_expense(uuid) to authenticated;
