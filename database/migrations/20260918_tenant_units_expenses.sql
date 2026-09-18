-- PHASE 2 CORE MULTI-COMPANY
-- Tenant isolation for organization units and expenses.

create schema if not exists private;

create or replace function private.assign_expense_organization()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_org uuid;
begin
  select public.current_user_organization_id() into v_org;

  if v_org is not null then
    if new.organization_id is null then
      new.organization_id:=v_org;
    elsif new.organization_id<>v_org then
      raise exception 'EXPENSE_ORGANIZATION_MISMATCH';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.assign_expense_organization() from public,anon,authenticated;

drop trigger if exists trg_expenses_assign_organization on public.expenses;
create trigger trg_expenses_assign_organization
before insert or update of organization_id
on public.expenses
for each row
execute function private.assign_expense_organization();

-- ORGANIZATION UNITS
drop policy if exists organization_units_admin_manager_write on public.organization_units;
drop policy if exists organization_units_read on public.organization_units;

create policy organization_units_tenant_select on public.organization_units
for select to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.is_hub_staff()
);

create policy organization_units_tenant_insert on public.organization_units
for insert to authenticated
with check (
  organization_id=public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER'))
);

create policy organization_units_tenant_update on public.organization_units
for update to authenticated
using (
  organization_id=public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER'))
)
with check (
  organization_id=public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER'))
);

create policy organization_units_tenant_delete on public.organization_units
for delete to authenticated
using (
  organization_id=public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER'))
);

-- EXPENSES
drop policy if exists expenses_head_delete on public.expenses;
drop policy if exists expenses_head_read on public.expenses;
drop policy if exists expenses_head_update on public.expenses;
drop policy if exists expenses_staff_insert on public.expenses;

create policy expenses_tenant_head_select on public.expenses
for select to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.is_hub_leader()
);

create policy expenses_tenant_staff_insert on public.expenses
for insert to authenticated
with check (
  organization_id=public.current_user_organization_id()
  and created_by=(
    select u.id from public.users u
    where u.auth_user_id=auth.uid() and u.is_active=true
    limit 1
  )
);

create policy expenses_tenant_head_update on public.expenses
for update to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.is_hub_leader()
)
with check (
  organization_id=public.current_user_organization_id()
  and public.is_hub_leader()
);

create policy expenses_tenant_head_delete on public.expenses
for delete to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.is_hub_leader()
);
