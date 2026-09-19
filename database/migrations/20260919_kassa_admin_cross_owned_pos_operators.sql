-- KASSA admin may choose any active POS operator across the owned A4 group.
-- Non-admin POS users remain self-only.
create or replace function public.get_pos_operators()
returns table(id uuid, full_name text, email text, is_active boolean, is_self boolean)
language plpgsql security definer set search_path=pg_catalog,public,auth as $$
declare v_user_id uuid; v_admin boolean;
begin
  select u.id into v_user_id from public.users u where u.auth_user_id=auth.uid() and u.is_active=true limit 1;
  if v_user_id is null then raise exception 'AUTH_REQUIRED'; end if;
  v_admin:=public.has_role('ADMIN');
  if not v_admin and not public.has_role('POS_OPERATOR') then raise exception 'POS_ACCESS_REQUIRED'; end if;
  if v_admin then
    return query select distinct u.id,u.full_name,coalesce(u.email,''),u.is_active,(u.id=v_user_id)
    from public.users u join public.user_roles ur on ur.user_id=u.id join public.roles r on r.id=ur.role_id and r.name='POS_OPERATOR'
    where u.is_active=true order by (u.id=v_user_id) desc,u.full_name;
  else
    return query select u.id,u.full_name,coalesce(u.email,''),u.is_active,true from public.users u where u.id=v_user_id and u.is_active=true;
  end if;
end $$;
revoke all on function public.get_pos_operators() from public,anon;
grant execute on function public.get_pos_operators() to authenticated;
