-- A4PRINT HUB: Production Farm Phase 47 — immutable owner payment ledger and partner audit.
-- Reconciles live owner-payment ledger objects into repository migrations.

create table if not exists public.equipment_owner_payment_postings(
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check(entity_type in ('OWNER_SETTLEMENT','LEASE_CHARGE')),
  entity_id uuid not null,
  contract_id uuid not null references public.equipment_contracts(id) on delete restrict,
  partner_id uuid not null references public.partners(id) on delete restrict,
  organization_id uuid not null references public.organizations(id) on delete restrict,
  amount numeric not null check(amount>0),
  currency text not null default 'RUB',
  cash_account_id uuid not null references public.cash_accounts(id) on delete restrict,
  transaction_id uuid not null unique references public.cash_transactions(id) on delete restrict,
  payment_reference text not null,
  note text,
  posted_by uuid references public.users(id) on delete set null,
  posted_at timestamptz not null default clock_timestamp(),
  reversal_transaction_id uuid unique references public.cash_transactions(id) on delete restrict,
  reversal_reason text,
  reversal_reference text,
  reversed_by uuid references public.users(id) on delete set null,
  reversed_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  check(
    (
      reversed_at is null
      and reversal_transaction_id is null
      and reversal_reason is null
      and reversal_reference is null
      and reversed_by is null
    )
    or
    (
      reversed_at is not null
      and reversal_transaction_id is not null
      and reversal_reason is not null
      and reversal_reference is not null
    )
  )
);

create index if not exists idx_equipment_owner_payment_entity
  on public.equipment_owner_payment_postings(entity_type,entity_id,posted_at desc);
create index if not exists idx_equipment_owner_payment_org
  on public.equipment_owner_payment_postings(organization_id,posted_at desc);
create unique index if not exists uq_equipment_owner_payment_active
  on public.equipment_owner_payment_postings(entity_type,entity_id)
  where reversed_at is null;

alter table public.equipment_owner_payment_postings enable row level security;
revoke all on table public.equipment_owner_payment_postings from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.equipment_owner_payment_context(p_entity_type text, p_entity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_type text:=upper(btrim(coalesce(p_entity_type,'')));
  v_contract_id uuid;
  v_partner_id uuid;
  v_org_id uuid;
  v_amount numeric;
  v_currency text;
  v_status text;
  v_document_id uuid;
  v_contract_number text;
  v_partner_name text;
  v_charge_type text;
  v_audit_ready boolean:=false;
begin
  if v_type not in('OWNER_SETTLEMENT','LEASE_CHARGE') then
    raise exception 'PAYMENT_ENTITY_TYPE_INVALID';
  end if;
  if p_entity_id is null then raise exception 'PAYMENT_ENTITY_REQUIRED'; end if;

  if v_type='OWNER_SETTLEMENT' then
    select
      s.contract_id,s.partner_id,s.owner_amount,s.currency,s.status,
      s.settlement_document_id,(s.settlement_snapshot is not null)
    into
      v_contract_id,v_partner_id,v_amount,v_currency,v_status,
      v_document_id,v_audit_ready
    from public.equipment_owner_settlements s
    where s.id=p_entity_id;
  else
    select
      c.contract_id,c.partner_id,c.amount,c.currency,c.status,
      c.allocation_document_id,
      (c.charge_type<>'LEASE' or c.allocation_snapshot is not null),
      c.charge_type
    into
      v_contract_id,v_partner_id,v_amount,v_currency,v_status,
      v_document_id,v_audit_ready,v_charge_type
    from public.equipment_lease_charges c
    where c.id=p_entity_id;
  end if;

  if v_contract_id is null then raise exception 'PAYMENT_ENTITY_NOT_FOUND'; end if;

  select c.organization_id,c.contract_number
    into v_org_id,v_contract_number
  from public.equipment_contracts c
  where c.id=v_contract_id;

  if v_org_id is null then raise exception 'PAYMENT_ENTITY_ORGANIZATION_REQUIRED'; end if;

  select coalesce(nullif(p.legal_name,''),nullif(p.name,''),'Владелец')
    into v_partner_name
  from public.partners p
  where p.id=v_partner_id;

  return jsonb_build_object(
    'entity_type',v_type,
    'entity_id',p_entity_id,
    'contract_id',v_contract_id,
    'contract_number',v_contract_number,
    'partner_id',v_partner_id,
    'partner_name',v_partner_name,
    'organization_id',v_org_id,
    'amount',coalesce(v_amount,0),
    'currency',coalesce(v_currency,'RUB'),
    'status',v_status,
    'document_id',v_document_id,
    'audit_ready',coalesce(v_audit_ready,false),
    'charge_type',v_charge_type
  );
end
$function$;
revoke all on function private.equipment_owner_payment_context(text,uuid)
  from public,anon,authenticated;

CREATE OR REPLACE FUNCTION private.guard_equipment_owner_payment_paid_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_internal text:=coalesce(current_setting('app.equipment_owner_payment_ledger_write',true),'');
  v_amount numeric;
begin
  if new.status='PAID' and old.status is distinct from 'PAID' then
    if tg_table_name='equipment_owner_settlements' then
      v_amount:=coalesce(new.owner_amount,0);
    elsif tg_table_name='equipment_lease_charges' then
      v_amount:=coalesce(new.amount,0);
    else
      raise exception 'PAYMENT_LEDGER_GUARD_TABLE_INVALID';
    end if;

    if v_amount>0 and v_internal<>'1' then
      raise exception 'PAYMENT_LEDGER_POSTING_REQUIRED';
    end if;
  end if;

  return new;
end
$function$;
revoke all on function private.guard_equipment_owner_payment_paid_status()
  from public,anon,authenticated;

drop trigger if exists trg_equipment_owner_settlement_paid_ledger
  on public.equipment_owner_settlements;
create trigger trg_equipment_owner_settlement_paid_ledger
before update of status on public.equipment_owner_settlements
for each row execute function private.guard_equipment_owner_payment_paid_status();

drop trigger if exists trg_equipment_lease_charge_paid_ledger
  on public.equipment_lease_charges;
create trigger trg_equipment_lease_charge_paid_ledger
before update of status on public.equipment_lease_charges
for each row execute function private.guard_equipment_owner_payment_paid_status();

CREATE OR REPLACE FUNCTION private.guard_equipment_owner_payment_posting_ledger()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_internal text:=coalesce(current_setting('app.equipment_owner_payment_ledger_write',true),'');
begin
  if tg_op='INSERT' then
    if v_internal<>'1' then
      raise exception 'OWNER_PAYMENT_LEDGER_CONTROLLED_WRITE_REQUIRED';
    end if;
    return new;
  end if;

  if tg_op='DELETE' then
    raise exception 'OWNER_PAYMENT_LEDGER_APPEND_ONLY';
  end if;

  if v_internal<>'1' then
    raise exception 'OWNER_PAYMENT_LEDGER_CONTROLLED_WRITE_REQUIRED';
  end if;

  if old.id is distinct from new.id
     or old.entity_type is distinct from new.entity_type
     or old.entity_id is distinct from new.entity_id
     or old.contract_id is distinct from new.contract_id
     or old.partner_id is distinct from new.partner_id
     or old.organization_id is distinct from new.organization_id
     or old.amount is distinct from new.amount
     or old.currency is distinct from new.currency
     or old.cash_account_id is distinct from new.cash_account_id
     or old.transaction_id is distinct from new.transaction_id
     or old.payment_reference is distinct from new.payment_reference
     or old.note is distinct from new.note
     or old.posted_by is distinct from new.posted_by
     or old.posted_at is distinct from new.posted_at
     or old.created_at is distinct from new.created_at
  then
    raise exception 'OWNER_PAYMENT_LEDGER_CORE_IMMUTABLE';
  end if;

  if old.reversed_at is not null then
    if old.reversal_transaction_id is distinct from new.reversal_transaction_id
       or old.reversal_reason is distinct from new.reversal_reason
       or old.reversal_reference is distinct from new.reversal_reference
       or old.reversed_by is distinct from new.reversed_by
       or old.reversed_at is distinct from new.reversed_at
    then
      raise exception 'OWNER_PAYMENT_LEDGER_REVERSAL_IMMUTABLE';
    end if;
    return new;
  end if;

  if new.reversed_at is null
     or new.reversal_transaction_id is null
     or nullif(btrim(coalesce(new.reversal_reason,'')),'') is null
     or nullif(btrim(coalesce(new.reversal_reference,'')),'') is null
     or new.reversed_by is null
  then
    raise exception 'OWNER_PAYMENT_LEDGER_REVERSAL_FIELDS_REQUIRED';
  end if;

  return new;
end
$function$;
revoke all on function private.guard_equipment_owner_payment_posting_ledger()
  from public,anon,authenticated;

drop trigger if exists trg_equipment_owner_payment_postings_immutable
  on public.equipment_owner_payment_postings;
create trigger trg_equipment_owner_payment_postings_immutable
before insert or update or delete on public.equipment_owner_payment_postings
for each row execute function private.guard_equipment_owner_payment_posting_ledger();

CREATE OR REPLACE FUNCTION public.get_equipment_owner_payment_financial_options(p_entity_type text, p_entity_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_type text:=upper(btrim(coalesce(p_entity_type,'')));
  v_ctx jsonb;
  v_org uuid;
  v_currency text;
  v_accounts jsonb;
  v_history jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.current_partner_id() is not null then
    raise exception 'PARTNER_PAYMENT_LEDGER_NOT_AVAILABLE';
  end if;
  if not public.has_permission('equipment.contracts.manage')
     or not public.has_permission('production.settlements.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_type='LEASE_CHARGE'
     and not public.has_permission('production.buyout.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;

  perform private.assert_equipment_contract_child_tenant(v_type,p_entity_id);
  v_ctx:=private.equipment_owner_payment_context(v_type,p_entity_id);
  v_org:=(v_ctx->>'organization_id')::uuid;
  v_currency:=v_ctx->>'currency';

  if v_org is distinct from public.current_user_organization_id() then
    raise exception 'PAYMENT_ENTITY_NOT_AVAILABLE';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,
    'name',a.name,
    'account_type',a.account_type,
    'currency',a.currency
  ) order by a.name),'[]'::jsonb)
  into v_accounts
  from public.cash_accounts a
  where a.organization_id=v_org
    and a.is_active=true
    and upper(coalesce(a.currency,'RUB'))=upper(coalesce(v_currency,'RUB'));

  select coalesce(jsonb_agg(jsonb_build_object(
    'posting_id',p.id,
    'amount',p.amount,
    'currency',p.currency,
    'cash_account_id',p.cash_account_id,
    'cash_account_name',a.name,
    'transaction_id',p.transaction_id,
    'transaction_date',t.transaction_date,
    'payment_reference',p.payment_reference,
    'note',p.note,
    'posted_at',p.posted_at,
    'reversal_transaction_id',p.reversal_transaction_id,
    'reversal_reason',p.reversal_reason,
    'reversal_reference',p.reversal_reference,
    'reversed_at',p.reversed_at
  ) order by p.posted_at desc),'[]'::jsonb)
  into v_history
  from public.equipment_owner_payment_postings p
  join public.cash_accounts a on a.id=p.cash_account_id
  join public.cash_transactions t on t.id=p.transaction_id
  where p.entity_type=v_type
    and p.entity_id=p_entity_id
    and p.organization_id=v_org;

  return v_ctx||jsonb_build_object(
    'accounts',v_accounts,
    'posting_history',v_history,
    'active_posting',(
      select jsonb_build_object(
        'posting_id',p.id,
        'transaction_id',p.transaction_id,
        'cash_account_id',p.cash_account_id,
        'cash_account_name',a.name,
        'amount',p.amount,
        'currency',p.currency,
        'payment_reference',p.payment_reference,
        'posted_at',p.posted_at
      )
      from public.equipment_owner_payment_postings p
      join public.cash_accounts a on a.id=p.cash_account_id
      where p.entity_type=v_type
        and p.entity_id=p_entity_id
        and p.organization_id=v_org
        and p.reversed_at is null
      order by p.posted_at desc
      limit 1
    )
  );
end
$function$;
revoke all on function public.get_equipment_owner_payment_financial_options(text,uuid)
  from public,anon,authenticated;
grant execute on function public.get_equipment_owner_payment_financial_options(text,uuid)
  to authenticated;

CREATE OR REPLACE FUNCTION public.post_equipment_owner_payment_financial_transaction(p_entity_type text, p_entity_id uuid, p_cash_account_id uuid, p_transaction_date date, p_payment_reference text, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_type text:=upper(btrim(coalesce(p_entity_type,'')));
  v_ctx jsonb;
  v_org uuid;
  v_contract uuid;
  v_partner uuid;
  v_amount numeric;
  v_currency text;
  v_status text;
  v_document uuid;
  v_charge_type text;
  v_account public.cash_accounts%rowtype;
  v_category_id uuid;
  v_category_name text;
  v_actor uuid;
  v_posting_id uuid:=gen_random_uuid();
  v_tx uuid;
  v_description text;
  v_prev_write text:=coalesce(current_setting('app.equipment_owner_payment_ledger_write',true),'');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.current_partner_id() is not null then
    raise exception 'PARTNER_PAYMENT_LEDGER_NOT_AVAILABLE';
  end if;
  if not public.has_permission('equipment.contracts.manage')
     or not public.has_permission('production.settlements.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_type='LEASE_CHARGE'
     and not public.has_permission('production.buyout.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_cash_account_id is null then raise exception 'CASH_ACCOUNT_REQUIRED'; end if;
  if p_transaction_date is null then raise exception 'TRANSACTION_DATE_REQUIRED'; end if;
  if p_transaction_date>current_date then raise exception 'FUTURE_TRANSACTION_DATE_NOT_ALLOWED'; end if;
  if nullif(btrim(coalesce(p_payment_reference,'')),'') is null then
    raise exception 'PAYMENT_REFERENCE_REQUIRED';
  end if;

  perform private.assert_equipment_contract_child_tenant(v_type,p_entity_id);
  v_ctx:=private.equipment_owner_payment_context(v_type,p_entity_id);

  v_org:=(v_ctx->>'organization_id')::uuid;
  v_contract:=(v_ctx->>'contract_id')::uuid;
  v_partner:=(v_ctx->>'partner_id')::uuid;
  v_amount:=(v_ctx->>'amount')::numeric;
  v_currency:=v_ctx->>'currency';
  v_status:=v_ctx->>'status';
  v_document:=nullif(v_ctx->>'document_id','')::uuid;
  v_charge_type:=v_ctx->>'charge_type';

  if v_org is distinct from public.current_user_organization_id() then
    raise exception 'PAYMENT_ENTITY_NOT_AVAILABLE';
  end if;
  if v_status<>'APPROVED' then raise exception 'PAYMENT_ENTITY_MUST_BE_APPROVED'; end if;
  if not coalesce((v_ctx->>'audit_ready')::boolean,false) then
    raise exception 'PAYMENT_ENTITY_AUDIT_SNAPSHOT_REQUIRED';
  end if;
  if v_amount<=0 then raise exception 'PAYMENT_AMOUNT_NOT_POSITIVE'; end if;

  if exists(
    select 1
    from public.equipment_owner_payment_postings p
    where p.entity_type=v_type
      and p.entity_id=p_entity_id
      and p.reversed_at is null
  ) then raise exception 'PAYMENT_LEDGER_POSTING_EXISTS'; end if;

  select * into v_account
  from public.cash_accounts a
  where a.id=p_cash_account_id
    and a.organization_id=v_org
    and a.is_active=true;

  if v_account.id is null then raise exception 'PAYMENT_CASH_ACCOUNT_INVALID'; end if;
  if upper(coalesce(v_account.currency,'RUB'))<>upper(coalesce(v_currency,'RUB')) then
    raise exception 'PAYMENT_CASH_ACCOUNT_CURRENCY_MISMATCH';
  end if;

  v_category_name:=case
    when v_type='OWNER_SETTLEMENT' then 'Выплата доли владельцу оборудования'
    when v_charge_type='BUYOUT_EXTRA' then 'Выкуп оборудования'
    else 'Аренда'
  end;

  select c.id into v_category_id
  from public.cash_categories c
  where c.organization_id=v_org
    and c.direction='EXPENSE'
    and lower(c.name)=lower(v_category_name)
    and c.is_active=true
  order by c.created_at
  limit 1;

  if v_category_id is null then
    insert into public.cash_categories(organization_id,direction,name,is_active)
    values(v_org,'EXPENSE',v_category_name,true)
    returning id into v_category_id;
  end if;

  v_actor:=public.current_staff_user_id();
  if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;

  v_description:=case
    when v_type='OWNER_SETTLEMENT' then 'Выплата доли владельцу'
    else 'Выплата владельцу по аренде/выкупу'
  end||
    ' · договор '||coalesce(v_ctx->>'contract_number','—')||
    ' · '||coalesce(v_ctx->>'partner_name','Владелец')||
    ' · документ '||btrim(p_payment_reference);

  if nullif(btrim(coalesce(p_note,'')),'') is not null then
    v_description:=v_description||' · '||btrim(p_note);
  end if;

  insert into public.cash_transactions(
    organization_id,cash_account_id,category_id,direction,amount,payment_method,
    description,transaction_date,created_by,external_source,external_id,
    created_at,updated_at
  ) values(
    v_org,v_account.id,v_category_id,'EXPENSE',v_amount,v_account.account_type,
    v_description,p_transaction_date,v_actor,'EQUIPMENT_OWNER_PAYMENT',
    v_posting_id::text,clock_timestamp(),clock_timestamp()
  )
  returning id into v_tx;

  perform set_config('app.equipment_owner_payment_ledger_write','1',true);

  insert into public.equipment_owner_payment_postings(
    id,entity_type,entity_id,contract_id,partner_id,organization_id,amount,currency,
    cash_account_id,transaction_id,payment_reference,note,posted_by,posted_at
  ) values(
    v_posting_id,v_type,p_entity_id,v_contract,v_partner,v_org,v_amount,v_currency,
    v_account.id,v_tx,btrim(p_payment_reference),
    nullif(btrim(coalesce(p_note,'')),''),v_actor,clock_timestamp()
  );

  if v_document is not null then
    insert into public.document_links(
      document_id,entity_type,entity_id,relationship,created_at
    ) values(
      v_document,'CASH_TRANSACTION',v_tx,'PAYMENT_POSTING',clock_timestamp()
    )
    on conflict do nothing;
  end if;

  perform set_config('app.equipment_owner_payment_ledger_write','1',true);

  if v_type='OWNER_SETTLEMENT' then
    perform public.set_equipment_owner_settlement_status(
      p_entity_id,'PAID',btrim(p_payment_reference),p_note
    );
  else
    perform public.set_equipment_lease_charge_status(
      p_entity_id,'PAID',btrim(p_payment_reference),p_note
    );
  end if;

  perform set_config('app.equipment_owner_payment_ledger_write',v_prev_write,true);

  return v_tx;
exception
  when unique_violation then
    raise exception 'PAYMENT_LEDGER_POSTING_EXISTS';
end
$function$;
revoke all on function public.post_equipment_owner_payment_financial_transaction(text,uuid,uuid,date,text,text)
  from public,anon,authenticated;
grant execute on function public.post_equipment_owner_payment_financial_transaction(text,uuid,uuid,date,text,text)
  to authenticated;

CREATE OR REPLACE FUNCTION public.reverse_equipment_owner_payment_financial_transaction(p_entity_type text, p_entity_id uuid, p_reason text, p_reference text, p_transaction_date date DEFAULT CURRENT_DATE)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_type text:=upper(btrim(coalesce(p_entity_type,'')));
  v_ctx jsonb;
  v_org uuid;
  v_status text;
  v_document uuid;
  v_posting public.equipment_owner_payment_postings%rowtype;
  v_original public.cash_transactions%rowtype;
  v_account public.cash_accounts%rowtype;
  v_category_id uuid;
  v_actor uuid;
  v_reversal uuid;
  v_description text;
  v_prev_write text:=coalesce(current_setting('app.equipment_owner_payment_ledger_write',true),'');
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.current_partner_id() is not null then
    raise exception 'PARTNER_PAYMENT_LEDGER_NOT_AVAILABLE';
  end if;
  if not public.has_permission('equipment.contracts.manage')
     or not public.has_permission('production.settlements.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_type='LEASE_CHARGE'
     and not public.has_permission('production.buyout.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null
     or length(btrim(p_reason))<3 then
    raise exception 'REVERSAL_REASON_REQUIRED';
  end if;
  if nullif(btrim(coalesce(p_reference,'')),'') is null
     or length(btrim(p_reference))<2 then
    raise exception 'REVERSAL_REFERENCE_REQUIRED';
  end if;
  if p_transaction_date is null then raise exception 'TRANSACTION_DATE_REQUIRED'; end if;
  if p_transaction_date>current_date then raise exception 'FUTURE_TRANSACTION_DATE_NOT_ALLOWED'; end if;

  perform private.assert_equipment_contract_child_tenant(v_type,p_entity_id);
  v_ctx:=private.equipment_owner_payment_context(v_type,p_entity_id);
  v_org:=(v_ctx->>'organization_id')::uuid;
  v_status:=v_ctx->>'status';
  v_document:=nullif(v_ctx->>'document_id','')::uuid;

  if v_org is distinct from public.current_user_organization_id() then
    raise exception 'PAYMENT_ENTITY_NOT_AVAILABLE';
  end if;
  if v_status<>'PAID' then raise exception 'PAYMENT_ENTITY_MUST_BE_PAID'; end if;

  select * into v_posting
  from public.equipment_owner_payment_postings p
  where p.entity_type=v_type
    and p.entity_id=p_entity_id
    and p.organization_id=v_org
    and p.reversed_at is null
  order by p.posted_at desc
  limit 1
  for update;

  if v_posting.id is null then raise exception 'PAYMENT_LEDGER_POSTING_NOT_FOUND'; end if;

  select * into v_original
  from public.cash_transactions t
  where t.id=v_posting.transaction_id
  for update;

  if v_original.id is null
     or v_original.organization_id is distinct from v_org
     or v_original.direction<>'EXPENSE'
     or abs(v_original.amount-v_posting.amount)>0.01 then
    raise exception 'PAYMENT_LEDGER_TRANSACTION_INVALID';
  end if;

  if p_transaction_date<v_original.transaction_date then
    raise exception 'REVERSAL_BEFORE_PAYMENT_DATE';
  end if;

  select * into v_account
  from public.cash_accounts
  where id=v_original.cash_account_id;

  if v_account.id is null
     or v_account.organization_id is distinct from v_org then
    raise exception 'PAYMENT_CASH_ACCOUNT_INVALID';
  end if;

  select c.id into v_category_id
  from public.cash_categories c
  where c.organization_id=v_org
    and c.direction='INCOME'
    and lower(c.name)=lower('Сторно выплаты владельцу оборудования')
    and c.is_active=true
  order by c.created_at
  limit 1;

  if v_category_id is null then
    insert into public.cash_categories(organization_id,direction,name,is_active)
    values(v_org,'INCOME','Сторно выплаты владельцу оборудования',true)
    returning id into v_category_id;
  end if;

  v_actor:=public.current_staff_user_id();
  if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;

  v_description:='СТОРНО выплаты владельцу'||
    ' · исходная операция '||v_original.id::text||
    ' · основание '||btrim(p_reference)||
    ' · причина '||btrim(p_reason);

  insert into public.cash_transactions(
    organization_id,cash_account_id,category_id,direction,amount,payment_method,
    description,transaction_date,created_by,external_source,external_id,
    created_at,updated_at
  ) values(
    v_org,v_original.cash_account_id,v_category_id,'INCOME',v_original.amount,
    v_original.payment_method,v_description,p_transaction_date,v_actor,
    'EQUIPMENT_OWNER_PAYMENT_REVERSAL',v_posting.id::text,
    clock_timestamp(),clock_timestamp()
  )
  returning id into v_reversal;

  perform set_config('app.equipment_owner_payment_ledger_write','1',true);

  update public.equipment_owner_payment_postings
  set reversal_transaction_id=v_reversal,
      reversal_reason=btrim(p_reason),
      reversal_reference=btrim(p_reference),
      reversed_by=v_actor,
      reversed_at=clock_timestamp()
  where id=v_posting.id;

  if v_document is not null then
    insert into public.document_links(
      document_id,entity_type,entity_id,relationship,created_at
    ) values(
      v_document,'CASH_TRANSACTION',v_reversal,'PAYMENT_REVERSAL',clock_timestamp()
    )
    on conflict do nothing;
  end if;

  if v_type='OWNER_SETTLEMENT' then
    update public.equipment_owner_settlements
    set status='APPROVED',
        paid_by=null,
        paid_at=null,
        payment_reference=null,
        updated_at=clock_timestamp()
    where id=p_entity_id;
  else
    update public.equipment_lease_charges
    set status='APPROVED',
        paid_by=null,
        paid_at=null,
        payment_reference=null,
        updated_at=clock_timestamp()
    where id=p_entity_id;
  end if;

  perform set_config('app.equipment_owner_payment_ledger_write',v_prev_write,true);

  return v_reversal;
exception
  when unique_violation then
    raise exception 'PAYMENT_LEDGER_REVERSAL_EXISTS';
end
$function$;
revoke all on function public.reverse_equipment_owner_payment_financial_transaction(text,uuid,text,text,date)
  from public,anon,authenticated;
grant execute on function public.reverse_equipment_owner_payment_financial_transaction(text,uuid,text,text,date)
  to authenticated;

CREATE OR REPLACE FUNCTION public.get_my_equipment_owner_payment_ledger()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_partner uuid;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;

  v_partner:=public.current_partner_id();
  if v_partner is null then raise exception 'PARTNER_ACCESS_REQUIRED'; end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'posting_id',p.id,
        'entity_type',p.entity_type,
        'entity_id',p.entity_id,
        'contract_id',p.contract_id,
        'contract_number',c.contract_number,
        'amount',p.amount,
        'currency',p.currency,
        'payment_reference',p.payment_reference,
        'note',p.note,
        'posted_at',p.posted_at,
        'transaction_date',tx.transaction_date,
        'ledger_status',case when p.reversed_at is null then 'POSTED' else 'REVERSED' end,
        'reversal_reference',p.reversal_reference,
        'reversal_reason',p.reversal_reason,
        'reversed_at',p.reversed_at,
        'reversal_transaction_date',rtx.transaction_date,
        'period_start',case
          when p.entity_type='OWNER_SETTLEMENT' then s.period_start
          else l.period_start
        end,
        'period_end',case
          when p.entity_type='OWNER_SETTLEMENT' then s.period_end
          else l.period_end
        end,
        'charge_type',case when p.entity_type='LEASE_CHARGE' then l.charge_type else null end,
        'audit_document_id',case
          when p.entity_type='OWNER_SETTLEMENT' then s.settlement_document_id
          else l.allocation_document_id
        end
      )
      order by p.posted_at desc,p.id
    ),
    '[]'::jsonb
  )
  into v_result
  from public.equipment_owner_payment_postings p
  join public.equipment_contracts c
    on c.id=p.contract_id
   and c.partner_id=v_partner
  join public.cash_transactions tx
    on tx.id=p.transaction_id
   and tx.organization_id=p.organization_id
  left join public.cash_transactions rtx
    on rtx.id=p.reversal_transaction_id
   and rtx.organization_id=p.organization_id
  left join public.equipment_owner_settlements s
    on p.entity_type='OWNER_SETTLEMENT'
   and s.id=p.entity_id
   and s.partner_id=v_partner
  left join public.equipment_lease_charges l
    on p.entity_type='LEASE_CHARGE'
   and l.id=p.entity_id
   and l.partner_id=v_partner
  where p.partner_id=v_partner;

  return v_result;
end
$function$;
revoke all on function public.get_my_equipment_owner_payment_ledger()
  from public,anon,authenticated;
grant execute on function public.get_my_equipment_owner_payment_ledger()
  to authenticated;

select private.assert_production_farm_security_baseline();
