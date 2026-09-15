-- Phase 28 hardening: a historical posting must remain reversible even if its original cash account was later deactivated.
-- The reversal always uses the exact original account; operators cannot choose another one.

create or replace function public.reverse_equipment_condition_claim_financial_transaction(
  p_claim_id uuid,
  p_reason text,
  p_reference text,
  p_transaction_date date default current_date
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_claim public.equipment_condition_claims%rowtype;
  v_original public.cash_transactions%rowtype;
  v_account public.cash_accounts%rowtype;
  v_direction text;
  v_category_name text;
  v_category_id uuid;
  v_actor uuid;
  v_reversal_id uuid;
  v_description text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.contracts.manage')
     or not public.has_permission('production.settlements.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_claim_id is null then raise exception 'CLAIM_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null or length(btrim(p_reason))<3 then raise exception 'REVERSAL_REASON_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_reference,'')),'') is null or length(btrim(p_reference))<2 then raise exception 'REVERSAL_REFERENCE_REQUIRED'; end if;
  if p_transaction_date is null then raise exception 'TRANSACTION_DATE_REQUIRED'; end if;

  select * into v_claim from public.equipment_condition_claims where id=p_claim_id for update;
  if v_claim.id is null then raise exception 'CLAIM_NOT_FOUND'; end if;
  if v_claim.status<>'SETTLED' then raise exception 'CLAIM_MUST_BE_SETTLED'; end if;

  select * into v_original from public.cash_transactions t
  where t.external_source='EQUIPMENT_CONDITION_CLAIM' and t.external_id=v_claim.id::text
  order by t.created_at desc limit 1 for update;
  if v_original.id is null then raise exception 'CLAIM_FINANCIAL_POSTING_NOT_FOUND'; end if;

  if exists(select 1 from public.equipment_condition_claim_financial_reversals r where r.claim_id=v_claim.id or r.original_transaction_id=v_original.id)
     or exists(select 1 from public.cash_transactions t where t.external_source='EQUIPMENT_CONDITION_CLAIM_REVERSAL' and t.external_id=v_original.id::text) then
    raise exception 'CLAIM_FINANCIAL_REVERSAL_EXISTS';
  end if;

  select * into v_account from public.cash_accounts where id=v_original.cash_account_id;
  if v_account.id is null then raise exception 'REVERSAL_CASH_ACCOUNT_NOT_FOUND'; end if;
  if v_account.organization_id<>v_original.organization_id then raise exception 'REVERSAL_CASH_ACCOUNT_ORGANIZATION_MISMATCH'; end if;

  v_direction:=case v_original.direction when 'INCOME' then 'EXPENSE' else 'INCOME' end;
  v_category_name:=case v_original.direction when 'INCOME' then 'Сторно компенсации по состоянию оборудования' else 'Сторно выплаты владельцу оборудования' end;
  select c.id into v_category_id from public.cash_categories c
  where c.organization_id=v_original.organization_id and c.direction=v_direction and lower(c.name)=lower(v_category_name) and c.is_active=true
  order by c.created_at limit 1;
  if v_category_id is null then
    insert into public.cash_categories(organization_id,direction,name,is_active)
    values(v_original.organization_id,v_direction,v_category_name,true) returning id into v_category_id;
  end if;

  v_actor:=public.current_staff_user_id();
  if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;
  v_description:=concat('СТОРНО финансовой операции по требованию ',coalesce(v_claim.settlement_reference,v_claim.id::text),' · исходная операция ',v_original.id::text,' · основание ',btrim(p_reference),' · причина ',btrim(p_reason));

  insert into public.cash_transactions(organization_id,cash_account_id,category_id,direction,amount,payment_method,description,transaction_date,created_by,external_source,external_id,created_at,updated_at)
  values(v_original.organization_id,v_original.cash_account_id,v_category_id,v_direction,v_original.amount,v_original.payment_method,v_description,p_transaction_date,v_actor,'EQUIPMENT_CONDITION_CLAIM_REVERSAL',v_original.id::text,clock_timestamp(),clock_timestamp())
  returning id into v_reversal_id;

  insert into public.equipment_condition_claim_financial_reversals(claim_id,original_transaction_id,reversal_transaction_id,reason,reference,reversed_by,reversed_at,created_at)
  values(v_claim.id,v_original.id,v_reversal_id,btrim(p_reason),btrim(p_reference),v_actor,clock_timestamp(),clock_timestamp());

  if v_claim.document_id is not null then
    insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at)
    values(v_claim.document_id,'CASH_TRANSACTION',v_reversal_id,'FINANCIAL_REVERSAL',clock_timestamp()) on conflict do nothing;
  end if;
  return v_reversal_id;
exception when unique_violation then raise exception 'CLAIM_FINANCIAL_REVERSAL_EXISTS';
end
$$;
revoke all on function public.reverse_equipment_condition_claim_financial_transaction(uuid,text,text,date) from public,anon,authenticated;
grant execute on function public.reverse_equipment_condition_claim_financial_transaction(uuid,text,text,date) to authenticated;
