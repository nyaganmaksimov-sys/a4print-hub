-- A4PRINT HUB · Production Farm phase 5
-- Fixed lease charges, lease-to-buyout credit and atomic ownership transfer.

alter table public.equipment_contracts
  add column if not exists lease_period_amount numeric(14,2) not null default 0,
  add column if not exists buyout_credit_percent numeric(7,4) not null default 100,
  add column if not exists buyout_completed_at timestamptz,
  add column if not exists buyout_completed_by uuid references public.users(id) on delete set null,
  add column if not exists buyout_transfer_reference text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.equipment_contracts'::regclass
      and conname='equipment_contracts_lease_period_amount_check'
  ) then
    alter table public.equipment_contracts
      add constraint equipment_contracts_lease_period_amount_check
      check(lease_period_amount>=0);
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.equipment_contracts'::regclass
      and conname='equipment_contracts_buyout_credit_percent_check'
  ) then
    alter table public.equipment_contracts
      add constraint equipment_contracts_buyout_credit_percent_check
      check(buyout_credit_percent between 0 and 100);
  end if;
end
$$;

create index if not exists equipment_contracts_buyout_completed_by_idx
  on public.equipment_contracts(buyout_completed_by)
  where buyout_completed_by is not null;

create table if not exists public.equipment_lease_charges (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.equipment_contracts(id) on delete restrict,
  partner_id uuid not null references public.partners(id) on delete restrict,
  charge_type text not null check(charge_type in ('LEASE','BUYOUT_EXTRA')),
  period_start date,
  period_end date,
  amount numeric(14,2) not null check(amount>0),
  buyout_credit_amount numeric(14,2) not null default 0 check(buyout_credit_amount>=0),
  status text not null default 'DRAFT' check(status in ('DRAFT','APPROVED','PAID','CANCELLED')),
  currency text not null default 'RUB',
  payment_reference text,
  notes text,
  generated_by uuid references public.users(id) on delete set null,
  approved_by uuid references public.users(id) on delete set null,
  paid_by uuid references public.users(id) on delete set null,
  generated_at timestamptz not null default now(),
  approved_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(
    (charge_type='LEASE' and period_start is not null and period_end is not null and period_end>=period_start)
    or (charge_type='BUYOUT_EXTRA' and period_start is null and period_end is null)
  )
);

create index if not exists equipment_lease_charges_contract_idx
  on public.equipment_lease_charges(contract_id,created_at desc);
create index if not exists equipment_lease_charges_partner_idx
  on public.equipment_lease_charges(partner_id,created_at desc);
create index if not exists equipment_lease_charges_generated_by_idx
  on public.equipment_lease_charges(generated_by) where generated_by is not null;
create index if not exists equipment_lease_charges_approved_by_idx
  on public.equipment_lease_charges(approved_by) where approved_by is not null;
create index if not exists equipment_lease_charges_paid_by_idx
  on public.equipment_lease_charges(paid_by) where paid_by is not null;
create index if not exists equipment_lease_charges_status_idx
  on public.equipment_lease_charges(status,created_at desc);

create unique index if not exists equipment_lease_charges_period_uidx
  on public.equipment_lease_charges(contract_id,period_start,period_end)
  where charge_type='LEASE' and status<>'CANCELLED';

alter table public.equipment_lease_charges enable row level security;
drop policy if exists equipment_lease_charges_read on public.equipment_lease_charges;
create policy equipment_lease_charges_read
on public.equipment_lease_charges
for select to authenticated
using (
  (select public.has_permission('production.settlements.view'))
  or (select public.has_permission('production.buyout.manage'))
  or partner_id=(select public.current_partner_id())
);

revoke all on public.equipment_lease_charges from anon,authenticated;
grant select on public.equipment_lease_charges to authenticated;

create or replace function public.touch_equipment_lease_charge()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  new.updated_at:=clock_timestamp();
  return new;
end
$$;
revoke all on function public.touch_equipment_lease_charge() from public,anon,authenticated;

drop trigger if exists trg_equipment_lease_charges_updated_at on public.equipment_lease_charges;
create trigger trg_equipment_lease_charges_updated_at
before update on public.equipment_lease_charges
for each row execute function public.touch_equipment_lease_charge();

drop trigger if exists trg_audit_equipment_lease_charges on public.equipment_lease_charges;
create trigger trg_audit_equipment_lease_charges
after insert or update or delete on public.equipment_lease_charges
for each row execute function public.audit_row_change();

create or replace function public.configure_equipment_lease_terms(
  p_contract_id uuid,
  p_lease_period_amount numeric,
  p_buyout_credit_percent numeric,
  p_buyout_price numeric default null
) returns public.equipment_contracts
language plpgsql
security definer
set search_path=public
as $$
declare
  v_contract public.equipment_contracts;
begin
  if not public.has_permission('production.buyout.manage') then raise exception 'PERMISSION_DENIED'; end if;

  select * into v_contract
  from public.equipment_contracts
  where id=p_contract_id
  for update;
  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if v_contract.contract_type not in ('LEASE','LEASE_BUYOUT') then raise exception 'LEASE_CONTRACT_TYPE_REQUIRED'; end if;
  if v_contract.status in ('TERMINATED','COMPLETED') then raise exception 'CONTRACT_LOCKED'; end if;
  if coalesce(p_lease_period_amount,0)<=0 then raise exception 'LEASE_AMOUNT_REQUIRED'; end if;
  if coalesce(p_buyout_credit_percent,0)<0 or coalesce(p_buyout_credit_percent,0)>100 then raise exception 'INVALID_BUYOUT_CREDIT_PERCENT'; end if;
  if v_contract.contract_type='LEASE_BUYOUT' and coalesce(p_buyout_price,v_contract.buyout_price,0)<=0 then raise exception 'BUYOUT_PRICE_REQUIRED'; end if;

  update public.equipment_contracts
  set lease_period_amount=round(p_lease_period_amount,2),
      buyout_credit_percent=coalesce(p_buyout_credit_percent,0),
      buyout_enabled=case when contract_type='LEASE_BUYOUT' then true else buyout_enabled end,
      buyout_price=case when contract_type='LEASE_BUYOUT' then round(coalesce(p_buyout_price,buyout_price),2) else buyout_price end
  where id=p_contract_id
  returning * into v_contract;

  return v_contract;
end
$$;
revoke all on function public.configure_equipment_lease_terms(uuid,numeric,numeric,numeric) from public,anon;
grant execute on function public.configure_equipment_lease_terms(uuid,numeric,numeric,numeric) to authenticated;

create or replace function public.generate_equipment_lease_charge(
  p_contract_id uuid,
  p_period_start date,
  p_period_end date,
  p_notes text default null
) returns public.equipment_lease_charges
language plpgsql
security definer
set search_path=public
as $$
declare
  v_contract public.equipment_contracts;
  v_charge public.equipment_lease_charges;
  v_actor uuid;
  v_credit numeric;
begin
  if not public.has_permission('production.buyout.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start then raise exception 'INVALID_PERIOD'; end if;

  select * into v_contract
  from public.equipment_contracts
  where id=p_contract_id
  for update;
  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if v_contract.contract_type not in ('LEASE','LEASE_BUYOUT') then raise exception 'LEASE_CONTRACT_TYPE_REQUIRED'; end if;
  if v_contract.status<>'ACTIVE' then raise exception 'CONTRACT_NOT_ACTIVE'; end if;
  if coalesce(v_contract.lease_period_amount,0)<=0 then raise exception 'LEASE_TERMS_NOT_CONFIGURED'; end if;
  if p_period_start<v_contract.starts_on or (v_contract.ends_on is not null and p_period_end>v_contract.ends_on) then raise exception 'PERIOD_OUTSIDE_CONTRACT'; end if;

  if exists(
    select 1 from public.equipment_lease_charges c
    where c.contract_id=v_contract.id and c.charge_type='LEASE' and c.status<>'CANCELLED'
      and daterange(c.period_start,c.period_end,'[]') && daterange(p_period_start,p_period_end,'[]')
  ) then raise exception 'LEASE_PERIOD_OVERLAP'; end if;

  v_actor:=public.current_staff_user_id();
  v_credit:=case when v_contract.buyout_enabled
    then round(v_contract.lease_period_amount*coalesce(v_contract.buyout_credit_percent,0)/100.0,2)
    else 0 end;

  insert into public.equipment_lease_charges(
    contract_id,partner_id,charge_type,period_start,period_end,amount,buyout_credit_amount,
    status,currency,notes,generated_by
  ) values(
    v_contract.id,v_contract.partner_id,'LEASE',p_period_start,p_period_end,
    round(v_contract.lease_period_amount,2),v_credit,'DRAFT',v_contract.currency,
    nullif(trim(coalesce(p_notes,'')),''),v_actor
  ) returning * into v_charge;

  return v_charge;
end
$$;
revoke all on function public.generate_equipment_lease_charge(uuid,date,date,text) from public,anon;
grant execute on function public.generate_equipment_lease_charge(uuid,date,date,text) to authenticated;

create or replace function public.record_equipment_buyout_payment(
  p_contract_id uuid,
  p_amount numeric,
  p_notes text default null
) returns public.equipment_lease_charges
language plpgsql
security definer
set search_path=public
as $$
declare
  v_contract public.equipment_contracts;
  v_charge public.equipment_lease_charges;
  v_actor uuid;
  v_paid_credit numeric;
  v_remaining numeric;
begin
  if not public.has_permission('production.buyout.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if coalesce(p_amount,0)<=0 then raise exception 'INVALID_PAYMENT_AMOUNT'; end if;

  select * into v_contract from public.equipment_contracts where id=p_contract_id for update;
  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if v_contract.contract_type<>'LEASE_BUYOUT' or not v_contract.buyout_enabled then raise exception 'BUYOUT_NOT_ENABLED'; end if;
  if v_contract.status<>'ACTIVE' then raise exception 'CONTRACT_NOT_ACTIVE'; end if;
  if coalesce(v_contract.buyout_price,0)<=0 then raise exception 'BUYOUT_PRICE_REQUIRED'; end if;

  select coalesce(sum(c.buyout_credit_amount),0)
    into v_paid_credit
  from public.equipment_lease_charges c
  where c.contract_id=v_contract.id and c.status='PAID';
  v_remaining:=greatest(v_contract.buyout_price-v_paid_credit,0);
  if v_remaining<=0.009 then raise exception 'BUYOUT_ALREADY_FUNDED'; end if;
  if p_amount>v_remaining+0.009 then raise exception 'BUYOUT_PAYMENT_EXCEEDS_REMAINING'; end if;

  v_actor:=public.current_staff_user_id();
  insert into public.equipment_lease_charges(
    contract_id,partner_id,charge_type,amount,buyout_credit_amount,status,currency,notes,generated_by
  ) values(
    v_contract.id,v_contract.partner_id,'BUYOUT_EXTRA',round(p_amount,2),round(p_amount,2),
    'DRAFT',v_contract.currency,nullif(trim(coalesce(p_notes,'')),''),v_actor
  ) returning * into v_charge;

  return v_charge;
end
$$;
revoke all on function public.record_equipment_buyout_payment(uuid,numeric,text) from public,anon;
grant execute on function public.record_equipment_buyout_payment(uuid,numeric,text) to authenticated;

create or replace function public.set_equipment_lease_charge_status(
  p_charge_id uuid,
  p_status text,
  p_payment_reference text default null,
  p_notes text default null
) returns public.equipment_lease_charges
language plpgsql
security definer
set search_path=public
as $$
declare
  v_target text:=upper(trim(coalesce(p_status,'')));
  v_charge public.equipment_lease_charges;
  v_actor uuid;
  v_contract public.equipment_contracts;
  v_paid_credit numeric;
  v_remaining numeric;
begin
  if not public.has_permission('production.buyout.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if v_target not in ('APPROVED','PAID','CANCELLED') then raise exception 'INVALID_STATUS'; end if;

  select * into v_charge from public.equipment_lease_charges where id=p_charge_id for update;
  if v_charge.id is null then raise exception 'LEASE_CHARGE_NOT_FOUND'; end if;
  select * into v_contract from public.equipment_contracts where id=v_charge.contract_id for update;
  v_actor:=public.current_staff_user_id();

  if v_target='APPROVED' then
    if v_charge.status<>'DRAFT' then raise exception 'INVALID_TRANSITION'; end if;
  elsif v_target='PAID' then
    if v_charge.status<>'APPROVED' then raise exception 'INVALID_TRANSITION'; end if;
    if nullif(trim(coalesce(p_payment_reference,'')),'') is null then raise exception 'PAYMENT_REFERENCE_REQUIRED'; end if;
    if v_charge.charge_type='BUYOUT_EXTRA' then
      select coalesce(sum(c.buyout_credit_amount),0)
        into v_paid_credit
      from public.equipment_lease_charges c
      where c.contract_id=v_charge.contract_id and c.status='PAID' and c.id<>v_charge.id;
      v_remaining:=greatest(coalesce(v_contract.buyout_price,0)-v_paid_credit,0);
      if v_charge.buyout_credit_amount>v_remaining+0.009 then raise exception 'BUYOUT_PAYMENT_EXCEEDS_REMAINING'; end if;
    end if;
  elsif v_target='CANCELLED' then
    if v_charge.status='PAID' then raise exception 'INVALID_TRANSITION'; end if;
  end if;

  update public.equipment_lease_charges
  set status=v_target,
      approved_by=case when v_target='APPROVED' then v_actor else approved_by end,
      approved_at=case when v_target='APPROVED' then clock_timestamp() else approved_at end,
      paid_by=case when v_target='PAID' then v_actor else paid_by end,
      paid_at=case when v_target='PAID' then clock_timestamp() else paid_at end,
      payment_reference=case when v_target='PAID' then trim(p_payment_reference) else payment_reference end,
      notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes)
  where id=v_charge.id
  returning * into v_charge;

  return v_charge;
end
$$;
revoke all on function public.set_equipment_lease_charge_status(uuid,text,text,text) from public,anon;
grant execute on function public.set_equipment_lease_charge_status(uuid,text,text,text) to authenticated;

create or replace view public.equipment_buyout_overview
with (security_invoker=true)
as
select
  c.id as contract_id,
  c.partner_id,
  p.name as partner_name,
  c.contract_number,
  c.contract_type,
  c.status,
  c.starts_on,
  c.ends_on,
  c.currency,
  c.lease_period_amount,
  c.buyout_enabled,
  c.buyout_price,
  c.buyout_credit_percent,
  c.buyout_completed_at,
  c.buyout_transfer_reference,
  count(distinct ca.equipment_id)::integer as equipment_count,
  coalesce(sum(ch.amount) filter(where ch.status='PAID'),0)::numeric(14,2) as total_paid,
  coalesce(sum(ch.amount) filter(where ch.status='PAID' and ch.charge_type='LEASE'),0)::numeric(14,2) as lease_paid,
  coalesce(sum(ch.amount) filter(where ch.status='PAID' and ch.charge_type='BUYOUT_EXTRA'),0)::numeric(14,2) as extra_buyout_paid,
  coalesce(sum(ch.buyout_credit_amount) filter(where ch.status='PAID'),0)::numeric(14,2) as buyout_credited,
  greatest(coalesce(c.buyout_price,0)-coalesce(sum(ch.buyout_credit_amount) filter(where ch.status='PAID'),0),0)::numeric(14,2) as buyout_remaining,
  max(ch.paid_at) filter(where ch.status='PAID') as last_paid_at
from public.equipment_contracts c
join public.partners p on p.id=c.partner_id
left join public.equipment_contract_assets ca on ca.contract_id=c.id
left join public.equipment_lease_charges ch on ch.contract_id=c.id
where c.contract_type in ('LEASE','LEASE_BUYOUT')
group by c.id,p.id;

grant select on public.equipment_buyout_overview to authenticated;

create or replace function public.complete_equipment_buyout(
  p_contract_id uuid,
  p_transfer_reference text,
  p_notes text default null
) returns public.equipment_contracts
language plpgsql
security definer
set search_path=public
as $$
declare
  v_contract public.equipment_contracts;
  v_credit numeric;
  v_actor uuid;
  v_asset_count integer;
begin
  if not public.has_permission('production.buyout.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if nullif(trim(coalesce(p_transfer_reference,'')),'') is null then raise exception 'TRANSFER_REFERENCE_REQUIRED'; end if;

  select * into v_contract from public.equipment_contracts where id=p_contract_id for update;
  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if v_contract.contract_type<>'LEASE_BUYOUT' or not v_contract.buyout_enabled then raise exception 'BUYOUT_NOT_ENABLED'; end if;
  if v_contract.status<>'ACTIVE' then raise exception 'CONTRACT_NOT_ACTIVE'; end if;
  if coalesce(v_contract.buyout_price,0)<=0 then raise exception 'BUYOUT_PRICE_REQUIRED'; end if;

  select coalesce(sum(c.buyout_credit_amount),0) into v_credit
  from public.equipment_lease_charges c
  where c.contract_id=v_contract.id and c.status='PAID';
  if v_credit+0.009<v_contract.buyout_price then raise exception 'BUYOUT_NOT_FULLY_PAID'; end if;

  select count(*) into v_asset_count from public.equipment_contract_assets ca where ca.contract_id=v_contract.id;
  if v_asset_count=0 then raise exception 'CONTRACT_HAS_NO_EQUIPMENT'; end if;
  if exists(
    select 1
    from public.equipment_contract_assets ca
    join public.equipment_assets a on a.id=ca.equipment_id
    where ca.contract_id=v_contract.id and a.current_owner_partner_id is distinct from v_contract.partner_id
  ) then raise exception 'EQUIPMENT_OWNER_MISMATCH'; end if;

  v_actor:=public.current_staff_user_id();

  update public.equipment_assets a
  set ownership_type='HUB',current_owner_partner_id=null
  where a.id in(select ca.equipment_id from public.equipment_contract_assets ca where ca.contract_id=v_contract.id);

  update public.equipment_ownership_history h
  set reason=coalesce(nullif(trim(coalesce(p_notes,'')),''),'Выкуп по договору '||v_contract.contract_number)
  where h.valid_to is null
    and h.equipment_id in(select ca.equipment_id from public.equipment_contract_assets ca where ca.contract_id=v_contract.id)
    and h.ownership_type='HUB';

  update public.equipment_contract_assets ca
  set ends_on=case when ca.starts_on is null or ca.starts_on<=current_date then current_date else ca.ends_on end
  where ca.contract_id=v_contract.id and (ca.ends_on is null or ca.ends_on>current_date);

  update public.equipment_contracts
  set status='COMPLETED',
      ends_on=case when starts_on<=current_date then current_date else ends_on end,
      buyout_completed_at=clock_timestamp(),
      buyout_completed_by=v_actor,
      buyout_transfer_reference=trim(p_transfer_reference),
      notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes)
  where id=v_contract.id
  returning * into v_contract;

  return v_contract;
end
$$;
revoke all on function public.complete_equipment_buyout(uuid,text,text) from public,anon;
grant execute on function public.complete_equipment_buyout(uuid,text,text) to authenticated;
