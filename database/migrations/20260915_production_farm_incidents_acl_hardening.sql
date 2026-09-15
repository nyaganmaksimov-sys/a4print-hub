-- Phase 13 ACL hardening.
-- Incident rows remain immutable from the browser: all mutations go through
-- permission-checked RPCs. The overview is explicitly read-only.

revoke all on public.equipment_incidents from public,anon,authenticated;
grant select on public.equipment_incidents to authenticated;

revoke all on public.equipment_incident_overview from public,anon,authenticated;
grant select on public.equipment_incident_overview to authenticated;

revoke all on function public.sync_equipment_incident_status(uuid) from public,anon,authenticated;
revoke all on function public.equipment_incident_status_trigger() from public,anon,authenticated;
revoke all on function public.notify_equipment_incident(uuid) from public,anon,authenticated;

revoke all on function public.report_equipment_incident(uuid,uuid,text,text,text,uuid) from public,anon;
revoke all on function public.update_equipment_incident(uuid,text,uuid,text,text) from public,anon;
revoke all on function public.record_equipment_incident_repair(uuid,text,text,text,numeric,text,uuid,jsonb,text,boolean) from public,anon;
revoke all on function public.link_equipment_incident_document(uuid,uuid,text) from public,anon;

grant execute on function public.report_equipment_incident(uuid,uuid,text,text,text,uuid) to authenticated;
grant execute on function public.update_equipment_incident(uuid,text,uuid,text,text) to authenticated;
grant execute on function public.record_equipment_incident_repair(uuid,text,text,text,numeric,text,uuid,jsonb,text,boolean) to authenticated;
grant execute on function public.link_equipment_incident_document(uuid,uuid,text) to authenticated;
