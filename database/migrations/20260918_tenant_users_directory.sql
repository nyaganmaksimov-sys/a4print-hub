-- PHASE 2 CORE MULTI-COMPANY
-- Scope the general staff user directory to the current organization.
-- Keep users_support_ticket_read unchanged for explicit support access.

drop policy if exists users_read_active_staff on public.users;

create policy users_tenant_staff_read on public.users
for select to authenticated
using (
  public.is_hub_staff()
  and (
    auth_user_id=auth.uid()
    or exists (
      select 1
      from public.organization_units ou
      where ou.id=users.organization_unit_id
        and ou.organization_id=public.current_user_organization_id()
    )
  )
);
