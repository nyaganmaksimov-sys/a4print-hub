-- A4PRINT HUB: Production Farm Phase 49 — persistent owner-payment integrity incidents.
-- Reconciles pre-existing live integrity baseline into repository migrations.

create table if not exists public.equipment_owner_payment_integrity_events(
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check(entity_type in ('OWNER_SETTLEMENT','LEASE_CHARGE')),
  entity_id uuid not null,
  contract_id uuid not null references public.equipment_contracts(id) on delete restrict,
  partner_id uuid not null references public.partners(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  issue_signature text not null,
  issue_codes text[] not null check(cardinality(issue_codes)>0),
  integrity_snapshot jsonb not null,
  status text not null default 'OPEN',
  detected_at timestamptz not null default clock_timestamp(),
  last_seen_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  occurrence_count integer not null default 1 check(occurrence_count>0),
  unique(entity_type,entity_id,issue_signature)
);

alter table public.equipment_owner_payment_integrity_events
  drop constraint if exists equipment_owner_payment_integrity_events_status_check;
alter table public.equipment_owner_payment_integrity_events
  add constraint equipment_owner_payment_integrity_events_status_check
  check(status in ('OPEN','ACKNOWLEDGED','RESOLVED'));

create index if not exists idx_equipment_owner_payment_integrity_events_org
  on public.equipment_owner_payment_integrity_events(organization_id,status,last_seen_at desc);
create index if not exists idx_equipment_owner_payment_integrity_events_entity
  on public.equipment_owner_payment_integrity_events(entity_type,entity_id,last_seen_at desc);

alter table public.equipment_owner_payment_integrity_events enable row level security;
revoke all on public.equipment_owner_payment_integrity_events
from public,anon,authenticated;

create table if not exists public.equipment_owner_payment_integrity_actions(
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.equipment_owner_payment_integrity_events(id) on delete restrict,
  action_type text not null check(action_type in ('ACKNOWLEDGED','RESOLVED','REOPENED')),
  note text not null check(length(btrim(note))>=3),
  reference text,
  acted_by uuid references public.users(id) on delete set null,
  acted_at timestamptz not null default clock_timestamp(),
  event_sequence bigint generated always as identity,
  check(action_type<>'RESOLVED' or length(btrim(coalesce(reference,'')))>=2)
);

create index if not exists idx_equipment_owner_payment_integrity_actions_event
  on public.equipment_owner_payment_integrity_actions(event_id,event_sequence desc);

alter table public.equipment_owner_payment_integrity_actions enable row level security;
revoke all on public.equipment_owner_payment_integrity_actions
from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.equipment_owner_payment_integrity_rows()
 RETURNS TABLE(entity_type text, entity_id uuid, contract_id uuid, contract_number text, partner_id uuid, partner_name text, organization_id uuid, entity_status text, amount numeric, currency text, entity_payment_reference text, audit_document_id uuid, audit_ready boolean, chain_state text, integrity_state text, issue_codes text[], issue_signature text, posting_count integer, active_posting_count integer, reversed_posting_count integer, active_posting_id uuid, active_transaction_id uuid, active_transaction_date date, active_payment_reference text, last_reversal_transaction_id uuid, last_activity_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
with real_entities as (
  select
    'OWNER_SETTLEMENT'::text entity_type,
    s.id entity_id,
    s.contract_id,
    c.contract_number::text,
    s.partner_id,
    coalesce(nullif(p.legal_name,''),nullif(p.name,''),'Владелец')::text partner_name,
    c.organization_id,
    s.status::text entity_status,
    s.owner_amount::numeric amount,
    s.currency::text currency,
    s.payment_reference::text entity_payment_reference,
    s.settlement_document_id audit_document_id,
    (s.settlement_snapshot is not null) audit_ready,
    s.paid_at,
    true entity_exists
  from public.equipment_owner_settlements s
  join public.equipment_contracts c on c.id=s.contract_id
  join public.partners p on p.id=s.partner_id

  union all

  select
    'LEASE_CHARGE'::text,
    l.id,
    l.contract_id,
    c.contract_number::text,
    l.partner_id,
    coalesce(nullif(p.legal_name,''),nullif(p.name,''),'Владелец')::text,
    c.organization_id,
    l.status::text,
    l.amount::numeric,
    l.currency::text,
    l.payment_reference::text,
    l.allocation_document_id,
    (l.charge_type<>'LEASE' or l.allocation_snapshot is not null),
    l.paid_at,
    true
  from public.equipment_lease_charges l
  join public.equipment_contracts c on c.id=l.contract_id
  join public.partners p on p.id=l.partner_id
),
orphan_entities as (
  select distinct on(p.entity_type,p.entity_id)
    p.entity_type,
    p.entity_id,
    p.contract_id,
    c.contract_number::text,
    p.partner_id,
    coalesce(nullif(pr.legal_name,''),nullif(pr.name,''),'Владелец')::text partner_name,
    p.organization_id,
    null::text entity_status,
    p.amount::numeric amount,
    p.currency::text currency,
    null::text entity_payment_reference,
    null::uuid audit_document_id,
    false audit_ready,
    null::timestamptz paid_at,
    false entity_exists
  from public.equipment_owner_payment_postings p
  left join public.equipment_contracts c on c.id=p.contract_id
  left join public.partners pr on pr.id=p.partner_id
  where not exists(
    select 1
    from real_entities e
    where e.entity_type=p.entity_type
      and e.entity_id=p.entity_id
  )
  order by p.entity_type,p.entity_id,p.posted_at desc,p.id
),
entities as (
  select * from real_entities
  union all
  select * from orphan_entities
),
posting_checked as (
  select
    e.entity_type,
    e.entity_id,
    p.id posting_id,
    p.posted_at,
    p.reversed_at,
    p.transaction_id,
    p.reversal_transaction_id,
    array_remove(array[
      case when e.entity_exists and p.contract_id is distinct from e.contract_id
        then 'POSTING_CONTRACT_MISMATCH' end,
      case when e.entity_exists and p.partner_id is distinct from e.partner_id
        then 'POSTING_PARTNER_MISMATCH' end,
      case when e.entity_exists and p.organization_id is distinct from e.organization_id
        then 'POSTING_ORGANIZATION_MISMATCH' end,
      case when e.entity_exists and abs(p.amount-e.amount)>0.005
        then 'POSTING_AMOUNT_MISMATCH' end,
      case when e.entity_exists and upper(coalesce(p.currency,'RUB'))<>upper(coalesce(e.currency,'RUB'))
        then 'POSTING_CURRENCY_MISMATCH' end,
      case when pa.id is null or pa.organization_id is distinct from p.organization_id
        then 'POSTING_ACCOUNT_ORGANIZATION_MISMATCH' end,
      case when tx.id is null then 'ORIGINAL_TRANSACTION_MISSING' end,
      case when tx.id is not null and tx.organization_id is distinct from p.organization_id
        then 'ORIGINAL_ORGANIZATION_MISMATCH' end,
      case when tx.id is not null and tx.cash_account_id is distinct from p.cash_account_id
        then 'ORIGINAL_ACCOUNT_MISMATCH' end,
      case when tx.id is not null and tx.direction<>'EXPENSE'
        then 'ORIGINAL_DIRECTION_MISMATCH' end,
      case when tx.id is not null and abs(tx.amount-p.amount)>0.005
        then 'ORIGINAL_AMOUNT_MISMATCH' end,
      case when tx.id is not null and tx.external_source is distinct from 'EQUIPMENT_OWNER_PAYMENT'
        then 'ORIGINAL_SOURCE_INVALID' end,
      case when tx.id is not null and tx.external_id is distinct from p.id::text
        then 'ORIGINAL_EXTERNAL_ID_MISMATCH' end,
      case when e.audit_document_id is not null and tx.id is not null and not exists(
        select 1 from public.document_links dl
        where dl.document_id=e.audit_document_id
          and dl.entity_type='CASH_TRANSACTION'
          and dl.entity_id=tx.id
          and dl.relationship='PAYMENT_POSTING'
      ) then 'ORIGINAL_DOCUMENT_LINK_MISSING' end,
      case when p.reversed_at is null and (
        p.reversal_transaction_id is not null
        or p.reversal_reason is not null
        or p.reversal_reference is not null
        or p.reversed_by is not null
      ) then 'REVERSAL_STATE_PARTIAL' end,
      case when p.reversed_at is not null and rtx.id is null
        then 'REVERSAL_TRANSACTION_MISSING' end,
      case when p.reversed_at is not null and rtx.id is not null
        and rtx.organization_id is distinct from p.organization_id
        then 'REVERSAL_ORGANIZATION_MISMATCH' end,
      case when p.reversed_at is not null and rtx.id is not null
        and rtx.cash_account_id is distinct from p.cash_account_id
        then 'REVERSAL_ACCOUNT_MISMATCH' end,
      case when p.reversed_at is not null and rtx.id is not null
        and rtx.direction<>'INCOME'
        then 'REVERSAL_DIRECTION_MISMATCH' end,
      case when p.reversed_at is not null and rtx.id is not null
        and abs(rtx.amount-p.amount)>0.005
        then 'REVERSAL_AMOUNT_MISMATCH' end,
      case when p.reversed_at is not null and rtx.id is not null
        and rtx.external_source is distinct from 'EQUIPMENT_OWNER_PAYMENT_REVERSAL'
        then 'REVERSAL_SOURCE_INVALID' end,
      case when p.reversed_at is not null and rtx.id is not null
        and rtx.external_id is distinct from p.id::text
        then 'REVERSAL_EXTERNAL_ID_MISMATCH' end,
      case when p.reversed_at is not null and e.audit_document_id is not null
        and rtx.id is not null and not exists(
          select 1 from public.document_links dl
          where dl.document_id=e.audit_document_id
            and dl.entity_type='CASH_TRANSACTION'
            and dl.entity_id=rtx.id
            and dl.relationship='PAYMENT_REVERSAL'
        ) then 'REVERSAL_DOCUMENT_LINK_MISSING' end
    ]::text[],null) issue_codes,
    concat_ws(':',
      p.id::text,
      coalesce(p.transaction_id::text,''),
      coalesce(p.reversal_transaction_id::text,''),
      coalesce(p.amount::text,''),
      coalesce(p.currency,''),
      coalesce(p.payment_reference,''),
      coalesce(p.reversed_at::text,''),
      coalesce(tx.organization_id::text,''),
      coalesce(tx.cash_account_id::text,''),
      coalesce(tx.direction,''),
      coalesce(tx.amount::text,''),
      coalesce(tx.external_source,''),
      coalesce(tx.external_id,''),
      coalesce(rtx.organization_id::text,''),
      coalesce(rtx.cash_account_id::text,''),
      coalesce(rtx.direction,''),
      coalesce(rtx.amount::text,''),
      coalesce(rtx.external_source,''),
      coalesce(rtx.external_id,'')
    ) fingerprint_part
  from entities e
  join public.equipment_owner_payment_postings p
    on p.entity_type=e.entity_type
   and p.entity_id=e.entity_id
  left join public.cash_accounts pa on pa.id=p.cash_account_id
  left join public.cash_transactions tx on tx.id=p.transaction_id
  left join public.cash_transactions rtx on rtx.id=p.reversal_transaction_id
),
posting_stats as (
  select
    pc.entity_type,
    pc.entity_id,
    count(*)::integer posting_count,
    count(*) filter(where pc.reversed_at is null)::integer active_posting_count,
    count(*) filter(where pc.reversed_at is not null)::integer reversed_posting_count,
    md5(string_agg(pc.fingerprint_part,'|' order by pc.posted_at,pc.posting_id)) chain_fingerprint
  from posting_checked pc
  group by pc.entity_type,pc.entity_id
),
posting_issue_agg as (
  select
    pc.entity_type,
    pc.entity_id,
    array_agg(distinct u.code order by u.code) issue_codes
  from posting_checked pc
  cross join lateral unnest(pc.issue_codes) u(code)
  group by pc.entity_type,pc.entity_id
),
candidate as (
  select
    e.*,
    coalesce(ps.posting_count,0) posting_count,
    coalesce(ps.active_posting_count,0) active_posting_count,
    coalesce(ps.reversed_posting_count,0) reversed_posting_count,
    coalesce(ps.chain_fingerprint,md5('')) chain_fingerprint,
    coalesce(pi.issue_codes,'{}'::text[]) posting_issue_codes,
    ap.id active_posting_id,
    ap.transaction_id active_transaction_id,
    ap.transaction_date active_transaction_date,
    ap.payment_reference active_payment_reference,
    ap.posted_at active_posted_at,
    lr.reversal_transaction_id last_reversal_transaction_id,
    lr.reversed_at last_reversed_at
  from entities e
  left join posting_stats ps
    on ps.entity_type=e.entity_type and ps.entity_id=e.entity_id
  left join posting_issue_agg pi
    on pi.entity_type=e.entity_type and pi.entity_id=e.entity_id
  left join lateral(
    select
      p.id,p.transaction_id,p.payment_reference,p.posted_at,tx.transaction_date
    from public.equipment_owner_payment_postings p
    left join public.cash_transactions tx on tx.id=p.transaction_id
    where p.entity_type=e.entity_type
      and p.entity_id=e.entity_id
      and p.reversed_at is null
    order by p.posted_at desc,p.id desc
    limit 1
  ) ap on true
  left join lateral(
    select p.reversal_transaction_id,p.reversed_at
    from public.equipment_owner_payment_postings p
    where p.entity_type=e.entity_type
      and p.entity_id=e.entity_id
      and p.reversed_at is not null
    order by p.reversed_at desc,p.id desc
    limit 1
  ) lr on true
  where e.entity_status in('APPROVED','PAID')
     or coalesce(ps.posting_count,0)>0
     or not e.entity_exists
),
checked as (
  select
    c.*,
    array_cat(
      array_remove(array[
        case when not c.entity_exists then 'LEDGER_ENTITY_NOT_FOUND' end,
        case when c.entity_status='PAID' and c.active_posting_count<>1
          then 'PAID_WITHOUT_ACTIVE_POSTING' end,
        case when coalesce(c.entity_status,'')<>'PAID' and c.active_posting_count>0
          then 'ACTIVE_POSTING_ON_NON_PAID' end,
        case when c.active_posting_count>1
          then 'MULTIPLE_ACTIVE_POSTINGS' end,
        case when c.posting_count>0 and coalesce(c.entity_status,'') not in('APPROVED','PAID')
          then 'PAYMENT_HISTORY_ON_INVALID_STATUS' end,
        case when (c.entity_status='PAID' or c.posting_count>0) and not c.audit_ready
          then 'AUDIT_SNAPSHOT_MISSING' end,
        case when c.entity_status='PAID' and c.paid_at is null
          then 'PAID_AT_MISSING' end,
        case when c.entity_status='PAID'
          and c.active_posting_id is not null
          and c.entity_payment_reference is distinct from c.active_payment_reference
          then 'PAYMENT_REFERENCE_MISMATCH' end
      ]::text[],null),
      c.posting_issue_codes
    ) raw_issues
  from candidate c
),
final as (
  select
    c.*,
    coalesce((
      select array_agg(distinct x.code order by x.code)
      from unnest(c.raw_issues) x(code)
    ),'{}'::text[]) final_issues
  from checked c
)
select
  f.entity_type,
  f.entity_id,
  f.contract_id,
  f.contract_number,
  f.partner_id,
  f.partner_name,
  f.organization_id,
  f.entity_status,
  f.amount,
  f.currency,
  f.entity_payment_reference,
  f.audit_document_id,
  f.audit_ready,
  case
    when f.entity_status='PAID' and f.active_posting_count=1 then 'PAID'
    when f.active_posting_count>0 then 'ACTIVE_MISMATCH'
    when f.reversed_posting_count>0 then 'REVERSED'
    when f.entity_status='APPROVED' then 'PENDING_PAYMENT'
    else 'NO_PAYMENT'
  end::text chain_state,
  case when cardinality(f.final_issues)>0 then 'ERROR' else 'OK' end::text integrity_state,
  f.final_issues issue_codes,
  case when cardinality(f.final_issues)>0 then
    md5(concat_ws('|',
      f.entity_type,
      f.entity_id::text,
      coalesce(f.entity_status,''),
      coalesce(f.amount::text,''),
      coalesce(f.currency,''),
      coalesce(f.entity_payment_reference,''),
      f.audit_ready::text,
      f.chain_fingerprint,
      array_to_string(f.final_issues,',')
    ))
  else null end issue_signature,
  f.posting_count,
  f.active_posting_count,
  f.reversed_posting_count,
  f.active_posting_id,
  f.active_transaction_id,
  f.active_transaction_date,
  f.active_payment_reference,
  f.last_reversal_transaction_id,
  coalesce(
    greatest(f.active_posted_at,f.last_reversed_at),
    f.active_posted_at,
    f.last_reversed_at
  ) last_activity_at
from final f
$function$
;

revoke all on function private.equipment_owner_payment_integrity_rows()
from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.guard_equipment_owner_payment_integrity_action_append_only()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  raise exception 'OWNER_PAYMENT_INTEGRITY_ACTION_APPEND_ONLY';
end
$function$
;

revoke all on function private.guard_equipment_owner_payment_integrity_action_append_only()
from public,anon,authenticated;

drop trigger if exists trg_equipment_owner_payment_integrity_action_append_only
on public.equipment_owner_payment_integrity_actions;
create trigger trg_equipment_owner_payment_integrity_action_append_only
before update or delete on public.equipment_owner_payment_integrity_actions
for each row execute function private.guard_equipment_owner_payment_integrity_action_append_only();

CREATE OR REPLACE FUNCTION public.get_equipment_owner_payment_integrity(p_only_issues boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid;
  v_rows jsonb;
  v_summary jsonb;
begin
  perform private.assert_no_partner_context();

  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not(
    public.has_permission('equipment.view')
    or public.has_permission('equipment.contracts.manage')
    or public.has_permission('production.settlements.view')
    or public.has_permission('production.settlements.manage')
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  v_org:=public.current_user_organization_id();
  if v_org is null then raise exception 'ORGANIZATION_CONTEXT_REQUIRED'; end if;

  select coalesce(
    jsonb_agg(
      to_jsonb(x)
      order by (x.integrity_state='ERROR') desc,
               x.last_activity_at desc nulls last,
               x.contract_number,
               x.entity_type
    ),
    '[]'::jsonb
  )
  into v_rows
  from private.equipment_owner_payment_integrity_rows() x
  where x.organization_id=v_org
    and (not coalesce(p_only_issues,true) or x.integrity_state='ERROR');

  select jsonb_build_object(
    'total',count(*),
    'ok',count(*) filter(where x.integrity_state='OK'),
    'errors',count(*) filter(where x.integrity_state='ERROR'),
    'pending_payment',count(*) filter(where x.chain_state='PENDING_PAYMENT'),
    'paid',count(*) filter(where x.chain_state='PAID'),
    'reversed',count(*) filter(where x.chain_state='REVERSED'),
    'active_mismatch',count(*) filter(where x.chain_state='ACTIVE_MISMATCH')
  )
  into v_summary
  from private.equipment_owner_payment_integrity_rows() x
  where x.organization_id=v_org;

  return jsonb_build_object('summary',v_summary,'rows',v_rows);
end
$function$
;

revoke all on function public.get_equipment_owner_payment_integrity(boolean)
from public,anon,authenticated;
grant execute on function public.get_equipment_owner_payment_integrity(boolean)
to authenticated;

CREATE OR REPLACE FUNCTION public.rescan_equipment_owner_payment_integrity()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  v_event public.equipment_owner_payment_integrity_events%rowtype;
  v_actor uuid;
  v_is_interactive boolean:=auth.uid() is not null;
  v_new integer:=0;
  v_reopened integer:=0;
  v_updated integer:=0;
  v_resolved integer:=0;
  v_notifications integer:=0;
  v_title text;
  v_body text;
begin
  if v_is_interactive then
    perform private.assert_non_partner_staff_context();
    if not(
      public.has_permission('equipment.contracts.manage')
      or public.has_permission('production.settlements.manage')
    ) then raise exception 'PERMISSION_DENIED'; end if;
    v_actor:=public.current_staff_user_id();
    if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;
  end if;

  for r in
    select *
    from private.equipment_owner_payment_integrity_rows()
    where integrity_state='ERROR'
  loop
    v_event:=null;

    select * into v_event
    from public.equipment_owner_payment_integrity_events e
    where e.entity_type=r.entity_type
      and e.entity_id=r.entity_id
      and e.issue_signature=r.issue_signature
    for update;

    if v_event.id is null then
      insert into public.equipment_owner_payment_integrity_events(
        entity_type,entity_id,contract_id,partner_id,organization_id,
        issue_signature,issue_codes,integrity_snapshot,status,
        detected_at,last_seen_at,occurrence_count
      ) values(
        r.entity_type,r.entity_id,r.contract_id,r.partner_id,r.organization_id,
        r.issue_signature,r.issue_codes,to_jsonb(r),'OPEN',
        clock_timestamp(),clock_timestamp(),1
      )
      returning * into v_event;

      v_new:=v_new+1;
      v_title:='Нарушение цепочки выплаты владельцу';

    elsif v_event.status='RESOLVED' then
      update public.equipment_owner_payment_integrity_events
      set status='OPEN',
          issue_codes=r.issue_codes,
          integrity_snapshot=to_jsonb(r),
          last_seen_at=clock_timestamp(),
          resolved_at=null,
          occurrence_count=occurrence_count+1
      where id=v_event.id
      returning * into v_event;

      insert into public.equipment_owner_payment_integrity_actions(
        event_id,action_type,note,reference,acted_by
      ) values(
        v_event.id,'REOPENED',
        'Нарушение повторно обнаружено автоматической сверкой.',
        null,v_actor
      );

      v_reopened:=v_reopened+1;
      v_title:='Повторное нарушение цепочки выплаты владельцу';

    else
      update public.equipment_owner_payment_integrity_events
      set issue_codes=r.issue_codes,
          integrity_snapshot=to_jsonb(r),
          last_seen_at=clock_timestamp(),
          occurrence_count=occurrence_count+1
      where id=v_event.id
      returning * into v_event;

      v_updated:=v_updated+1;
      continue;
    end if;

    v_body:=coalesce(r.partner_name,'—')||
      ' · договор '||coalesce(r.contract_number,'—')||
      ' · '||case r.entity_type
        when 'OWNER_SETTLEMENT' then 'доля владельца'
        else 'аренда/выкуп'
      end||
      ' · '||array_to_string(r.issue_codes,', ');

    insert into public.notifications(
      user_id,title,body,type,entity_type,entity_id
    )
    select distinct
      u.id,v_title,v_body,'WARNING',
      'EQUIPMENT_OWNER_PAYMENT_INTEGRITY',v_event.id
    from public.users u
    join public.organization_units ou
      on ou.id=u.organization_unit_id
     and ou.is_active=true
     and ou.organization_id=r.organization_id
    join public.user_roles ur on ur.user_id=u.id
    join public.roles ro on ro.id=ur.role_id
    left join public.role_permissions rp on rp.role_id=ro.id
    left join public.permissions pp on pp.id=rp.permission_id
    where u.is_active=true
      and (
        ro.name='ADMIN'
        or pp.code in(
          'production.settlements.manage',
          'equipment.contracts.manage'
        )
      );

    v_notifications:=v_notifications+1;
  end loop;

  for v_event in
    select e.*
    from public.equipment_owner_payment_integrity_events e
    where e.status in ('OPEN','ACKNOWLEDGED')
      and not exists(
        select 1
        from private.equipment_owner_payment_integrity_rows() current_row
        where current_row.entity_type=e.entity_type
          and current_row.entity_id=e.entity_id
          and current_row.integrity_state='ERROR'
          and current_row.issue_signature=e.issue_signature
      )
    for update
  loop
    update public.equipment_owner_payment_integrity_events
    set status='RESOLVED',
        resolved_at=clock_timestamp(),
        last_seen_at=clock_timestamp()
    where id=v_event.id;

    insert into public.equipment_owner_payment_integrity_actions(
      event_id,action_type,note,reference,acted_by
    ) values(
      v_event.id,'RESOLVED',
      'Автоматически закрыто после успешной повторной сверки.',
      'AUTO_RECONCILIATION_OK',v_actor
    );

    v_resolved:=v_resolved+1;
  end loop;

  return jsonb_build_object(
    'new',v_new,
    'reopened',v_reopened,
    'updated',v_updated,
    'auto_resolved',v_resolved,
    'notifications',v_notifications,
    'scanned_at',clock_timestamp()
  );
end
$function$
;

revoke all on function public.rescan_equipment_owner_payment_integrity()
from public,anon,authenticated;
grant execute on function public.rescan_equipment_owner_payment_integrity()
to authenticated;

CREATE OR REPLACE FUNCTION public.emit_equipment_owner_payment_integrity_notifications()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  v_result:=public.rescan_equipment_owner_payment_integrity();
  return coalesce((v_result->>'notifications')::integer,0);
end
$function$
;

revoke all on function public.emit_equipment_owner_payment_integrity_notifications()
from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.list_equipment_owner_payment_integrity_incidents(p_include_resolved boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid:=public.current_user_organization_id();
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_non_partner_staff_context();

  if v_org is null then raise exception 'ORGANIZATION_CONTEXT_REQUIRED'; end if;
  if not(
    public.has_permission('equipment.view')
    or public.has_permission('equipment.contracts.manage')
    or public.has_permission('production.settlements.view')
    or public.has_permission('production.settlements.manage')
  ) then raise exception 'PERMISSION_DENIED'; end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by
    case x.status when 'OPEN' then 0 when 'ACKNOWLEDGED' then 1 else 2 end,
    x.last_seen_at desc
  ),'[]'::jsonb)
  into v_result
  from (
    select
      e.id event_id,
      e.entity_type,
      e.entity_id,
      e.contract_id,
      e.partner_id,
      e.organization_id,
      c.contract_number,
      coalesce(nullif(p.legal_name,''),nullif(p.name,''),'Владелец') partner_name,
      e.issue_signature,
      e.issue_codes,
      e.status,
      e.detected_at first_seen_at,
      e.last_seen_at,
      e.resolved_at,
      e.occurrence_count,
      e.integrity_snapshot,
      a.action_type latest_action,
      a.note latest_note,
      a.reference latest_reference,
      a.acted_at latest_action_at,
      u.full_name latest_action_by,
      coalesce(cr.integrity_state,'OK') current_integrity_state,
      coalesce(cr.issue_codes,'{}'::text[]) current_issue_codes,
      coalesce(cr.issue_signature=e.issue_signature,false) current_signature_matches
    from public.equipment_owner_payment_integrity_events e
    join public.equipment_contracts c on c.id=e.contract_id
    join public.partners p on p.id=e.partner_id
    left join private.equipment_owner_payment_integrity_rows() cr
      on cr.entity_type=e.entity_type
     and cr.entity_id=e.entity_id
    left join lateral(
      select ia.action_type,ia.note,ia.reference,ia.acted_at,ia.acted_by
      from public.equipment_owner_payment_integrity_actions ia
      where ia.event_id=e.id
      order by ia.event_sequence desc
      limit 1
    ) a on true
    left join public.users u on u.id=a.acted_by
    where e.organization_id=v_org
      and (
        coalesce(p_include_resolved,false)
        or e.status<>'RESOLVED'
      )
  ) x;

  return v_result;
end
$function$
;

revoke all on function public.list_equipment_owner_payment_integrity_incidents(boolean)
from public,anon,authenticated;
grant execute on function public.list_equipment_owner_payment_integrity_incidents(boolean)
to authenticated;

CREATE OR REPLACE FUNCTION public.set_equipment_owner_payment_integrity_incident_state(p_event_id uuid, p_state text, p_note text, p_reference text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid:=public.current_user_organization_id();
  v_event public.equipment_owner_payment_integrity_events%rowtype;
  v_actor uuid;
  v_action_id uuid;
  v_current record;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_non_partner_staff_context();

  if v_org is null then raise exception 'ORGANIZATION_CONTEXT_REQUIRED'; end if;
  if not(
    public.has_permission('equipment.contracts.manage')
    or public.has_permission('production.settlements.manage')
  ) then raise exception 'PERMISSION_DENIED'; end if;

  if p_event_id is null then raise exception 'INTEGRITY_EVENT_REQUIRED'; end if;
  if p_state not in ('ACKNOWLEDGED','RESOLVED') then
    raise exception 'INTEGRITY_INCIDENT_STATE_INVALID';
  end if;
  if nullif(btrim(coalesce(p_note,'')),'') is null
     or length(btrim(p_note))<3 then
    raise exception 'INTEGRITY_INCIDENT_NOTE_REQUIRED';
  end if;
  if p_state='RESOLVED'
     and (
       nullif(btrim(coalesce(p_reference,'')),'') is null
       or length(btrim(p_reference))<2
     )
  then raise exception 'INTEGRITY_RESOLUTION_REFERENCE_REQUIRED'; end if;

  select * into v_event
  from public.equipment_owner_payment_integrity_events
  where id=p_event_id
  for update;

  if v_event.id is null
     or v_event.organization_id is distinct from v_org then
    raise exception 'INTEGRITY_EVENT_NOT_AVAILABLE';
  end if;

  if v_event.status=p_state then
    raise exception 'INTEGRITY_INCIDENT_STATE_ALREADY_CURRENT';
  end if;

  if p_state='RESOLVED' then
    select * into v_current
    from private.equipment_owner_payment_integrity_rows() r
    where r.entity_type=v_event.entity_type
      and r.entity_id=v_event.entity_id;

    if found
       and v_current.integrity_state='ERROR'
       and v_current.issue_signature=v_event.issue_signature then
      raise exception 'INTEGRITY_ISSUE_STILL_ACTIVE';
    end if;
  end if;

  v_actor:=public.current_staff_user_id();
  if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;

  update public.equipment_owner_payment_integrity_events
  set status=p_state,
      resolved_at=case when p_state='RESOLVED' then clock_timestamp() else null end
  where id=v_event.id;

  insert into public.equipment_owner_payment_integrity_actions(
    event_id,action_type,note,reference,acted_by
  ) values(
    v_event.id,p_state,btrim(p_note),
    nullif(btrim(coalesce(p_reference,'')),''),v_actor
  )
  returning id into v_action_id;

  return v_action_id;
end
$function$
;

revoke all on function public.set_equipment_owner_payment_integrity_incident_state(uuid,text,text,text)
from public,anon,authenticated;
grant execute on function public.set_equipment_owner_payment_integrity_incident_state(uuid,text,text,text)
to authenticated;

do $$
declare
  v_job bigint;
begin
  select jobid into v_job
  from cron.job
  where jobname='equipment-owner-payment-integrity-daily'
  order by jobid
  limit 1;

  if v_job is not null then
    perform cron.unschedule(v_job);
  end if;

  perform cron.schedule(
    'equipment-owner-payment-integrity-daily',
    '45 6 * * *',
    'select public.emit_equipment_owner_payment_integrity_notifications();'
  );
end
$$;

select private.assert_production_farm_security_baseline();
