-- A4PRINT HUB: atomic management API for production-farm ownership and contracts.
-- Critical multi-table changes are kept server-side and permission checked.

create or replace function public.save_equipment_ownership(
  p_equipment_id uuid,
  p_ownership_type text,
  p_owner_partner_id uuid,
  p_operational_status text,
  p_manufacture_year integer default null,
  p_market_value numeric default null,
  p_received_at date default null,
  p_commissioned_at date default null,
  p_internal_hour_cost numeric default null,
  p_production_hour_price numeric default null,
  p_average_power_kw numeric default null,
  p_max_power_kw numeric default null,
  p_electricity_tariff numeric default null,
  p_electricity_as_direct_cost boolean default true,
  p_analogue_purchase_price numeric default null,
  p_buy_replacement_warning_percent numeric default 80,
  p_reason text default null
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_old_ownership text;
  v_old_partner uuid;
begin
  if not public.has_permission('equipment.ownership.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;

  select ownership_type,current_owner_partner_id
    into v_old_ownership,v_old_partner
    from public.equipment_assets
   where id=p_equipment_id
   for update;

  if not found then raise exception 'EQUIPMENT_NOT_FOUND'; end if;
  if p_ownership_type not in ('HUB','PARTNER','LEASE','LEASE_BUYOUT','OTHER') then raise exception 'INVALID_OWNERSHIP_TYPE'; end if;
  if p_operational_status not in ('FREE','WORKING','QUEUED','MAINTENANCE','REPAIR','FAULT','WAITING_PARTS','OFFLINE','RETIRED') then raise exception 'INVALID_OPERATIONAL_STATUS'; end if;

  update public.equipment_assets set
    ownership_type=p_ownership_type,
    current_owner_partner_id=p_owner_partner_id,
    operational_status=p_operational_status,
    manufacture_year=p_manufacture_year,
    market_value=p_market_value,
    received_at=p_received_at,
    commissioned_at=p_commissioned_at,
    internal_hour_cost=p_internal_hour_cost,
    production_hour_price=p_production_hour_price,
    average_power_kw=p_average_power_kw,
    max_power_kw=p_max_power_kw,
    electricity_tariff=p_electricity_tariff,
    electricity_as_direct_cost=coalesce(p_electricity_as_direct_cost,true),
    analogue_purchase_price=p_analogue_purchase_price,
    buy_replacement_warning_percent=coalesce(p_buy_replacement_warning_percent,80)
  where id=p_equipment_id;

  if (v_old_ownership is distinct from p_ownership_type or v_old_partner is distinct from p_owner_partner_id)
     and nullif(btrim(coalesce(p_reason,'')),'') is not null then
    update public.equipment_ownership_history
       set reason=btrim(p_reason)
     where id=(
       select h.id from public.equipment_ownership_history h
       where h.equipment_id=p_equipment_id and h.valid_to is null
       order by h.valid_from desc limit 1
     );
  end if;

  return p_equipment_id;
end
$$;

revoke all on function public.save_equipment_ownership(uuid,text,uuid,text,integer,numeric,date,date,numeric,numeric,numeric,numeric,numeric,boolean,numeric,numeric,text) from public,anon;
grant execute on function public.save_equipment_ownership(uuid,text,uuid,text,integer,numeric,date,date,numeric,numeric,numeric,numeric,numeric,boolean,numeric,numeric,text) to authenticated;

create or replace function public.save_equipment_contract(
  p_contract_id uuid,
  p_partner_id uuid,
  p_contract_number text,
  p_contract_type text,
  p_status text,
  p_starts_on date,
  p_ends_on date,
  p_hub_share_percent numeric,
  p_owner_share_percent numeric,
  p_calculation_basis text,
  p_direct_costs_before_split boolean,
  p_settlement_frequency text,
  p_settlement_day integer,
  p_repair_responsibility text,
  p_early_termination_notice_days integer,
  p_buyout_enabled boolean,
  p_buyout_price numeric,
  p_currency text,
  p_notes text,
  p_equipment_ids uuid[]
) returns uuid
language plpgsql
security definer
set search_path=public
as $$
declare
  v_id uuid;
  v_equipment_id uuid;
begin
  if not public.has_permission('equipment.contracts.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_partner_id is null then raise exception 'PARTNER_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_contract_number,'')),'') is null then raise exception 'CONTRACT_NUMBER_REQUIRED'; end if;
  if p_contract_type not in ('REVENUE_SHARE','LEASE','LEASE_BUYOUT','LOAN_FOR_USE','OTHER') then raise exception 'INVALID_CONTRACT_TYPE'; end if;
  if p_status not in ('DRAFT','ACTIVE','SUSPENDED','TERMINATED','COMPLETED') then raise exception 'INVALID_CONTRACT_STATUS'; end if;
  if p_starts_on is null then raise exception 'CONTRACT_START_REQUIRED'; end if;
  if p_ends_on is not null and p_ends_on<p_starts_on then raise exception 'INVALID_CONTRACT_DATES'; end if;
  if p_contract_type='REVENUE_SHARE' and abs(coalesce(p_hub_share_percent,0)+coalesce(p_owner_share_percent,0)-100)>0.001 then raise exception 'SHARES_MUST_TOTAL_100'; end if;
  if coalesce(p_buyout_enabled,false) and p_buyout_price is null then raise exception 'BUYOUT_PRICE_REQUIRED'; end if;

  if p_contract_id is null then
    insert into public.equipment_contracts(
      partner_id,contract_number,contract_type,status,starts_on,ends_on,
      hub_share_percent,owner_share_percent,calculation_basis,direct_costs_before_split,
      settlement_frequency,settlement_day,repair_responsibility,early_termination_notice_days,
      buyout_enabled,buyout_price,currency,notes,created_by
    ) values(
      p_partner_id,btrim(p_contract_number),p_contract_type,p_status,p_starts_on,p_ends_on,
      coalesce(p_hub_share_percent,70),coalesce(p_owner_share_percent,30),p_calculation_basis,coalesce(p_direct_costs_before_split,false),
      p_settlement_frequency,p_settlement_day,p_repair_responsibility,coalesce(p_early_termination_notice_days,30),
      coalesce(p_buyout_enabled,false),p_buyout_price,coalesce(nullif(upper(btrim(p_currency)),''),'RUB'),nullif(btrim(coalesce(p_notes,'')),''),public.current_staff_user_id()
    ) returning id into v_id;
  else
    update public.equipment_contracts set
      partner_id=p_partner_id,contract_number=btrim(p_contract_number),contract_type=p_contract_type,status=p_status,
      starts_on=p_starts_on,ends_on=p_ends_on,hub_share_percent=coalesce(p_hub_share_percent,70),owner_share_percent=coalesce(p_owner_share_percent,30),
      calculation_basis=p_calculation_basis,direct_costs_before_split=coalesce(p_direct_costs_before_split,false),
      settlement_frequency=p_settlement_frequency,settlement_day=p_settlement_day,repair_responsibility=p_repair_responsibility,
      early_termination_notice_days=coalesce(p_early_termination_notice_days,30),buyout_enabled=coalesce(p_buyout_enabled,false),
      buyout_price=p_buyout_price,currency=coalesce(nullif(upper(btrim(p_currency)),''),'RUB'),notes=nullif(btrim(coalesce(p_notes,'')),'')
    where id=p_contract_id;
    if not found then raise exception 'CONTRACT_NOT_FOUND'; end if;
    v_id:=p_contract_id;
  end if;

  delete from public.equipment_contract_assets where contract_id=v_id;
  foreach v_equipment_id in array coalesce(p_equipment_ids,'{}'::uuid[]) loop
    if not exists(select 1 from public.equipment_assets a where a.id=v_equipment_id) then raise exception 'EQUIPMENT_NOT_FOUND: %',v_equipment_id; end if;
    insert into public.equipment_contract_assets(contract_id,equipment_id,starts_on,ends_on)
    values(v_id,v_equipment_id,p_starts_on,p_ends_on)
    on conflict(contract_id,equipment_id) do nothing;
  end loop;

  return v_id;
end
$$;

revoke all on function public.save_equipment_contract(uuid,uuid,text,text,text,date,date,numeric,numeric,text,boolean,text,integer,text,integer,boolean,numeric,text,text,uuid[]) from public,anon;
grant execute on function public.save_equipment_contract(uuid,uuid,text,text,text,date,date,numeric,numeric,text,boolean,text,integer,text,integer,boolean,numeric,text,text,uuid[]) to authenticated;
