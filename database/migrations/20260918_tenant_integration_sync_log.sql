-- PHASE 2 CORE MULTI-COMPANY
-- Tenant isolation for integration sync log.

drop policy if exists integration_sync_log_admin_all on public.integration_sync_log;

create policy integration_sync_log_tenant_admin_all on public.integration_sync_log
for all to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
)
with check (
  organization_id=public.current_user_organization_id()
  and public.has_role('ADMIN')
);
