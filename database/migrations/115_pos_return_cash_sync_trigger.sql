create or replace function public.sync_pos_return_cash_transaction()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_category uuid;
  v_customer uuid;
  v_sale_name text;
begin
  if new.cash_account_id is null then
    return new;
  end if;

  select ps.customer_id, coalesce(ps.moysklad_sale_name,ps.moysklad_sale_id,'—')
    into v_customer, v_sale_name
  from public.pos_sales ps
  where ps.id=new.pos_sale_id;

  select cc.id into v_category
  from public.cash_categories cc
  where cc.organization_id=new.organization_id
    and cc.direction='EXPENSE'
    and cc.name='Возврат клиенту'
  limit 1;

  if not exists (
    select 1 from public.cash_transactions ct
    where ct.organization_id=new.organization_id
      and ct.external_source='MOYSKLAD_POS_RETURN'
      and ct.external_id=new.moysklad_return_id
      and ct.direction='EXPENSE'
  ) then
    insert into public.cash_transactions (
      organization_id,cash_account_id,category_id,customer_id,direction,amount,payment_method,
      description,transaction_date,created_by,external_source,external_id
    ) values (
      new.organization_id,
      new.cash_account_id,
      v_category,
      v_customer,
      'EXPENSE',
      new.amount,
      new.payment_method,
      'Возврат по продаже ' || coalesce(v_sale_name,'—') ||
        case when nullif(new.reason,'') is not null then ' · ' || new.reason else '' end,
      (new.returned_at at time zone 'Europe/Moscow')::date,
      new.operator_id,
      'MOYSKLAD_POS_RETURN',
      new.moysklad_return_id
    );
  end if;

  return new;
end$$;

drop trigger if exists trg_sync_pos_return_cash_transaction on public.pos_returns;
create trigger trg_sync_pos_return_cash_transaction
after insert on public.pos_returns
for each row execute function public.sync_pos_return_cash_transaction();