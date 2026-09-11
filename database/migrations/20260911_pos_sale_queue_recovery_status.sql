create or replace function public.get_pos_sale_sync_state(p_moysklad_sale_id text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'auth'
as $function$
declare
  v_org uuid;
  v_user uuid;
  v_sale public.pos_sales%rowtype;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  select id into v_org
  from public.organizations
  where code='A4PRINT'
  limit 1;

  select id into v_user
  from public.users
  where auth_user_id=auth.uid() and is_active=true
  limit 1;

  if v_org is null or v_user is null then raise exception 'POS_CONTEXT_NOT_FOUND'; end if;
  if not public.has_role('ADMIN') and not public.has_role('POS_OPERATOR') then raise exception 'POS_ACCESS_REQUIRED'; end if;

  select * into v_sale
  from public.pos_sales
  where organization_id=v_org and moysklad_sale_id=p_moysklad_sale_id
  order by updated_at desc nulls last, created_at desc
  limit 1;

  if v_sale.id is null then
    return jsonb_build_object('found',false,'synced',false);
  end if;

  return jsonb_build_object(
    'found',true,
    'synced',coalesce(v_sale.sync_status,'')='SYNCED',
    'sale_id',v_sale.id,
    'moysklad_sale_id',v_sale.moysklad_sale_id,
    'moysklad_sale_name',v_sale.moysklad_sale_name,
    'sync_status',v_sale.sync_status,
    'cash_account_id',v_sale.cash_account_id,
    'updated_at',v_sale.updated_at
  );
end
$function$;

revoke all on function public.get_pos_sale_sync_state(text) from public;
grant execute on function public.get_pos_sale_sync_state(text) to authenticated;
