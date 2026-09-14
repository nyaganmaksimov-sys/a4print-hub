-- Production Farm phase 5 hardening: immutable buyout economics, correct aggregate view
-- and safe ownership transfer boundaries.

create or replace function public.validate_equipment_buyout_contract()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_paid_credit numeric;
begin
  if new.contract_type='LEASE_BUYOUT' then
    new.buyout_enabled:=true;
    if new.status='ACTIVE' and coalesce(new.buyout_price,0)<=0 then
      raise exception 'BUYOUT_PRICE_REQUIRED';
    end if;
  end if;

  if old.buyout_completed_at is not null and (
    new.partner_id is distinct from old.partner_id
    or new.contract_type is distinct from old.contract_type
    or new.buyout_enabled is distinct from old.buyout_enabled
    or new.buyout_price is distinct from old.buyout_price
    or new.buyout_credit_percent is distinct from old.buyout_credit_percent
    or new.lease_period_amount is distinct from old.lease_period_amount
    or new.status is distinct from old.status
  ) then
    raise exception 'BUYOUT_COMPLETED_LOCKED';
  end if;

  if new.buyout_enabled and new.buyout_price is not null and new.buyout_price is distinct from old.buyout_price then
    select coalesce(sum(c.buyout_credit_amount),0)
      into v_paid_credit
    from public.equipment_lease_charges c
    where c.contract_id=old.id and c.status='PAID';
    if v_paid_credit>new.buyout_price+0.009 then
      raise exception 'BUYOUT_PRICE_BELOW_PAID_CREDIT';
    end if;
  end if;

  return new;
end
$$;
revoke all on function public.validate_equipment_buyout_contract() from public,anon,authenticated;

drop trigger if exists trg_validate_equipment_buyout_contract on public.equipment_contracts;
create trigger trg_validate_equipment_buyout_contract
before update of partner_id,contract_type,status,buyout_enabled,buyout_price,buyout_credit_percent,lease_period_amount
on public.equipment_contracts
for each row execute function public.validate_equipment_buyout_contract();

-- Avoid multiplying paid charges by the number of assets attached to the contract.
drop view if exists public.equipment_buyout_overview;
create view public.equipment_buyout_overview
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
  coalesce(a.equipment_count,0)::integer as equipment_count,
  coalesce(ch.total_paid,0)::numeric(14,2) as total_paid,
  coalesce(ch.lease_paid,0)::numeric(14,2) as lease_paid,
  coalesce(ch.extra_buyout_paid,0)::numeric(14,2) as extra_buyout_paid,
  coalesce(ch.buyout_credited,0)::numeric(14,2) as buyout_credited,
  greatest(coalesce(c.buyout_price,0)-coalesce(ch.buyout_credited,0),0)::numeric(14,2) as buyout_remaining,
  ch.last_paid_at
from public.equipment_contracts c
join public.partners p on p.id=c.partner_id
left join lateral(
  select count(*)::integer as equipment_count
  from public.equipment_contract_assets ca
  where ca.contract_id=c.id
) a on true
left join lateral(
  select
    coalesce(sum(x.amount) filter(where x.status='PAID'),0) as total_paid,
    coalesce(sum(x.amount) filter(where x.status='PAID' and x.charge_type='LEASE'),0) as lease_paid,
    coalesce(sum(x.amount) filter(where x.status='PAID' and x.charge_type='BUYOUT_EXTRA'),0) as extra_buyout_paid,
    coalesce(sum(x.buyout_credit_amount) filter(where x.status='PAID'),0) as buyout_credited,
    max(x.paid_at) filter(where x.status='PAID') as last_paid_at
  from public.equipment_lease_charges x
  where x.contract_id=c.id
) ch on true
where c.contract_type in ('LEASE','LEASE_BUYOUT');

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

  select count(*) into v_asset_count
  from public.equipment_contract_assets ca
  where ca.contract_id=v_contract.id;
  if v_asset_count=0 then raise exception 'CONTRACT_HAS_NO_EQUIPMENT'; end if;

  if exists(
    select 1
    from public.equipment_contract_assets ca
    join public.equipment_assets a on a.id=ca.equipment_id
    where ca.contract_id=v_contract.id
      and a.current_owner_partner_id is distinct from v_contract.partner_id
  ) then raise exception 'EQUIPMENT_OWNER_MISMATCH'; end if;

  if exists(
    select 1
    from public.equipment_contract_assets ca
    join public.production_jobs j on j.equipment_id=ca.equipment_id
    where ca.contract_id=v_contract.id and j.status in ('IN_PROGRESS','PAUSED')
  ) then raise exception 'EQUIPMENT_HAS_OPEN_PRODUCTION'; end if;

  v_actor:=public.current_staff_user_id();

  update public.equipment_assets a
  set ownership_type='HUB',current_owner_partner_id=null
  where a.id in(
    select ca.equipment_id
    from public.equipment_contract_assets ca
    where ca.contract_id=v_contract.id
  );

  update public.equipment_ownership_history h
  set reason=coalesce(nullif(trim(coalesce(p_notes,'')),''),'Выкуп по договору '||v_contract.contract_number)
  where h.valid_to is null
    and h.equipment_id in(
      select ca.equipment_id
      from public.equipment_contract_assets ca
      where ca.contract_id=v_contract.id
    )
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
