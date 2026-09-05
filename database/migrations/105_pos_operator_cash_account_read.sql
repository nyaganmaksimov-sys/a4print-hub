-- POS operators need read-only access to active cash accounts shown at checkout.
drop policy if exists cash_accounts_pos_select on public.cash_accounts;
create policy cash_accounts_pos_select on public.cash_accounts for select to authenticated
using (public.has_role('POS_OPERATOR'));
