-- A4PRINT HUB: Production Farm Phase 21
-- Auditable amendments/renewals for active partner equipment contracts.

insert into public.document_types(code,name,description,requires_signature,default_validity_days)
values('EQ_CONTRACT_AMENDMENT','Дополнительное соглашение к договору оборудования','Изменение утверждённых условий действующего договора партнёрского оборудования',true,null)
on conflict(code) do update set name=excluded.name,description=excluded.description,requires_signature=excluded.requires_signature;

create table if not exists public.equipment_contract_amendments(
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.equipment_contracts(id) on delete restrict,
  partner_id uuid not null references public.partners(id) on delete restrict,
  amendment_number text not null,
  amendment_kind text not null check(amendment_kind in ('RENEWAL','TERMS_CHANGE')),
  status text not null default 'DRAFT' check(status in ('DRAFT','APPROVED','APPLIED','CANCELLED')),
  effective_on date not null,
  proposed_changes jsonb not null default '{}'::jsonb,
  before_snapshot jsonb not null,
  after_snapshot jsonb,
  reason text not null,
  document_id uuid references public.documents(id) on delete restrict,
  created_by uuid references public.users(id) on delete set null,
  approved_by uuid references public.users(id) on delete set null,
  applied_by uuid references public.users(id) on delete set null,
  cancelled_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  approved_at timestamptz,
  applied_at timestamptz,
  cancelled_at timestamptz,
  unique(contract_id,amendment_number)
);

create index if not exists equipment_contract_amendments_contract_idx on public.equipment_contract_amendments(contract_id,created_at desc);
create index if not exists equipment_contract_amendments_partner_idx on public.equipment_contract_amendments(partner_id,status,created_at desc);
create index if not exists equipment_contract_amendments_document_idx on public.equipment_contract_amendments(document_id) where document_id is not null;
create index if not exists equipment_contract_amendments_created_by_idx on public.equipment_contract_amendments(created_by) where created_by is not null;
create index if not exists equipment_contract_amendments_approved_by_idx on public.equipment_contract_amendments(approved_by) where approved_by is not null;
create index if not exists equipment_contract_amendments_applied_by_idx on public.equipment_contract_amendments(applied_by) where applied_by is not null;
create index if not exists equipment_contract_amendments_cancelled_by_idx on public.equipment_contract_amendments(cancelled_by) where cancelled_by is not null;

alter table public.equipment_contract_amendments enable row level security;
drop policy if exists equipment_contract_amendments_read on public.equipment_contract_amendments;
create policy equipment_contract_amendments_read on public.equipment_contract_amendments
for select to authenticated
using(public.has_permission('equipment.view') or public.has_permission('equipment.contracts.manage') or partner_id=public.current_partner_id());
revoke all on public.equipment_contract_amendments from public,anon,authenticated;
grant select on public.equipment_contract_amendments to authenticated;

drop trigger if exists trg_audit_equipment_contract_amendments on public.equipment_contract_amendments;
create trigger trg_audit_equipment_contract_amendments after insert or update or delete on public.equipment_contract_amendments
for each row execute function public.audit_row_change();

create or replace function public.equipment_contract_legal_snapshot(p_contract_id uuid)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
  select jsonb_build_object(
    'contract_id',c.id,'partner_id',c.partner_id,'contract_number',c.contract_number,'contract_type',c.contract_type,
    'starts_on',c.starts_on,'ends_on',c.ends_on,'hub_share_percent',c.hub_share_percent,'owner_share_percent',c.owner_share_percent,
    'calculation_basis',c.calculation_basis,'direct_costs_before_split',c.direct_costs_before_split,
    'settlement_frequency',c.settlement_frequency,'settlement_day',c.settlement_day,'repair_responsibility',c.repair_responsibility,
    'early_termination_notice_days',c.early_termination_notice_days,'lease_period_amount',c.lease_period_amount,
    'buyout_enabled',c.buyout_enabled,'buyout_price',c.buyout_price,'buyout_credit_percent',c.buyout_credit_percent,
    'currency',c.currency,'terms',c.terms
  ) from public.equipment_contracts c where c.id=p_contract_id
$$;
revoke all on function public.equipment_contract_legal_snapshot(uuid) from public,anon,authenticated;

create or replace function public.guard_equipment_contract_legal_amendment()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if old.status in ('ACTIVE','SUSPENDED') and new.status in ('ACTIVE','SUSPENDED')
     and coalesce(current_setting('app.equipment_contract_amendment_apply',true),'')<>'1'
     and (
       old.partner_id is distinct from new.partner_id or old.contract_number is distinct from new.contract_number or
       old.contract_type is distinct from new.contract_type or old.starts_on is distinct from new.starts_on or
       old.ends_on is distinct from new.ends_on or old.hub_share_percent is distinct from new.hub_share_percent or
       old.owner_share_percent is distinct from new.owner_share_percent or old.calculation_basis is distinct from new.calculation_basis or
       old.direct_costs_before_split is distinct from new.direct_costs_before_split or old.settlement_frequency is distinct from new.settlement_frequency or
       old.settlement_day is distinct from new.settlement_day or old.repair_responsibility is distinct from new.repair_responsibility or
       old.early_termination_notice_days is distinct from new.early_termination_notice_days or old.lease_period_amount is distinct from new.lease_period_amount or
       old.buyout_enabled is distinct from new.buyout_enabled or old.buyout_price is distinct from new.buyout_price or
       old.buyout_credit_percent is distinct from new.buyout_credit_percent or old.currency is distinct from new.currency or old.terms is distinct from new.terms
     ) then raise exception 'ACTIVE_CONTRACT_REQUIRES_AMENDMENT';
  end if;
  return new;
end
$$;
revoke all on function public.guard_equipment_contract_legal_amendment() from public,anon,authenticated;
drop trigger if exists trg_guard_equipment_contract_legal_amendment on public.equipment_contracts;
create trigger trg_guard_equipment_contract_legal_amendment before update on public.equipment_contracts
for each row execute function public.guard_equipment_contract_legal_amendment();

-- The legacy editor may still edit DRAFT contracts freely. Once ACTIVE/SUSPENDED,
-- it can only change operational status ACTIVE<->SUSPENDED and the internal note;
-- legal fields and equipment composition require a dedicated workflow.
create or replace function public.save_equipment_contract(p_contract_id uuid, p_partner_id uuid, p_contract_number text, p_contract_type text, p_status text, p_starts_on date, p_ends_on date, p_hub_share_percent numeric, p_owner_share_percent numeric, p_calculation_basis text, p_direct_costs_before_split boolean, p_settlement_frequency text, p_settlement_day integer, p_repair_responsibility text, p_early_termination_notice_days integer, p_buyout_enabled boolean, p_buyout_price numeric, p_currency text, p_notes text, p_equipment_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare v_id uuid; v_equipment_id uuid; v_existing public.equipment_contracts%rowtype;
begin
  if not public.has_permission('equipment.contracts.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_partner_id is null then raise exception 'PARTNER_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_contract_number,'')),'') is null then raise exception 'CONTRACT_NUMBER_REQUIRED'; end if;
  if p_contract_type not in ('REVENUE_SHARE','LEASE','LEASE_BUYOUT','LOAN_FOR_USE','OTHER') then raise exception 'INVALID_CONTRACT_TYPE'; end if;
  if p_status not in ('DRAFT','ACTIVE','SUSPENDED','TERMINATED','COMPLETED') then raise exception 'INVALID_CONTRACT_STATUS'; end if;
  if p_starts_on is null then raise exception 'CONTRACT_START_REQUIRED'; end if;
  if p_ends_on is not null and p_ends_on<p_starts_on then raise exception 'INVALID_CONTRACT_DATES'; end if;
  if p_contract_type='REVENUE_SHARE' and abs(coalesce(p_hub_share_percent,0)+coalesce(p_owner_share_percent,0)-100)>0.001 then raise exception 'SHARES_MUST_TOTAL_100'; end if;
  if coalesce(p_buyout_enabled,false) and p_buyout_price is null then raise exception 'BUYOUT_PRICE_REQUIRED'; end if;

  if p_contract_id is null then
    insert into public.equipment_contracts(partner_id,contract_number,contract_type,status,starts_on,ends_on,hub_share_percent,owner_share_percent,calculation_basis,direct_costs_before_split,settlement_frequency,settlement_day,repair_responsibility,early_termination_notice_days,buyout_enabled,buyout_price,currency,notes,created_by)
    values(p_partner_id,btrim(p_contract_number),p_contract_type,p_status,p_starts_on,p_ends_on,coalesce(p_hub_share_percent,70),coalesce(p_owner_share_percent,30),p_calculation_basis,coalesce(p_direct_costs_before_split,false),p_settlement_frequency,p_settlement_day,p_repair_responsibility,coalesce(p_early_termination_notice_days,30),coalesce(p_buyout_enabled,false),p_buyout_price,coalesce(nullif(upper(btrim(p_currency)),''),'RUB'),nullif(btrim(coalesce(p_notes,'')),''),public.current_staff_user_id()) returning id into v_id;
  else
    select * into v_existing from public.equipment_contracts where id=p_contract_id for update;
    if v_existing.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
    if v_existing.status in ('ACTIVE','SUSPENDED') then
      if p_status not in ('ACTIVE','SUSPENDED') then raise exception 'USE_DEDICATED_CONTRACT_CLOSURE_WORKFLOW'; end if;
      if v_existing.partner_id is distinct from p_partner_id or v_existing.contract_number is distinct from btrim(p_contract_number) or v_existing.contract_type is distinct from p_contract_type or v_existing.starts_on is distinct from p_starts_on or v_existing.ends_on is distinct from p_ends_on or v_existing.hub_share_percent is distinct from coalesce(p_hub_share_percent,70) or v_existing.owner_share_percent is distinct from coalesce(p_owner_share_percent,30) or v_existing.calculation_basis is distinct from p_calculation_basis or v_existing.direct_costs_before_split is distinct from coalesce(p_direct_costs_before_split,false) or v_existing.settlement_frequency is distinct from p_settlement_frequency or v_existing.settlement_day is distinct from p_settlement_day or v_existing.repair_responsibility is distinct from p_repair_responsibility or v_existing.early_termination_notice_days is distinct from coalesce(p_early_termination_notice_days,30) or v_existing.buyout_enabled is distinct from coalesce(p_buyout_enabled,false) or v_existing.buyout_price is distinct from p_buyout_price or v_existing.currency is distinct from coalesce(nullif(upper(btrim(p_currency)),''),'RUB') then raise exception 'ACTIVE_CONTRACT_REQUIRES_AMENDMENT'; end if;
      if exists(select ca.equipment_id from public.equipment_contract_assets ca where ca.contract_id=v_existing.id except select unnest(coalesce(p_equipment_ids,'{}'::uuid[]))) or exists(select unnest(coalesce(p_equipment_ids,'{}'::uuid[])) except select ca.equipment_id from public.equipment_contract_assets ca where ca.contract_id=v_existing.id) then raise exception 'ACTIVE_CONTRACT_EQUIPMENT_CHANGE_REQUIRES_NEW_ANNEX'; end if;
      update public.equipment_contracts set status=p_status,notes=nullif(btrim(coalesce(p_notes,'')),'') where id=v_existing.id;
      return v_existing.id;
    end if;
    update public.equipment_contracts set partner_id=p_partner_id,contract_number=btrim(p_contract_number),contract_type=p_contract_type,status=p_status,starts_on=p_starts_on,ends_on=p_ends_on,hub_share_percent=coalesce(p_hub_share_percent,70),owner_share_percent=coalesce(p_owner_share_percent,30),calculation_basis=p_calculation_basis,direct_costs_before_split=coalesce(p_direct_costs_before_split,false),settlement_frequency=p_settlement_frequency,settlement_day=p_settlement_day,repair_responsibility=p_repair_responsibility,early_termination_notice_days=coalesce(p_early_termination_notice_days,30),buyout_enabled=coalesce(p_buyout_enabled,false),buyout_price=p_buyout_price,currency=coalesce(nullif(upper(btrim(p_currency)),''),'RUB'),notes=nullif(btrim(coalesce(p_notes,'')),'') where id=p_contract_id;
    v_id:=p_contract_id;
  end if;

  delete from public.equipment_contract_assets where contract_id=v_id;
  foreach v_equipment_id in array coalesce(p_equipment_ids,'{}'::uuid[]) loop
    if not exists(select 1 from public.equipment_assets a where a.id=v_equipment_id) then raise exception 'EQUIPMENT_NOT_FOUND: %',v_equipment_id; end if;
    insert into public.equipment_contract_assets(contract_id,equipment_id,starts_on,ends_on) values(v_id,v_equipment_id,p_starts_on,p_ends_on) on conflict(contract_id,equipment_id) do nothing;
  end loop;
  return v_id;
end
$$;
revoke all on function public.save_equipment_contract(uuid,uuid,text,text,text,date,date,numeric,numeric,text,boolean,text,integer,text,integer,boolean,numeric,text,text,uuid[]) from public,anon,authenticated;
grant execute on function public.save_equipment_contract(uuid,uuid,text,text,text,date,date,numeric,numeric,text,boolean,text,integer,text,integer,boolean,numeric,text,text,uuid[]) to authenticated;
