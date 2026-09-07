-- A4PRINT KASSA: secure server history for synced POS receipts.
create or replace function public.get_pos_receipt_history(p_limit integer default 100, p_search text default null)
returns jsonb
language plpgsql
security definer
set search_path=public,auth
as $$
declare
  v_org uuid;
  v_self uuid;
  v_admin boolean;
  v_limit integer;
  v_search text;
  v_result jsonb;
begin
  select id into v_org from public.organizations where code='A4PRINT' limit 1;
  select id into v_self from public.users where auth_user_id=auth.uid() and is_active=true limit 1;
  if v_org is null or v_self is null then raise exception 'POS_CONTEXT_NOT_FOUND'; end if;
  v_admin:=public.has_role('ADMIN');
  if not v_admin and not public.has_role('POS_OPERATOR') then raise exception 'POS_ACCESS_REQUIRED'; end if;
  v_limit:=least(greatest(coalesce(p_limit,100),1),300);
  v_search:=nullif(lower(trim(coalesce(p_search,''))), '');

  with rows as (
    select ps.id,ps.moysklad_sale_id,ps.moysklad_sale_name,ps.moysklad_shift_id,ps.payment_method,ps.total,ps.item_count,ps.items,ps.sold_at,ps.sync_status,
      ps.operator_id,coalesce(u.full_name,'Неизвестно') operator_name,ps.customer_id,c.full_name customer_name,ca.name cash_account_name,
      sh.moysklad_shift_name shift_name,
      coalesce((select sum(pr.amount) from public.pos_returns pr where pr.pos_sale_id=ps.id),0) returned_total,
      coalesce((select count(*) from public.pos_returns pr where pr.pos_sale_id=ps.id),0) returned_count
    from public.pos_sales ps
    left join public.users u on u.id=ps.operator_id
    left join public.customers c on c.id=ps.customer_id
    left join public.cash_accounts ca on ca.id=ps.cash_account_id
    left join public.pos_shift_sessions sh on sh.id=ps.shift_session_id
    where ps.organization_id=v_org and (v_admin or ps.operator_id=v_self)
      and (v_search is null
        or lower(coalesce(ps.moysklad_sale_name,'')) like '%'||v_search||'%'
        or lower(coalesce(u.full_name,'')) like '%'||v_search||'%'
        or lower(coalesce(c.full_name,'')) like '%'||v_search||'%'
        or lower(coalesce(ps.payment_method,'')) like '%'||v_search||'%'
        or lower(coalesce(ps.total::text,'')) like '%'||v_search||'%'
        or exists (select 1 from jsonb_array_elements(coalesce(ps.items,'[]'::jsonb)) i where lower(coalesce(i->>'name','')) like '%'||v_search||'%' or lower(coalesce(i->>'article','')) like '%'||v_search||'%'))
    order by ps.sold_at desc
    limit v_limit
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'moysklad_sale_id',r.moysklad_sale_id,'sale_name',r.moysklad_sale_name,'shift_id',r.moysklad_shift_id,'shift_name',coalesce(r.shift_name,r.moysklad_shift_id),
    'sold_at',r.sold_at,'payment_method',r.payment_method,'total',r.total,'item_count',r.item_count,'items',r.items,'sync_status',r.sync_status,
    'operator_id',r.operator_id,'operator',r.operator_name,'customer_id',r.customer_id,'customer',r.customer_name,'cash_account',r.cash_account_name,
    'returned_total',r.returned_total,'returned_count',r.returned_count) order by r.sold_at desc),'[]'::jsonb) into v_result from rows r;
  return v_result;
end$$;
revoke all on function public.get_pos_receipt_history(integer,text) from public;
grant execute on function public.get_pos_receipt_history(integer,text) to authenticated;
