-- Phase 19 hardening: make browser denial explicit so RLS is auditable.

drop policy if exists equipment_insurance_notice_events_browser_deny on public.equipment_insurance_notice_events;
create policy equipment_insurance_notice_events_browser_deny
on public.equipment_insurance_notice_events
for select to authenticated
using(false);

revoke insert,update,delete on public.equipment_insurance_notice_events from authenticated;
