-- Phase 15 hardening: security_invoker views require caller SELECT privileges
-- and underlying RLS policies on every joined table.

drop policy if exists document_types_hub_staff_read on public.document_types;
create policy document_types_hub_staff_read on public.document_types
for select to authenticated
using(public.is_hub_staff());

grant select on public.documents to authenticated;
grant select on public.document_types to authenticated;
