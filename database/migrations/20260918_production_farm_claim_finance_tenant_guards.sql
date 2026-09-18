-- A4PRINT HUB: Production Farm Phase 33 — tenant guards for condition-claim financial lifecycle.

create or replace function public.equipment_condition_claim_financial_tenant_org(p_claim_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_contract_org uuid;
  v_asset_org uuid;
  v_user_org uuid;
begin
  if p_claim_id is null then raise exception 'CLAIM_REQUIRED'; end if;

  select ec.organization_id,ea.organization_id
    into v_contract_org,v_asset_org
  from public.equipment_condition_claims c
  join public.equipment_contracts ec on ec.id=c.contract_id
  join public.equipment_assets ea on ea.id=c.equipment_id
  where c.id=p_claim_id;

  if not found then raise exception 'CLAIM_NOT_FOUND'; end if;
  if v_contract_org is null or v_asset_org is null then
    raise exception 'CLAIM_FINANCIAL_ORGANIZATION_REQUIRED';
  end if;
  if v_contract_org is distinct from v_asset_org then
    raise exception 'CLAIM_FINANCIAL_TENANT_MISMATCH';
  end if;

  v_user_org:=public.current_user_organization_id();
  if v_user_org is null then raise exception 'ORGANIZATION_CONTEXT_REQUIRED'; end if;
  if v_contract_org is distinct from v_user_org then
    raise exception 'CLAIM_NOT_AVAILABLE';
  end if;

  return v_contract_org;
end
$$;

revoke all on function public.equipment_condition_claim_financial_tenant_org(uuid)
  from public,anon,authenticated;

drop policy if exists equipment_condition_claim_financial_reversals_staff_read
  on public.equipment_condition_claim_financial_reversals;
create policy equipment_condition_claim_financial_reversals_staff_read
on public.equipment_condition_claim_financial_reversals
for select to authenticated
using(
  (
    public.has_permission('equipment.view')
    or public.has_permission('equipment.contracts.manage')
    or public.has_permission('production.settlements.view')
    or public.has_permission('production.settlements.manage')
  )
  and exists(
    select 1
    from public.equipment_condition_claims c
    join public.equipment_contracts ec on ec.id=c.contract_id
    join public.equipment_assets ea on ea.id=c.equipment_id
    where c.id=equipment_condition_claim_financial_reversals.claim_id
      and ec.organization_id=public.current_user_organization_id()
      and ea.organization_id=public.current_user_organization_id()
  )
);

drop policy if exists equipment_condition_claim_financial_reposts_staff_read
  on public.equipment_condition_claim_financial_reposts;
create policy equipment_condition_claim_financial_reposts_staff_read
on public.equipment_condition_claim_financial_reposts
for select to authenticated
using(
  (
    public.has_permission('equipment.view')
    or public.has_permission('equipment.contracts.manage')
    or public.has_permission('production.settlements.view')
    or public.has_permission('production.settlements.manage')
  )
  and exists(
    select 1
    from public.equipment_condition_claims c
    join public.equipment_contracts ec on ec.id=c.contract_id
    join public.equipment_assets ea on ea.id=c.equipment_id
    where c.id=equipment_condition_claim_financial_reposts.claim_id
      and ec.organization_id=public.current_user_organization_id()
      and ea.organization_id=public.current_user_organization_id()
  )
);

create or replace function public.get_equipment_condition_claim_financial_options(p_claim_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path=''
as $$
declare
  v_claim public.equipment_condition_claims%rowtype;
  v_org_id uuid;
  v_org_name text;
  v_expected_direction text;
  v_existing jsonb;
  v_accounts jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.contracts.manage')
     or not public.has_permission('production.settlements.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;

  v_org_id:=public.equipment_condition_claim_financial_tenant_org(p_claim_id);

  select * into v_claim
  from public.equipment_condition_claims
  where id=p_claim_id;
  if v_claim.id is null then raise exception 'CLAIM_NOT_FOUND'; end if;

  select o.name into v_org_name
  from public.organizations o
  where o.id=v_org_id and o.is_active=true;
  if v_org_name is null then raise exception 'CLAIM_FINANCIAL_ORGANIZATION_INACTIVE'; end if;

  v_expected_direction:=case v_claim.claim_direction
    when 'HUB_TO_OWNER' then 'INCOME'
    when 'OWNER_TO_HUB' then 'EXPENSE'
    else null
  end;

  select jsonb_build_object(
      'transaction_id',t.id,
      'direction',t.direction,
      'amount',t.amount,
      'transaction_date',t.transaction_date,
      'cash_account_id',t.cash_account_id,
      'cash_account_name',a.name,
      'account_type',a.account_type,
      'created_at',t.created_at
    ) into v_existing
  from public.cash_transactions t
  join public.cash_accounts a on a.id=t.cash_account_id
  where t.external_source='EQUIPMENT_CONDITION_CLAIM'
    and t.external_id=v_claim.id::text
    and t.organization_id=v_org_id
  order by t.created_at desc
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,
      'name',a.name,
      'account_type',a.account_type,
      'currency',a.currency
    ) order by a.name),'[]'::jsonb)
    into v_accounts
  from public.cash_accounts a
  where a.organization_id=v_org_id
    and a.is_active=true
    and upper(coalesce(a.currency,'RUB'))=upper(coalesce(v_claim.currency,'RUB'));

  return jsonb_build_object(
    'claim_id',v_claim.id,
    'claim_status',v_claim.status,
    'claim_direction',v_claim.claim_direction,
    'financial_direction',v_expected_direction,
    'direction_required',v_claim.claim_direction='MUTUAL',
    'amount',v_claim.settled_amount,
    'currency',v_claim.currency,
    'settlement_reference',v_claim.settlement_reference,
    'organization_id',v_org_id,
    'organization_name',v_org_name,
    'accounts',v_accounts,
    'posting',v_existing
  );
end
$$;

revoke all on function public.get_equipment_condition_claim_financial_options(uuid)
  from public,anon,authenticated;
grant execute on function public.get_equipment_condition_claim_financial_options(uuid)
  to authenticated;

create or replace function public.post_equipment_condition_claim_financial_transaction(
  p_claim_id uuid,
  p_cash_account_id uuid,
  p_financial_direction text default null,
  p_transaction_date date default current_date,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_claim public.equipment_condition_claims%rowtype;
  v_org_id uuid;
  v_org_name text;
  v_equipment_name text;
  v_inventory text;
  v_partner_name text;
  v_account public.cash_accounts%rowtype;
  v_direction text:=upper(btrim(coalesce(p_financial_direction,'')));
  v_expected text;
  v_category_name text;
  v_category_id uuid;
  v_actor uuid;
  v_tx_id uuid;
  v_description text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.contracts.manage')
     or not public.has_permission('production.settlements.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_claim_id is null then raise exception 'CLAIM_REQUIRED'; end if;
  if p_cash_account_id is null then raise exception 'CASH_ACCOUNT_REQUIRED'; end if;
  if p_transaction_date is null then raise exception 'TRANSACTION_DATE_REQUIRED'; end if;

  v_org_id:=public.equipment_condition_claim_financial_tenant_org(p_claim_id);

  select * into v_claim
  from public.equipment_condition_claims
  where id=p_claim_id
  for update;
  if v_claim.id is null then raise exception 'CLAIM_NOT_FOUND'; end if;
  if v_claim.status<>'SETTLED' then raise exception 'CLAIM_MUST_BE_SETTLED'; end if;
  if v_claim.settled_amount is null or v_claim.settled_amount<=0 then
    raise exception 'CLAIM_SETTLED_AMOUNT_REQUIRED';
  end if;
  if nullif(btrim(coalesce(v_claim.settlement_reference,'')),'') is null then
    raise exception 'SETTLEMENT_REFERENCE_REQUIRED';
  end if;

  if exists(
    select 1 from public.cash_transactions t
    where t.external_source='EQUIPMENT_CONDITION_CLAIM'
      and t.external_id=v_claim.id::text
  ) then raise exception 'CLAIM_FINANCIAL_POSTING_EXISTS'; end if;

  select a.inventory_number,a.name
    into v_inventory,v_equipment_name
  from public.equipment_assets a
  where a.id=v_claim.equipment_id
    and a.organization_id=v_org_id;
  if not found then raise exception 'CLAIM_FINANCIAL_TENANT_MISMATCH'; end if;

  select o.name into v_org_name
  from public.organizations o
  where o.id=v_org_id and o.is_active=true;
  if v_org_name is null then raise exception 'CLAIM_FINANCIAL_ORGANIZATION_INACTIVE'; end if;

  select * into v_account
  from public.cash_accounts a
  where a.id=p_cash_account_id
    and a.organization_id=v_org_id
    and a.is_active=true;
  if v_account.id is null then raise exception 'CLAIM_CASH_ACCOUNT_INVALID'; end if;
  if upper(coalesce(v_account.currency,'RUB'))<>upper(coalesce(v_claim.currency,'RUB')) then
    raise exception 'CLAIM_CASH_ACCOUNT_CURRENCY_MISMATCH';
  end if;

  v_expected:=case v_claim.claim_direction
    when 'HUB_TO_OWNER' then 'INCOME'
    when 'OWNER_TO_HUB' then 'EXPENSE'
    else null
  end;
  if v_expected is not null then
    if v_direction='' then v_direction:=v_expected; end if;
    if v_direction<>v_expected then
      raise exception 'CLAIM_FINANCIAL_DIRECTION_MISMATCH:%',v_expected;
    end if;
  else
    if v_direction not in ('INCOME','EXPENSE') then
      raise exception 'CLAIM_FINANCIAL_DIRECTION_REQUIRED';
    end if;
  end if;

  v_category_name:=case v_direction
    when 'INCOME' then 'Компенсация по состоянию оборудования'
    else 'Компенсация владельцу оборудования'
  end;

  select c.id into v_category_id
  from public.cash_categories c
  where c.organization_id=v_org_id
    and c.direction=v_direction
    and lower(c.name)=lower(v_category_name)
    and c.is_active=true
  order by c.created_at
  limit 1;

  if v_category_id is null then
    insert into public.cash_categories(organization_id,direction,name,is_active)
    values(v_org_id,v_direction,v_category_name,true)
    returning id into v_category_id;
  end if;

  v_actor:=public.current_staff_user_id();
  if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;

  select coalesce(nullif(p.legal_name,''),nullif(p.name,''),'Владелец')
    into v_partner_name
  from public.partners p
  where p.id=v_claim.partner_id;

  v_description:=concat(
    'Компенсация по требованию ',coalesce(v_claim.settlement_reference,v_claim.id::text),
    ' · ',coalesce(v_inventory,'—'),' ',coalesce(v_equipment_name,''),
    ' · ',coalesce(v_partner_name,'Владелец')
  );
  if nullif(btrim(coalesce(p_note,'')),'') is not null then
    v_description:=v_description||' · '||btrim(p_note);
  end if;

  insert into public.cash_transactions(
    organization_id,cash_account_id,category_id,direction,amount,payment_method,description,
    transaction_date,created_by,external_source,external_id,created_at,updated_at
  ) values(
    v_org_id,v_account.id,v_category_id,v_direction,v_claim.settled_amount,
    v_account.account_type,v_description,p_transaction_date,v_actor,
    'EQUIPMENT_CONDITION_CLAIM',v_claim.id::text,clock_timestamp(),clock_timestamp()
  ) returning id into v_tx_id;

  if v_claim.document_id is not null then
    insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at)
    values(v_claim.document_id,'CASH_TRANSACTION',v_tx_id,'FINANCIAL_POSTING',clock_timestamp())
    on conflict do nothing;
  end if;

  return v_tx_id;
exception
  when unique_violation then raise exception 'CLAIM_FINANCIAL_POSTING_EXISTS';
end
$$;

revoke all on function public.post_equipment_condition_claim_financial_transaction(uuid,uuid,text,date,text)
  from public,anon,authenticated;
grant execute on function public.post_equipment_condition_claim_financial_transaction(uuid,uuid,text,date,text)
  to authenticated;

create or replace function public.list_equipment_condition_claim_financial_postings()
returns table(
  claim_id uuid,
  transaction_id uuid,
  organization_name text,
  cash_account_name text,
  account_type text,
  financial_direction text,
  amount numeric,
  currency text,
  transaction_date date,
  description text,
  created_at timestamptz,
  created_by_name text
)
language plpgsql
security definer
stable
set search_path=''
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not (
    public.has_permission('equipment.view')
    or public.has_permission('equipment.contracts.manage')
    or public.has_permission('production.settlements.view')
    or public.has_permission('production.settlements.manage')
  ) then raise exception 'PERMISSION_DENIED'; end if;

  v_org:=public.current_user_organization_id();
  if v_org is null then raise exception 'ORGANIZATION_CONTEXT_REQUIRED'; end if;

  return query
  select c.id,t.id,o.name,a.name,a.account_type,t.direction,t.amount,
         coalesce(c.currency,a.currency,'RUB'),t.transaction_date,t.description,
         t.created_at,u.full_name
  from public.equipment_condition_claims c
  join public.equipment_contracts ec on ec.id=c.contract_id
  join public.equipment_assets ea on ea.id=c.equipment_id
  join public.cash_transactions t
    on t.external_source='EQUIPMENT_CONDITION_CLAIM'
   and t.external_id=c.id::text
  join public.cash_accounts a on a.id=t.cash_account_id
  join public.organizations o on o.id=t.organization_id
  left join public.users u on u.id=t.created_by
  where ec.organization_id=v_org
    and ea.organization_id=v_org
    and t.organization_id=v_org
    and a.organization_id=v_org
  order by t.created_at desc;
end
$$;

revoke all on function public.list_equipment_condition_claim_financial_postings()
  from public,anon,authenticated;
grant execute on function public.list_equipment_condition_claim_financial_postings()
  to authenticated;

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
  v_org_id uuid;
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
  if nullif(btrim(coalesce(p_reason,'')),'') is null or length(btrim(p_reason))<3 then
    raise exception 'REVERSAL_REASON_REQUIRED';
  end if;
  if nullif(btrim(coalesce(p_reference,'')),'') is null or length(btrim(p_reference))<2 then
    raise exception 'REVERSAL_REFERENCE_REQUIRED';
  end if;
  if p_transaction_date is null then raise exception 'TRANSACTION_DATE_REQUIRED'; end if;

  v_org_id:=public.equipment_condition_claim_financial_tenant_org(p_claim_id);

  select * into v_claim
  from public.equipment_condition_claims
  where id=p_claim_id
  for update;
  if v_claim.id is null then raise exception 'CLAIM_NOT_FOUND'; end if;
  if v_claim.status<>'SETTLED' then raise exception 'CLAIM_MUST_BE_SETTLED'; end if;

  select * into v_original
  from public.cash_transactions t
  where t.external_source='EQUIPMENT_CONDITION_CLAIM'
    and t.external_id=v_claim.id::text
  order by t.created_at desc
  limit 1
  for update;
  if v_original.id is null then raise exception 'CLAIM_FINANCIAL_POSTING_NOT_FOUND'; end if;
  if v_original.organization_id is distinct from v_org_id then
    raise exception 'CLAIM_FINANCIAL_TRANSACTION_TENANT_MISMATCH';
  end if;

  if exists(
    select 1
    from public.equipment_condition_claim_financial_reversals r
    where r.claim_id=v_claim.id
       or r.original_transaction_id=v_original.id
  ) or exists(
    select 1
    from public.cash_transactions t
    where t.external_source='EQUIPMENT_CONDITION_CLAIM_REVERSAL'
      and t.external_id=v_original.id::text
  ) then raise exception 'CLAIM_FINANCIAL_REVERSAL_EXISTS'; end if;

  select * into v_account
  from public.cash_accounts
  where id=v_original.cash_account_id;
  if v_account.id is null then raise exception 'REVERSAL_CASH_ACCOUNT_NOT_FOUND'; end if;
  if v_account.organization_id is distinct from v_org_id then
    raise exception 'REVERSAL_CASH_ACCOUNT_ORGANIZATION_MISMATCH';
  end if;

  v_direction:=case v_original.direction when 'INCOME' then 'EXPENSE' else 'INCOME' end;
  v_category_name:=case v_original.direction
    when 'INCOME' then 'Сторно компенсации по состоянию оборудования'
    else 'Сторно выплаты владельцу оборудования'
  end;

  select c.id into v_category_id
  from public.cash_categories c
  where c.organization_id=v_org_id
    and c.direction=v_direction
    and lower(c.name)=lower(v_category_name)
    and c.is_active=true
  order by c.created_at
  limit 1;

  if v_category_id is null then
    insert into public.cash_categories(organization_id,direction,name,is_active)
    values(v_org_id,v_direction,v_category_name,true)
    returning id into v_category_id;
  end if;

  v_actor:=public.current_staff_user_id();
  if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;

  v_description:=concat(
    'СТОРНО финансовой операции по требованию ',
    coalesce(v_claim.settlement_reference,v_claim.id::text),
    ' · исходная операция ',v_original.id::text,
    ' · основание ',btrim(p_reference),
    ' · причина ',btrim(p_reason)
  );

  insert into public.cash_transactions(
    organization_id,cash_account_id,category_id,direction,amount,payment_method,description,
    transaction_date,created_by,external_source,external_id,created_at,updated_at
  ) values(
    v_org_id,v_original.cash_account_id,v_category_id,v_direction,v_original.amount,
    v_original.payment_method,v_description,p_transaction_date,v_actor,
    'EQUIPMENT_CONDITION_CLAIM_REVERSAL',v_original.id::text,
    clock_timestamp(),clock_timestamp()
  )
  returning id into v_reversal_id;

  insert into public.equipment_condition_claim_financial_reversals(
    claim_id,original_transaction_id,reversal_transaction_id,reason,reference,
    reversed_by,reversed_at,created_at
  ) values(
    v_claim.id,v_original.id,v_reversal_id,btrim(p_reason),btrim(p_reference),
    v_actor,clock_timestamp(),clock_timestamp()
  );

  if v_claim.document_id is not null then
    insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at)
    values(v_claim.document_id,'CASH_TRANSACTION',v_reversal_id,'FINANCIAL_REVERSAL',clock_timestamp())
    on conflict do nothing;
  end if;

  return v_reversal_id;
exception
  when unique_violation then raise exception 'CLAIM_FINANCIAL_REVERSAL_EXISTS';
end
$$;

revoke all on function public.reverse_equipment_condition_claim_financial_transaction(uuid,text,text,date)
  from public,anon,authenticated;
grant execute on function public.reverse_equipment_condition_claim_financial_transaction(uuid,text,text,date)
  to authenticated;

create or replace function public.list_equipment_condition_claim_financial_reversals()
returns table(
  claim_id uuid,
  original_transaction_id uuid,
  reversal_transaction_id uuid,
  organization_name text,
  cash_account_name text,
  original_direction text,
  reversal_direction text,
  amount numeric,
  currency text,
  reversal_date date,
  reason text,
  reference text,
  reversed_at timestamptz,
  reversed_by_name text
)
language plpgsql
security definer
stable
set search_path=''
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not (
    public.has_permission('equipment.view')
    or public.has_permission('equipment.contracts.manage')
    or public.has_permission('production.settlements.view')
    or public.has_permission('production.settlements.manage')
  ) then raise exception 'PERMISSION_DENIED'; end if;

  v_org:=public.current_user_organization_id();
  if v_org is null then raise exception 'ORGANIZATION_CONTEXT_REQUIRED'; end if;

  return query
  select r.claim_id,r.original_transaction_id,r.reversal_transaction_id,o.name,a.name,
         orig.direction,rev.direction,rev.amount,coalesce(c.currency,a.currency,'RUB'),
         rev.transaction_date,r.reason,r.reference,r.reversed_at,u.full_name
  from public.equipment_condition_claim_financial_reversals r
  join public.equipment_condition_claims c on c.id=r.claim_id
  join public.equipment_contracts ec on ec.id=c.contract_id
  join public.equipment_assets ea on ea.id=c.equipment_id
  join public.cash_transactions orig on orig.id=r.original_transaction_id
  join public.cash_transactions rev on rev.id=r.reversal_transaction_id
  join public.cash_accounts a on a.id=orig.cash_account_id
  join public.organizations o on o.id=orig.organization_id
  left join public.users u on u.id=r.reversed_by
  where ec.organization_id=v_org
    and ea.organization_id=v_org
    and orig.organization_id=v_org
    and rev.organization_id=v_org
    and a.organization_id=v_org
  order by r.reversed_at desc;
end
$$;

revoke all on function public.list_equipment_condition_claim_financial_reversals()
  from public,anon,authenticated;
grant execute on function public.list_equipment_condition_claim_financial_reversals()
  to authenticated;

create or replace function public.get_equipment_condition_claim_financial_repost_options(p_claim_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path=''
as $$
declare
  v_claim public.equipment_condition_claims%rowtype;
  v_rev public.equipment_condition_claim_financial_reversals%rowtype;
  v_orig public.cash_transactions%rowtype;
  v_reverse_tx public.cash_transactions%rowtype;
  v_org_id uuid;
  v_org_name text;
  v_expected text;
  v_accounts jsonb;
  v_existing jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.contracts.manage')
     or not public.has_permission('production.settlements.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;

  v_org_id:=public.equipment_condition_claim_financial_tenant_org(p_claim_id);

  select * into v_claim
  from public.equipment_condition_claims
  where id=p_claim_id;
  if v_claim.id is null then raise exception 'CLAIM_NOT_FOUND'; end if;
  if v_claim.status<>'SETTLED' then raise exception 'CLAIM_MUST_BE_SETTLED'; end if;

  select * into v_rev
  from public.equipment_condition_claim_financial_reversals
  where claim_id=v_claim.id;
  if v_rev.id is null then raise exception 'CLAIM_FINANCIAL_REVERSAL_REQUIRED'; end if;

  select * into v_orig from public.cash_transactions where id=v_rev.original_transaction_id;
  select * into v_reverse_tx from public.cash_transactions where id=v_rev.reversal_transaction_id;
  if v_orig.id is null
     or v_reverse_tx.id is null
     or v_orig.amount<>v_reverse_tx.amount
     or v_orig.direction=v_reverse_tx.direction then
    raise exception 'CLAIM_FINANCIAL_REVERSAL_PAIR_INVALID';
  end if;
  if v_orig.organization_id is distinct from v_org_id
     or v_reverse_tx.organization_id is distinct from v_org_id then
    raise exception 'CLAIM_FINANCIAL_TRANSACTION_TENANT_MISMATCH';
  end if;

  select jsonb_build_object(
    'repost_id',r.id,
    'transaction_id',t.id,
    'direction',t.direction,
    'amount',t.amount,
    'transaction_date',t.transaction_date,
    'cash_account_id',t.cash_account_id,
    'cash_account_name',a.name,
    'created_at',t.created_at
  )
  into v_existing
  from public.equipment_condition_claim_financial_reposts r
  join public.cash_transactions t on t.id=r.transaction_id
  join public.cash_accounts a on a.id=t.cash_account_id
  where r.claim_id=v_claim.id
    and t.organization_id=v_org_id
    and a.organization_id=v_org_id;

  select o.name into v_org_name
  from public.organizations o
  where o.id=v_org_id and o.is_active=true;
  if v_org_name is null then raise exception 'CLAIM_FINANCIAL_ORGANIZATION_INACTIVE'; end if;

  v_expected:=case v_claim.claim_direction
    when 'HUB_TO_OWNER' then 'INCOME'
    when 'OWNER_TO_HUB' then 'EXPENSE'
    else null
  end;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,
    'name',a.name,
    'account_type',a.account_type,
    'currency',a.currency
  ) order by a.name),'[]'::jsonb)
  into v_accounts
  from public.cash_accounts a
  where a.organization_id=v_org_id
    and a.is_active=true
    and upper(coalesce(a.currency,'RUB'))=upper(coalesce(v_claim.currency,'RUB'));

  return jsonb_build_object(
    'claim_id',v_claim.id,
    'reversal_id',v_rev.id,
    'organization_id',v_org_id,
    'organization_name',v_org_name,
    'amount',v_claim.settled_amount,
    'currency',v_claim.currency,
    'financial_direction',v_expected,
    'direction_required',v_claim.claim_direction='MUTUAL',
    'accounts',v_accounts,
    'repost',v_existing
  );
end
$$;

revoke all on function public.get_equipment_condition_claim_financial_repost_options(uuid)
  from public,anon,authenticated;
grant execute on function public.get_equipment_condition_claim_financial_repost_options(uuid)
  to authenticated;

create or replace function public.repost_equipment_condition_claim_financial_transaction(
  p_claim_id uuid,
  p_cash_account_id uuid,
  p_financial_direction text default null,
  p_transaction_date date default current_date,
  p_reason text default null,
  p_reference text default null
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_claim public.equipment_condition_claims%rowtype;
  v_rev public.equipment_condition_claim_financial_reversals%rowtype;
  v_orig public.cash_transactions%rowtype;
  v_reverse_tx public.cash_transactions%rowtype;
  v_account public.cash_accounts%rowtype;
  v_org_id uuid;
  v_direction text:=upper(btrim(coalesce(p_financial_direction,'')));
  v_expected text;
  v_category_id uuid;
  v_category_name text;
  v_actor uuid;
  v_tx uuid;
  v_description text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.contracts.manage')
     or not public.has_permission('production.settlements.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null or length(btrim(p_reason))<3 then
    raise exception 'REPOST_REASON_REQUIRED';
  end if;
  if nullif(btrim(coalesce(p_reference,'')),'') is null or length(btrim(p_reference))<2 then
    raise exception 'REPOST_REFERENCE_REQUIRED';
  end if;
  if p_cash_account_id is null then raise exception 'CASH_ACCOUNT_REQUIRED'; end if;
  if p_transaction_date is null then raise exception 'TRANSACTION_DATE_REQUIRED'; end if;

  v_org_id:=public.equipment_condition_claim_financial_tenant_org(p_claim_id);

  select * into v_claim
  from public.equipment_condition_claims
  where id=p_claim_id
  for update;
  if v_claim.id is null then raise exception 'CLAIM_NOT_FOUND'; end if;
  if v_claim.status<>'SETTLED' then raise exception 'CLAIM_MUST_BE_SETTLED'; end if;
  if v_claim.settled_amount is null or v_claim.settled_amount<=0 then
    raise exception 'CLAIM_SETTLED_AMOUNT_REQUIRED';
  end if;

  select * into v_rev
  from public.equipment_condition_claim_financial_reversals
  where claim_id=v_claim.id;
  if v_rev.id is null then raise exception 'CLAIM_FINANCIAL_REVERSAL_REQUIRED'; end if;

  if exists(
    select 1
    from public.equipment_condition_claim_financial_reposts
    where claim_id=v_claim.id
  ) or exists(
    select 1
    from public.cash_transactions
    where external_source='EQUIPMENT_CONDITION_CLAIM_REPOST'
      and external_id=v_claim.id::text
  ) then raise exception 'CLAIM_FINANCIAL_REPOST_EXISTS'; end if;

  select * into v_orig
  from public.cash_transactions
  where id=v_rev.original_transaction_id;
  select * into v_reverse_tx
  from public.cash_transactions
  where id=v_rev.reversal_transaction_id;

  if v_orig.id is null
     or v_reverse_tx.id is null
     or v_orig.amount<>v_reverse_tx.amount
     or v_orig.direction=v_reverse_tx.direction then
    raise exception 'CLAIM_FINANCIAL_REVERSAL_PAIR_INVALID';
  end if;
  if v_orig.organization_id is distinct from v_org_id
     or v_reverse_tx.organization_id is distinct from v_org_id then
    raise exception 'CLAIM_FINANCIAL_TRANSACTION_TENANT_MISMATCH';
  end if;

  if not exists(
    select 1
    from public.organizations
    where id=v_org_id and is_active=true
  ) then raise exception 'CLAIM_FINANCIAL_ORGANIZATION_INACTIVE'; end if;

  select * into v_account
  from public.cash_accounts
  where id=p_cash_account_id
    and organization_id=v_org_id
    and is_active=true;
  if v_account.id is null then raise exception 'CLAIM_CASH_ACCOUNT_INVALID'; end if;
  if upper(coalesce(v_account.currency,'RUB'))<>upper(coalesce(v_claim.currency,'RUB')) then
    raise exception 'CLAIM_CASH_ACCOUNT_CURRENCY_MISMATCH';
  end if;

  v_expected:=case v_claim.claim_direction
    when 'HUB_TO_OWNER' then 'INCOME'
    when 'OWNER_TO_HUB' then 'EXPENSE'
    else null
  end;

  if v_expected is not null then
    if v_direction='' then v_direction:=v_expected; end if;
    if v_direction<>v_expected then
      raise exception 'CLAIM_FINANCIAL_DIRECTION_MISMATCH:%',v_expected;
    end if;
  else
    if v_direction not in('INCOME','EXPENSE') then
      raise exception 'CLAIM_FINANCIAL_DIRECTION_REQUIRED';
    end if;
  end if;

  v_category_name:=case v_direction
    when 'INCOME' then 'Компенсация по состоянию оборудования'
    else 'Компенсация владельцу оборудования'
  end;

  select c.id into v_category_id
  from public.cash_categories c
  where c.organization_id=v_org_id
    and c.direction=v_direction
    and lower(c.name)=lower(v_category_name)
    and c.is_active=true
  order by c.created_at
  limit 1;

  if v_category_id is null then
    insert into public.cash_categories(organization_id,direction,name,is_active)
    values(v_org_id,v_direction,v_category_name,true)
    returning id into v_category_id;
  end if;

  v_actor:=public.current_staff_user_id();
  if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;

  v_description:=concat(
    'ИСПРАВЛЕННАЯ финансовая операция после сторно по требованию ',
    coalesce(v_claim.settlement_reference,v_claim.id::text),
    ' · документ ',btrim(p_reference),
    ' · причина ',btrim(p_reason)
  );

  insert into public.cash_transactions(
    organization_id,cash_account_id,category_id,direction,amount,payment_method,description,
    transaction_date,created_by,external_source,external_id,created_at,updated_at
  )
  values(
    v_org_id,v_account.id,v_category_id,v_direction,v_claim.settled_amount,
    v_account.account_type,v_description,p_transaction_date,v_actor,
    'EQUIPMENT_CONDITION_CLAIM_REPOST',v_claim.id::text,
    clock_timestamp(),clock_timestamp()
  )
  returning id into v_tx;

  insert into public.equipment_condition_claim_financial_reposts(
    claim_id,reversal_id,transaction_id,reason,reference,posted_by,posted_at,created_at
  )
  values(
    v_claim.id,v_rev.id,v_tx,btrim(p_reason),btrim(p_reference),
    v_actor,clock_timestamp(),clock_timestamp()
  );

  if v_claim.document_id is not null then
    insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at)
    values(v_claim.document_id,'CASH_TRANSACTION',v_tx,'FINANCIAL_REPOST',clock_timestamp())
    on conflict do nothing;
  end if;

  return v_tx;
exception
  when unique_violation then raise exception 'CLAIM_FINANCIAL_REPOST_EXISTS';
end
$$;

revoke all on function public.repost_equipment_condition_claim_financial_transaction(uuid,uuid,text,date,text,text)
  from public,anon,authenticated;
grant execute on function public.repost_equipment_condition_claim_financial_transaction(uuid,uuid,text,date,text,text)
  to authenticated;

create or replace function public.list_equipment_condition_claim_financial_reposts()
returns table(
  claim_id uuid,
  repost_id uuid,
  transaction_id uuid,
  organization_name text,
  cash_account_name text,
  financial_direction text,
  amount numeric,
  currency text,
  transaction_date date,
  reason text,
  reference text,
  posted_at timestamptz,
  posted_by_name text
)
language plpgsql
security definer
stable
set search_path=''
as $$
declare
  v_org uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not(
    public.has_permission('equipment.view')
    or public.has_permission('equipment.contracts.manage')
    or public.has_permission('production.settlements.view')
    or public.has_permission('production.settlements.manage')
  ) then raise exception 'PERMISSION_DENIED'; end if;

  v_org:=public.current_user_organization_id();
  if v_org is null then raise exception 'ORGANIZATION_CONTEXT_REQUIRED'; end if;

  return query
  select c.id,r.id,t.id,o.name,a.name,t.direction,t.amount,
         coalesce(c.currency,a.currency,'RUB'),t.transaction_date,
         r.reason,r.reference,r.posted_at,u.full_name
  from public.equipment_condition_claim_financial_reposts r
  join public.equipment_condition_claims c on c.id=r.claim_id
  join public.equipment_contracts ec on ec.id=c.contract_id
  join public.equipment_assets ea on ea.id=c.equipment_id
  join public.cash_transactions t on t.id=r.transaction_id
  join public.cash_accounts a on a.id=t.cash_account_id
  join public.organizations o on o.id=t.organization_id
  left join public.users u on u.id=r.posted_by
  where ec.organization_id=v_org
    and ea.organization_id=v_org
    and t.organization_id=v_org
    and a.organization_id=v_org
  order by r.posted_at desc;
end
$$;

revoke all on function public.list_equipment_condition_claim_financial_reposts()
  from public,anon,authenticated;
grant execute on function public.list_equipment_condition_claim_financial_reposts()
  to authenticated;
