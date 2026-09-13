-- A4PRINT HUB: harden production farm foundation helpers.
-- Trigger-only SECURITY DEFINER functions must not be exposed as PostgREST RPCs.

revoke all on function public.current_staff_user_id() from public,anon,authenticated;
revoke all on function public.audit_row_change() from public,anon,authenticated;
revoke all on function public.ensure_equipment_owner_partner_role() from public,anon,authenticated;
revoke all on function public.sync_equipment_ownership_history() from public,anon,authenticated;

-- These two helpers are intentional signed-in RPCs used by HUB UI/RLS.
revoke all on function public.has_permission(text) from public,anon;
revoke all on function public.get_my_permissions() from public,anon;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.get_my_permissions() to authenticated;
