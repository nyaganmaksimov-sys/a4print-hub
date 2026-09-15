-- A4PRINT HUB: Production Farm Phase 30 hardening — actual money truth comes from source-tagged cash_transactions.

create or replace function public.equipment_condition_claim_financial_integrity_rows()
returns table(
  claim_id uuid,
  partner_id uuid,
  partner_name text,
  contract_number text,
  equipment_id uuid,
  inventory_number text,
  equipment_name text,
  claim_status text,
  claim_direction text,
  settled_amount numeric,
  currency text,
  chain_state text,
  integrity_state text,
  issue_codes text[],
  actual_net_effect numeric,
  expected_net_effect numeric,
  original_transaction_id uuid,
  reversal_transaction_id uuid,
  repost_transaction_id uuid,
  original_amount numeric,
  reversal_amount numeric,
  repost_amount numeric,
  original_direction text,
  reversal_direction text,
  repost_direction text,
  original_account_name text,
  repost_account_name text,
  last_activity_at timestamptz
)
language sql
security definer
stable
set search_path=''
as $$
with base as (
  select
    c.id claim_id,c.partner_id,coalesce(p.legal_name,p.name)::text partner_name,ec.contract_number::text,
    c.equipment_id,ea.inventory_number::text,ea.name::text equipment_name,c.status::text claim_status,
    c.claim_direction::text,c.settled_amount,c.currency::text,ea.organization_id expected_organization_id,
    case c.claim_direction when 'HUB_TO_OWNER' then 'INCOME' when 'OWNER_TO_HUB' then 'EXPENSE' else null end expected_direction,
    ot.id original_transaction_id,ot.organization_id original_organization_id,ot.cash_account_id original_account_id,
    ot.direction::text original_direction,ot.amount original_amount,ot.created_at original_created_at,
    oa.name::text original_account_name,oa.currency::text original_account_currency,
    ra.id reversal_audit_id,ra.original_transaction_id reversal_audit_original_id,ra.reversal_transaction_id reversal_audit_transaction_id,
    rat.id reversal_audit_target_id,rat.external_source::text reversal_audit_target_source,rat.external_id::text reversal_audit_target_external_id,
    rev.id reversal_transaction_id,rev.organization_id reversal_organization_id,rev.cash_account_id reversal_account_id,
    rev.direction::text reversal_direction,rev.amount reversal_amount,rev.created_at reversal_created_at,
    rp.id repost_audit_id,rp.reversal_id repost_audit_reversal_id,rp.transaction_id repost_audit_transaction_id,
    rpt.id repost_audit_target_id,rpt.external_source::text repost_audit_target_source,rpt.external_id::text repost_audit_target_external_id,
    repost.id repost_transaction_id,repost.organization_id repost_organization_id,repost.cash_account_id repost_account_id,
    repost.direction::text repost_direction,repost.amount repost_amount,repost.created_at repost_created_at,
    rpa.name::text repost_account_name,rpa.currency::text repost_account_currency
  from public.equipment_condition_claims c
  join public.partners p on p.id=c.partner_id
  join public.equipment_contracts ec on ec.id=c.contract_id
  join public.equipment_assets ea on ea.id=c.equipment_id
  left join public.cash_transactions ot
    on ot.external_source='EQUIPMENT_CONDITION_CLAIM' and ot.external_id=c.id::text
  left join public.cash_accounts oa on oa.id=ot.cash_account_id
  left join public.equipment_condition_claim_financial_reversals ra on ra.claim_id=c.id
  left join public.cash_transactions rat on rat.id=ra.reversal_transaction_id
  left join public.cash_transactions rev
    on rev.external_source='EQUIPMENT_CONDITION_CLAIM_REVERSAL' and ot.id is not null and rev.external_id=ot.id::text
  left join public.equipment_condition_claim_financial_reposts rp on rp.claim_id=c.id
  left join public.cash_transactions rpt on rpt.id=rp.transaction_id
  left join public.cash_transactions repost
    on repost.external_source='EQUIPMENT_CONDITION_CLAIM_REPOST' and repost.external_id=c.id::text
  left join public.cash_accounts rpa on rpa.id=repost.cash_account_id
  where c.status='SETTLED'
     or ot.id is not null
     or ra.id is not null
     or rev.id is not null
     or rp.id is not null
     or repost.id is not null
), checked as (
  select b.*,
    array_remove(array[
      case when b.claim_status<>'SETTLED' and (b.original_transaction_id is not null or b.reversal_audit_id is not null or b.reversal_transaction_id is not null or b.repost_audit_id is not null or b.repost_transaction_id is not null) then 'FINANCE_ON_NON_SETTLED' end,
      case when b.original_transaction_id is null and (b.reversal_audit_id is not null or b.reversal_transaction_id is not null or b.repost_audit_id is not null or b.repost_transaction_id is not null) then 'ORIGINAL_MISSING' end,
      case when b.original_transaction_id is not null and (b.settled_amount is null or b.settled_amount<=0) then 'SETTLED_AMOUNT_INVALID' end,
      case when b.original_transaction_id is not null and b.original_amount<>b.settled_amount then 'ORIGINAL_AMOUNT_MISMATCH' end,
      case when b.original_transaction_id is not null and b.original_organization_id is distinct from b.expected_organization_id then 'ORIGINAL_ORGANIZATION_MISMATCH' end,
      case when b.original_transaction_id is not null and upper(coalesce(b.original_account_currency,'RUB'))<>upper(coalesce(b.currency,'RUB')) then 'ORIGINAL_CURRENCY_MISMATCH' end,
      case when b.original_transaction_id is not null and b.expected_direction is not null and b.original_direction<>b.expected_direction then 'ORIGINAL_DIRECTION_MISMATCH' end,
      case when b.reversal_transaction_id is not null and b.reversal_audit_id is null then 'REVERSAL_AUDIT_MISSING' end,
      case when b.reversal_audit_id is not null and b.reversal_audit_target_id is null then 'REVERSAL_TRANSACTION_MISSING' end,
      case when b.reversal_audit_id is not null and b.reversal_transaction_id is null then 'REVERSAL_EXTERNAL_TRANSACTION_MISSING' end,
      case when b.reversal_audit_id is not null and b.original_transaction_id is not null and b.reversal_audit_original_id<>b.original_transaction_id then 'REVERSAL_ORIGINAL_LINK_MISMATCH' end,
      case when b.reversal_audit_target_id is not null and b.reversal_audit_target_source<>'EQUIPMENT_CONDITION_CLAIM_REVERSAL' then 'REVERSAL_SOURCE_INVALID' end,
      case when b.reversal_audit_target_id is not null and b.original_transaction_id is not null and b.reversal_audit_target_external_id<>b.original_transaction_id::text then 'REVERSAL_EXTERNAL_ID_MISMATCH' end,
      case when b.reversal_audit_id is not null and b.reversal_transaction_id is not null and b.reversal_audit_target_id<>b.reversal_transaction_id then 'REVERSAL_EXTERNAL_LINK_MISMATCH' end,
      case when b.reversal_transaction_id is not null and b.original_transaction_id is not null and b.reversal_amount<>b.original_amount then 'REVERSAL_AMOUNT_MISMATCH' end,
      case when b.reversal_transaction_id is not null and b.original_transaction_id is not null and b.reversal_direction=b.original_direction then 'REVERSAL_DIRECTION_MISMATCH' end,
      case when b.reversal_transaction_id is not null and b.original_transaction_id is not null and b.reversal_account_id<>b.original_account_id then 'REVERSAL_ACCOUNT_MISMATCH' end,
      case when b.reversal_transaction_id is not null and b.original_transaction_id is not null and b.reversal_organization_id<>b.original_organization_id then 'REVERSAL_ORGANIZATION_MISMATCH' end,
      case when b.repost_transaction_id is not null and b.repost_audit_id is null then 'REPOST_AUDIT_MISSING' end,
      case when b.repost_audit_id is not null and b.repost_audit_target_id is null then 'REPOST_TRANSACTION_MISSING' end,
      case when b.repost_audit_id is not null and b.repost_transaction_id is null then 'REPOST_EXTERNAL_TRANSACTION_MISSING' end,
      case when (b.repost_audit_id is not null or b.repost_transaction_id is not null) and b.reversal_audit_id is null then 'REPOST_WITHOUT_REVERSAL' end,
      case when b.repost_audit_id is not null and b.reversal_audit_id is not null and b.repost_audit_reversal_id<>b.reversal_audit_id then 'REPOST_REVERSAL_LINK_MISMATCH' end,
      case when b.repost_audit_target_id is not null and b.repost_audit_target_source<>'EQUIPMENT_CONDITION_CLAIM_REPOST' then 'REPOST_SOURCE_INVALID' end,
      case when b.repost_audit_target_id is not null and b.repost_audit_target_external_id<>b.claim_id::text then 'REPOST_EXTERNAL_ID_MISMATCH' end,
      case when b.repost_audit_id is not null and b.repost_transaction_id is not null and b.repost_audit_target_id<>b.repost_transaction_id then 'REPOST_EXTERNAL_LINK_MISMATCH' end,
      case when b.repost_transaction_id is not null and b.repost_amount<>b.settled_amount then 'REPOST_AMOUNT_MISMATCH' end,
      case when b.repost_transaction_id is not null and b.repost_organization_id is distinct from b.expected_organization_id then 'REPOST_ORGANIZATION_MISMATCH' end,
      case when b.repost_transaction_id is not null and upper(coalesce(b.repost_account_currency,'RUB'))<>upper(coalesce(b.currency,'RUB')) then 'REPOST_CURRENCY_MISMATCH' end,
      case when b.repost_transaction_id is not null and b.expected_direction is not null and b.repost_direction<>b.expected_direction then 'REPOST_DIRECTION_MISMATCH' end
    ]::text[],null) preliminary_issues,
    coalesce(case b.original_direction when 'INCOME' then b.original_amount when 'EXPENSE' then -b.original_amount else 0 end,0)
      + coalesce(case b.reversal_direction when 'INCOME' then b.reversal_amount when 'EXPENSE' then -b.reversal_amount else 0 end,0)
      + coalesce(case b.repost_direction when 'INCOME' then b.repost_amount when 'EXPENSE' then -b.repost_amount else 0 end,0) actual_net,
    case
      when b.repost_transaction_id is not null then coalesce(case b.repost_direction when 'INCOME' then b.repost_amount when 'EXPENSE' then -b.repost_amount else 0 end,0)
      when b.reversal_transaction_id is not null or b.reversal_audit_id is not null then 0::numeric
      when b.original_transaction_id is not null then coalesce(case b.original_direction when 'INCOME' then b.original_amount when 'EXPENSE' then -b.original_amount else 0 end,0)
      else 0::numeric
    end expected_net
  from base b
), final as (
  select c.*,
    case when abs(c.actual_net-c.expected_net)>0.005 then array_append(c.preliminary_issues,'NET_EFFECT_MISMATCH') else c.preliminary_issues end final_issues
  from checked c
)
select
  f.claim_id,f.partner_id,f.partner_name,f.contract_number,f.equipment_id,f.inventory_number,f.equipment_name,
  f.claim_status,f.claim_direction,f.settled_amount,f.currency,
  case when f.repost_audit_id is not null or f.repost_transaction_id is not null then 'REPOSTED'
       when f.reversal_audit_id is not null or f.reversal_transaction_id is not null then 'REVERSED'
       when f.original_transaction_id is not null then 'ACTIVE'
       else 'PENDING_POSTING' end::text chain_state,
  case when cardinality(f.final_issues)>0 then 'ERROR' else 'OK' end::text integrity_state,
  f.final_issues issue_codes,f.actual_net actual_net_effect,f.expected_net expected_net_effect,
  f.original_transaction_id,f.reversal_transaction_id,f.repost_transaction_id,
  f.original_amount,f.reversal_amount,f.repost_amount,f.original_direction,f.reversal_direction,f.repost_direction,
  f.original_account_name,f.repost_account_name,
  greatest(f.original_created_at,f.reversal_created_at,f.repost_created_at) last_activity_at
from final f;
$$;
revoke all on function public.equipment_condition_claim_financial_integrity_rows() from public,anon,authenticated;
