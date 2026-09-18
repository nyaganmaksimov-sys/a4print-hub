-- PHASE 2 CORE MULTI-COMPANY
-- Tenant isolation for organizations.
-- Authenticated staff may read/update only their own organization.
-- Creating or deleting organizations is reserved for privileged backend/service-role workflows.

drop policy if exists organizations_admin_manager_write on public.organizations;
drop policy if exists organizations_read on public.organizations;

create policy organizations_tenant_select on public.organizations
for select to authenticated
using (
  id=public.current_user_organization_id()
  and public.is_hub_staff()
);

create policy organizations_tenant_update on public.organizations
for update to authenticated
using (
  id=public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER'))
)
with check (
  id=public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER'))
);
