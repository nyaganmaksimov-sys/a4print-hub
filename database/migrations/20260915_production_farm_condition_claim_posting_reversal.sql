-- A4PRINT HUB: Production Farm Phase 28 — controlled reversal of condition-claim financial postings.

create table if not exists public.equipment_condition_claim_financial_reversals (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.equipment_condition_claims(id) on delete restrict,
  original_transaction_id uuid not null references public.cash_transactions(id) on delete restrict,
  reversal_transaction_id uuid not null references public.cash_transactions(id) on delete restrict,
  reason text not null,
  reference text not null,
  reversed_by uuid not null references public.users(id) on delete restrict,
  reversed_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  constraint equipment_condition_claim_financial_reversals_reason_check check (length(btrim(reason)) >= 3),
  constraint equipment_condition_claim_financial_reversals_reference_check check (length(btrim(reference)) >= 2),
  constraint equipment_condition_claim_financial_reversals_claim_unique unique (claim_id),
  constraint equipment_condition_claim_financial_reversals_original_unique unique (original_transaction_id),
  constraint equipment_condition_claim_financial_reversals_reversal_unique unique (reversal_transaction_id)
);

create unique index if not exists uq_cash_transactions_equipment_condition_claim_reversal
  on public.cash_transactions(external_id)
  where external_source='EQUIPMENT_CONDITION_CLAIM_REVERSAL';

alter table public.equipment_condition_claim_financial_reversals enable row level security;
revoke all on public.equipment_condition_claim_financial_reversals from public,anon,authenticated;
grant select on public.equipment_condition_claim_financial_reversals to authenticated;

drop policy if exists equipment_condition_claim_financial_reversals_staff_read on public.equipment_condition_claim_financial_reversals;
create policy equipment_condition_claim_financial_reversals_staff_read
on public.equipment_condition_claim_financial_reversals
for select to authenticated
using (
  public.has_permission('equipment.view')
  or public.has_permission('equipment.contracts.manage')
  or public.has_permission('production.settlements.view')
  or public.has_permission('production.settlements.manage')
);

create or replace function public.guard_equipment_condition_claim_financial_reversal_append_only()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'CONDITION_CLAIM_FINANCIAL_REVERSAL_APPEND_ONLY';
end
$$;
revoke all on function public.guard_equipment_condition_claim_financial_reversal_append_only() from public,anon,authenticated;

drop trigger if exists trg_guard_equipment_condition_claim_financial_reversal_append_only on public.equipment_condition_claim_financial_reversals;
create trigger trg_guard_equipment_condition_claim_financial_reversal_append_only
before update or delete on public.equipment_condition_claim_financial_reversals
for each row execute function public.guard_equipment_condition_claim_financial_reversal_append_only();

drop trigger if exists trg_audit_equipment_condition_claim_financial_reversals on public.equipment_condition_claim_financial_reversals;
create trigger trg_audit_equipment_condition_claim_financial_reversals
after insert or update or delete on public.equipment_condition_claim_financial_reversals
for each row execute function public.audit_row_change();

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

  if exists(select 1 from public.equipment_condition_claim_financial_reversals r where r.claim_id=v_claim.id or r.original_transaction_id=v_original.id)
     or exists(select 1 from public.cash_transactions t where t.external_source='EQUIPMENT_CONDITION_CLAIM_REVERSAL' and t.external_id=v_original.id::text) then
    raise exception 'CLAIM_FINANCIAL_REVERSAL_EXISTS';
  end if;

  select * into v_account from public.cash_accounts where id=v_original.cash_account_id and is_active=true;
  if v_account.id is null then raise exception 'REVERSAL_CASH_ACCOUNT_INACTIVE'; end if;
  if v_account.organization_id<>v_original.organization_id then raise exception 'REVERSAL_CASH_ACCOUNT_ORGANIZATION_MISMATCH'; end if;

  v_direction:=case v_original.direction when 'INCOME' then 'EXPENSE' else 'INCOME' end;
  v_category_name:=case v_original.direction
    when 'INCOME' then 'Сторно компенсации по состоянию оборудования'
    else 'Сторно выплаты владельцу оборудования'
  end;

  select c.id into v_category_id
  from public.cash_categories c
  where c.organization_id=v_original.organization_id
    and c.direction=v_direction
    and lower(c.name)=lower(v_category_name)
    and c.is_active=true
  order by c.created_at
  limit 1;
  if v_category_id is null then
    insert into public.cash_categories(organization_id,direction,name,is_active)
    values(v_original.organization_id,v_direction,v_category_name,true)
    returning id into v_category_id;
  end if;

  v_actor:=public.current_staff_user_id();
  if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;

  v_description:=concat(
    'СТОРНО финансовой операции по требованию ',coalesce(v_claim.settlement_reference,v_claim.id::text),
    ' · исходная операция ',v_original.id::text,
    ' · основание ',btrim(p_reference),
    ' · причина ',btrim(p_reason)
  );

  insert into public.cash_transactions(
    organization_id,cash_account_id,category_id,direction,amount,payment_method,description,
    transaction_date,created_by,external_source,external_id,created_at,updated_at
  ) values(
    v_original.organization_id,v_original.cash_account_id,v_category_id,v_direction,v_original.amount,v_original.payment_method,v_description,
    p_transaction_date,v_actor,'EQUIPMENT_CONDITION_CLAIM_REVERSAL',v_original.id::text,clock_timestamp(),clock_timestamp()
  ) returning id into v_reversal_id;

  insert into public.equipment_condition_claim_financial_reversals(
    claim_id,original_transaction_id,reversal_transaction_id,reason,reference,reversed_by,reversed_at,created_at
  ) values(
    v_claim.id,v_original.id,v_reversal_id,btrim(p_reason),btrim(p_reference),v_actor,clock_timestamp(),clock_timestamp()
  );

  if v_claim.document_id is not null then
    insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at)
    values(v_claim.document_id,'CASH_TRANSACTION',v_reversal_id,'FINANCIAL_REVERSAL',clock_timestamp())
    on conflict do nothing;
  end if;

  return v_reversal_id;
exception
  when unique_violation then
    raise exception 'CLAIM_FINANCIAL_REVERSAL_EXISTS';
end
$$;
revoke all on function public.reverse_equipment_condition_claim_financial_transaction(uuid,text,text,date) from public,anon,authenticated;
grant execute on function public.reverse_equipment_condition_claim_financial_transaction(uuid,text,text,date) to authenticated;

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
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not (public.has_permission('equipment.view') or public.has_permission('equipment.contracts.manage') or public.has_permission('production.settlements.view') or public.has_permission('production.settlements.manage')) then
    raise exception 'PERMISSION_DENIED';
  end if;
  return query
  select r.claim_id,r.original_transaction_id,r.reversal_transaction_id,o.name,a.name,orig.direction,rev.direction,
         rev.amount,coalesce(c.currency,a.currency,'RUB'),rev.transaction_date,r.reason,r.reference,r.reversed_at,u.full_name
  from public.equipment_condition_claim_financial_reversals r
  join public.equipment_condition_claims c on c.id=r.claim_id
  join public.cash_transactions orig on orig.id=r.original_transaction_id
  join public.cash_transactions rev on rev.id=r.reversal_transaction_id
  join public.cash_accounts a on a.id=orig.cash_account_id
  join public.organizations o on o.id=orig.organization_id
  left join public.users u on u.id=r.reversed_by
  order by r.reversed_at desc;
end
$$;
revoke all on function public.list_equipment_condition_claim_financial_reversals() from public,anon,authenticated;
grant execute on function public.list_equipment_condition_claim_financial_reversals() to authenticated;

create or replace function public.get_my_equipment_condition_claim_financial_reversals()
returns table(
  claim_id uuid,
  original_direction text,
  reversal_direction text,
  amount numeric,
  currency text,
  reversal_date date,
  reference text,
  reversed_at timestamptz
)
language plpgsql
security definer
stable
set search_path=''
as $$
declare
  v_partner uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  v_partner:=public.current_partner_id();
  if v_partner is null then raise exception 'PARTNER_NOT_FOUND'; end if;
  return query
  select r.claim_id,orig.direction,rev.direction,rev.amount,coalesce(c.currency,a.currency,'RUB'),rev.transaction_date,r.reference,r.reversed_at
  from public.equipment_condition_claim_financial_reversals r
  join public.equipment_condition_claims c on c.id=r.claim_id
  join public.cash_transactions orig on orig.id=r.original_transaction_id
  join public.cash_transactions rev on rev.id=r.reversal_transaction_id
  join public.cash_accounts a on a.id=orig.cash_account_id
  where c.partner_id=v_partner and c.status='SETTLED'
  order by r.reversed_at desc;
end
$$;
revoke all on function public.get_my_equipment_condition_claim_financial_reversals() from public,anon,authenticated;
grant execute on function public.get_my_equipment_condition_claim_financial_reversals() to authenticated;
