-- A4PRINT HUB: POS operators
-- Run after 004_a4print_cashbox.sql and base auth schema.

insert into public.roles (name, description)
values ('POS_OPERATOR', 'Оператор кассы A4-Принт')
on conflict (name) do update set description = excluded.description;

-- Cash reference data: operators may read active accounts/categories.
drop policy if exists cash_accounts_operator_read on public.cash_accounts;
create policy cash_accounts_operator_read
on public.cash_accounts
for select
to authenticated
using (public.has_role('POS_OPERATOR'));

drop policy if exists cash_categories_operator_read on public.cash_categories;
create policy cash_categories_operator_read
on public.cash_categories
for select
to authenticated
using (public.has_role('POS_OPERATOR'));

-- Operators can record a sale, but cannot edit/delete cash history.
drop policy if exists cash_transactions_operator_read on public.cash_transactions;
create policy cash_transactions_operator_read
on public.cash_transactions
for select
to authenticated
using (public.has_role('POS_OPERATOR'));

drop policy if exists cash_transactions_operator_insert on public.cash_transactions;
create policy cash_transactions_operator_insert
on public.cash_transactions
for insert
to authenticated
with check (
  public.has_role('POS_OPERATOR')
  and direction = 'INCOME'
  and created_by = (
    select u.id from public.users u where u.auth_user_id = auth.uid()
  )
);
