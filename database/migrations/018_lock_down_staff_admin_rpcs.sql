revoke all on function public.admin_create_department(uuid,text,text) from public, anon;
revoke all on function public.admin_update_department(uuid,text,text,boolean) from public, anon;
revoke all on function public.admin_create_position(uuid,text,text) from public, anon;
revoke all on function public.admin_update_position(uuid,text,text,boolean) from public, anon;
revoke all on function public.admin_set_staff_assignment_v2(uuid,uuid,uuid) from public, anon;
revoke all on function public.approve_staff_registration_v3(uuid,uuid[],uuid,uuid) from public, anon;

grant execute on function public.admin_create_department(uuid,text,text) to authenticated;
grant execute on function public.admin_update_department(uuid,text,text,boolean) to authenticated;
grant execute on function public.admin_create_position(uuid,text,text) to authenticated;
grant execute on function public.admin_update_position(uuid,text,text,boolean) to authenticated;
grant execute on function public.admin_set_staff_assignment_v2(uuid,uuid,uuid) to authenticated;
grant execute on function public.approve_staff_registration_v3(uuid,uuid[],uuid,uuid) to authenticated;

revoke all on function public.admin_set_staff_assignment(uuid,uuid,text) from public, anon;
revoke all on function public.approve_staff_registration_v2(uuid,uuid[],uuid,text) from public, anon;
grant execute on function public.admin_set_staff_assignment(uuid,uuid,text) to authenticated;
grant execute on function public.approve_staff_registration_v2(uuid,uuid[],uuid,text) to authenticated;
