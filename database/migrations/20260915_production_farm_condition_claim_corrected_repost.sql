-- A4PRINT HUB: Production Farm Phase 29 — controlled corrected repost after a Phase 28 reversal.

create table if not exists public.equipment_condition_claim_financial_reposts (
  id uuid primary key default gen_random_uuid(),
  claim_id uuid not null references public.equipment_condition_claims(id) on delete restrict,
  reversal_id uuid not null references public.equipment_condition_claim_financial_reversals(id) on delete restrict,
  transaction_id uuid not null references public.cash_transactions(id) on delete restrict,
  reason text not null,
  reference text not null,
  posted_by uuid not null references public.users(id) on delete restrict,
  posted_at timestamptz not null default clock_timestamp(),
  created_at timestamptz not null default clock_timestamp(),
  constraint equipment_condition_claim_financial_reposts_reason_check check(length(btrim(reason))>=3),
  constraint equipment_condition_claim_financial_reposts_reference_check check(length(btrim(reference))>=2),
  constraint equipment_condition_claim_financial_reposts_claim_unique unique(claim_id),
  constraint equipment_condition_claim_financial_reposts_reversal_unique unique(reversal_id),
  constraint equipment_condition_claim_financial_reposts_transaction_unique unique(transaction_id)
);

create unique index if not exists uq_cash_transactions_equipment_condition_claim_repost
  on public.cash_transactions(external_id)
  where external_source='EQUIPMENT_CONDITION_CLAIM_REPOST';

alter table public.equipment_condition_claim_financial_reposts enable row level security;
revoke all on public.equipment_condition_claim_financial_reposts from public,anon,authenticated;
grant select on public.equipment_condition_claim_financial_reposts to authenticated;

drop policy if exists equipment_condition_claim_financial_reposts_staff_read on public.equipment_condition_claim_financial_reposts;
create policy equipment_condition_claim_financial_reposts_staff_read
on public.equipment_condition_claim_financial_reposts
for select to authenticated
using(
  public.has_permission('equipment.view')
  or public.has_permission('equipment.contracts.manage')
  or public.has_permission('production.settlements.view')
  or public.has_permission('production.settlements.manage')
);

create or replace function public.guard_equipment_condition_claim_financial_repost_append_only()
returns trigger language plpgsql set search_path=''
as $$ begin raise exception 'CONDITION_CLAIM_FINANCIAL_REPOST_APPEND_ONLY'; end $$;
revoke all on function public.guard_equipment_condition_claim_financial_repost_append_only() from public,anon,authenticated;

drop trigger if exists trg_guard_equipment_condition_claim_financial_repost_append_only on public.equipment_condition_claim_financial_reposts;
create trigger trg_guard_equipment_condition_claim_financial_repost_append_only
before update or delete on public.equipment_condition_claim_financial_reposts
for each row execute function public.guard_equipment_condition_claim_financial_repost_append_only();

drop trigger if exists trg_audit_equipment_condition_claim_financial_reposts on public.equipment_condition_claim_financial_reposts;
create trigger trg_audit_equipment_condition_claim_financial_reposts
after insert or update or delete on public.equipment_condition_claim_financial_reposts
for each row execute function public.audit_row_change();

create or replace function public.get_equipment_condition_claim_financial_repost_options(p_claim_id uuid)
returns jsonb
language plpgsql security definer stable set search_path=''
as $$
declare
  v_claim public.equipment_condition_claims%rowtype;
  v_rev public.equipment_condition_claim_financial_reversals%rowtype;
  v_orig public.cash_transactions%rowtype;
  v_reverse_tx public.cash_transactions%rowtype;
  v_org_id uuid; v_org_name text; v_expected text; v_accounts jsonb; v_existing jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.contracts.manage') or not public.has_permission('production.settlements.manage') then raise exception 'PERMISSION_DENIED'; end if;
  select * into v_claim from public.equipment_condition_claims where id=p_claim_id;
  if v_claim.id is null then raise exception 'CLAIM_NOT_FOUND'; end if;
  if v_claim.status<>'SETTLED' then raise exception 'CLAIM_MUST_BE_SETTLED'; end if;
  select * into v_rev from public.equipment_condition_claim_financial_reversals where claim_id=v_claim.id;
  if v_rev.id is null then raise exception 'CLAIM_FINANCIAL_REVERSAL_REQUIRED'; end if;
  select * into v_orig from public.cash_transactions where id=v_rev.original_transaction_id;
  select * into v_reverse_tx from public.cash_transactions where id=v_rev.reversal_transaction_id;
  if v_orig.id is null or v_reverse_tx.id is null or v_orig.amount<>v_reverse_tx.amount or v_orig.direction=v_reverse_tx.direction then raise exception 'CLAIM_FINANCIAL_REVERSAL_PAIR_INVALID'; end if;
  select jsonb_build_object('repost_id',r.id,'transaction_id',t.id,'direction',t.direction,'amount',t.amount,'transaction_date',t.transaction_date,'cash_account_id',t.cash_account_id,'cash_account_name',a.name,'created_at',t.created_at)
    into v_existing from public.equipment_condition_claim_financial_reposts r join public.cash_transactions t on t.id=r.transaction_id join public.cash_accounts a on a.id=t.cash_account_id where r.claim_id=v_claim.id;
  select a.organization_id into v_org_id from public.equipment_assets a where a.id=v_claim.equipment_id;
  if v_org_id is null then raise exception 'CLAIM_FINANCIAL_ORGANIZATION_REQUIRED'; end if;
  select o.name into v_org_name from public.organizations o where o.id=v_org_id and o.is_active=true;
  if v_org_name is null then raise exception 'CLAIM_FINANCIAL_ORGANIZATION_INACTIVE'; end if;
  v_expected:=case v_claim.claim_direction when 'HUB_TO_OWNER' then 'INCOME' when 'OWNER_TO_HUB' then 'EXPENSE' else null end;
  select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'account_type',a.account_type,'currency',a.currency) order by a.name),'[]'::jsonb) into v_accounts
  from public.cash_accounts a where a.organization_id=v_org_id and a.is_active=true and upper(coalesce(a.currency,'RUB'))=upper(coalesce(v_claim.currency,'RUB'));
  return jsonb_build_object('claim_id',v_claim.id,'reversal_id',v_rev.id,'organization_id',v_org_id,'organization_name',v_org_name,'amount',v_claim.settled_amount,'currency',v_claim.currency,'financial_direction',v_expected,'direction_required',v_claim.claim_direction='MUTUAL','accounts',v_accounts,'repost',v_existing);
end $$;
revoke all on function public.get_equipment_condition_claim_financial_repost_options(uuid) from public,anon,authenticated;
grant execute on function public.get_equipment_condition_claim_financial_repost_options(uuid) to authenticated;

create or replace function public.repost_equipment_condition_claim_financial_transaction(p_claim_id uuid,p_cash_account_id uuid,p_financial_direction text default null,p_transaction_date date default current_date,p_reason text default null,p_reference text default null)
returns uuid language plpgsql security definer set search_path=''
as $$
declare
  v_claim public.equipment_condition_claims%rowtype; v_rev public.equipment_condition_claim_financial_reversals%rowtype; v_orig public.cash_transactions%rowtype; v_reverse_tx public.cash_transactions%rowtype; v_account public.cash_accounts%rowtype;
  v_org_id uuid; v_direction text:=upper(btrim(coalesce(p_financial_direction,''))); v_expected text; v_category_id uuid; v_category_name text; v_actor uuid; v_tx uuid; v_description text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.contracts.manage') or not public.has_permission('production.settlements.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null or length(btrim(p_reason))<3 then raise exception 'REPOST_REASON_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_reference,'')),'') is null or length(btrim(p_reference))<2 then raise exception 'REPOST_REFERENCE_REQUIRED'; end if;
  if p_cash_account_id is null then raise exception 'CASH_ACCOUNT_REQUIRED'; end if;
  if p_transaction_date is null then raise exception 'TRANSACTION_DATE_REQUIRED'; end if;
  select * into v_claim from public.equipment_condition_claims where id=p_claim_id for update;
  if v_claim.id is null then raise exception 'CLAIM_NOT_FOUND'; end if;
  if v_claim.status<>'SETTLED' then raise exception 'CLAIM_MUST_BE_SETTLED'; end if;
  if v_claim.settled_amount is null or v_claim.settled_amount<=0 then raise exception 'CLAIM_SETTLED_AMOUNT_REQUIRED'; end if;
  select * into v_rev from public.equipment_condition_claim_financial_reversals where claim_id=v_claim.id;
  if v_rev.id is null then raise exception 'CLAIM_FINANCIAL_REVERSAL_REQUIRED'; end if;
  if exists(select 1 from public.equipment_condition_claim_financial_reposts where claim_id=v_claim.id) or exists(select 1 from public.cash_transactions where external_source='EQUIPMENT_CONDITION_CLAIM_REPOST' and external_id=v_claim.id::text) then raise exception 'CLAIM_FINANCIAL_REPOST_EXISTS'; end if;
  select * into v_orig from public.cash_transactions where id=v_rev.original_transaction_id;
  select * into v_reverse_tx from public.cash_transactions where id=v_rev.reversal_transaction_id;
  if v_orig.id is null or v_reverse_tx.id is null or v_orig.amount<>v_reverse_tx.amount or v_orig.direction=v_reverse_tx.direction then raise exception 'CLAIM_FINANCIAL_REVERSAL_PAIR_INVALID'; end if;
  select a.organization_id into v_org_id from public.equipment_assets a where a.id=v_claim.equipment_id;
  if v_org_id is null then raise exception 'CLAIM_FINANCIAL_ORGANIZATION_REQUIRED'; end if;
  if not exists(select 1 from public.organizations where id=v_org_id and is_active=true) then raise exception 'CLAIM_FINANCIAL_ORGANIZATION_INACTIVE'; end if;
  select * into v_account from public.cash_accounts where id=p_cash_account_id and organization_id=v_org_id and is_active=true;
  if v_account.id is null then raise exception 'CLAIM_CASH_ACCOUNT_INVALID'; end if;
  if upper(coalesce(v_account.currency,'RUB'))<>upper(coalesce(v_claim.currency,'RUB')) then raise exception 'CLAIM_CASH_ACCOUNT_CURRENCY_MISMATCH'; end if;
  v_expected:=case v_claim.claim_direction when 'HUB_TO_OWNER' then 'INCOME' when 'OWNER_TO_HUB' then 'EXPENSE' else null end;
  if v_expected is not null then if v_direction='' then v_direction:=v_expected; end if; if v_direction<>v_expected then raise exception 'CLAIM_FINANCIAL_DIRECTION_MISMATCH:%',v_expected; end if; else if v_direction not in('INCOME','EXPENSE') then raise exception 'CLAIM_FINANCIAL_DIRECTION_REQUIRED'; end if; end if;
  v_category_name:=case v_direction when 'INCOME' then 'Компенсация по состоянию оборудования' else 'Компенсация владельцу оборудования' end;
  select c.id into v_category_id from public.cash_categories c where c.organization_id=v_org_id and c.direction=v_direction and lower(c.name)=lower(v_category_name) and c.is_active=true order by c.created_at limit 1;
  if v_category_id is null then insert into public.cash_categories(organization_id,direction,name,is_active) values(v_org_id,v_direction,v_category_name,true) returning id into v_category_id; end if;
  v_actor:=public.current_staff_user_id(); if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;
  v_description:=concat('ИСПРАВЛЕННАЯ финансовая операция после сторно по требованию ',coalesce(v_claim.settlement_reference,v_claim.id::text),' · документ ',btrim(p_reference),' · причина ',btrim(p_reason));
  insert into public.cash_transactions(organization_id,cash_account_id,category_id,direction,amount,payment_method,description,transaction_date,created_by,external_source,external_id,created_at,updated_at)
  values(v_org_id,v_account.id,v_category_id,v_direction,v_claim.settled_amount,v_account.account_type,v_description,p_transaction_date,v_actor,'EQUIPMENT_CONDITION_CLAIM_REPOST',v_claim.id::text,clock_timestamp(),clock_timestamp()) returning id into v_tx;
  insert into public.equipment_condition_claim_financial_reposts(claim_id,reversal_id,transaction_id,reason,reference,posted_by,posted_at,created_at) values(v_claim.id,v_rev.id,v_tx,btrim(p_reason),btrim(p_reference),v_actor,clock_timestamp(),clock_timestamp());
  if v_claim.document_id is not null then insert into public.document_links(document_id,entity_type,entity_id,relationship,created_at) values(v_claim.document_id,'CASH_TRANSACTION',v_tx,'FINANCIAL_REPOST',clock_timestamp()) on conflict do nothing; end if;
  return v_tx;
exception when unique_violation then raise exception 'CLAIM_FINANCIAL_REPOST_EXISTS';
end $$;
revoke all on function public.repost_equipment_condition_claim_financial_transaction(uuid,uuid,text,date,text,text) from public,anon,authenticated;
grant execute on function public.repost_equipment_condition_claim_financial_transaction(uuid,uuid,text,date,text,text) to authenticated;

create or replace function public.list_equipment_condition_claim_financial_reposts()
returns table(claim_id uuid,repost_id uuid,transaction_id uuid,organization_name text,cash_account_name text,financial_direction text,amount numeric,currency text,transaction_date date,reason text,reference text,posted_at timestamptz,posted_by_name text)
language plpgsql security definer stable set search_path=''
as $$ begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not(public.has_permission('equipment.view') or public.has_permission('equipment.contracts.manage') or public.has_permission('production.settlements.view') or public.has_permission('production.settlements.manage')) then raise exception 'PERMISSION_DENIED'; end if;
  return query select c.id,r.id,t.id,o.name,a.name,t.direction,t.amount,coalesce(c.currency,a.currency,'RUB'),t.transaction_date,r.reason,r.reference,r.posted_at,u.full_name
  from public.equipment_condition_claim_financial_reposts r join public.equipment_condition_claims c on c.id=r.claim_id join public.cash_transactions t on t.id=r.transaction_id join public.cash_accounts a on a.id=t.cash_account_id join public.organizations o on o.id=t.organization_id left join public.users u on u.id=r.posted_by order by r.posted_at desc;
end $$;
revoke all on function public.list_equipment_condition_claim_financial_reposts() from public,anon,authenticated;
grant execute on function public.list_equipment_condition_claim_financial_reposts() to authenticated;

create or replace function public.get_my_equipment_condition_claim_financial_reposts()
returns table(claim_id uuid,financial_direction text,amount numeric,currency text,transaction_date date,reference text,posted_at timestamptz)
language plpgsql security definer stable set search_path=''
as $$ declare v_partner uuid; begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if; v_partner:=public.current_partner_id(); if v_partner is null then raise exception 'PARTNER_NOT_FOUND'; end if;
  return query select c.id,t.direction,t.amount,coalesce(c.currency,a.currency,'RUB'),t.transaction_date,r.reference,r.posted_at
  from public.equipment_condition_claim_financial_reposts r join public.equipment_condition_claims c on c.id=r.claim_id join public.cash_transactions t on t.id=r.transaction_id join public.cash_accounts a on a.id=t.cash_account_id
  where c.partner_id=v_partner and c.status='SETTLED' order by r.posted_at desc;
end $$;
revoke all on function public.get_my_equipment_condition_claim_financial_reposts() from public,anon,authenticated;
grant execute on function public.get_my_equipment_condition_claim_financial_reposts() to authenticated;
