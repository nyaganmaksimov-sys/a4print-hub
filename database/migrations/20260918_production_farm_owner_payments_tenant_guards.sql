-- A4PRINT HUB: Production Farm Phase 34 — tenant guards for owner payments and deadlines.
-- Generated from verified live definitions after phase34_owner_payments_tenant_guards.
-- Preserves private core equipment tenant guards from the current main tenant layer.

CREATE OR REPLACE FUNCTION public.equipment_payment_contract_tenant_org(p_contract_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_contract_org uuid;
  v_user_org uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_contract_id is null then raise exception 'CONTRACT_REQUIRED'; end if;

  select c.organization_id into v_contract_org
  from public.equipment_contracts c
  where c.id=p_contract_id;

  if not found then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if v_contract_org is null then raise exception 'CONTRACT_ORGANIZATION_REQUIRED'; end if;

  v_user_org:=public.current_user_organization_id();
  if v_user_org is null then raise exception 'ORGANIZATION_CONTEXT_REQUIRED'; end if;
  if v_contract_org is distinct from v_user_org then
    raise exception 'CONTRACT_NOT_AVAILABLE';
  end if;

  return v_contract_org;
end
$function$;

CREATE OR REPLACE FUNCTION public.generate_equipment_owner_settlement(p_contract_id uuid, p_period_start date, p_period_end date)
 RETURNS equipment_owner_settlements
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_contract public.equipment_contracts;
  v_settlement public.equipment_owner_settlements;
  v_actor uuid;
  v_org uuid;
begin
  perform private.assert_equipment_contract_tenant(p_contract_id);
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('production.settlements.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start then
    raise exception 'INVALID_PERIOD';
  end if;

  v_org:=public.equipment_payment_contract_tenant_org(p_contract_id);

  select * into v_contract
  from public.equipment_contracts
  where id=p_contract_id
  for update;
  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if v_contract.organization_id is distinct from v_org then raise exception 'CONTRACT_NOT_AVAILABLE'; end if;
  if v_contract.contract_type<>'REVENUE_SHARE' then
    raise exception 'SETTLEMENT_CONTRACT_TYPE_UNSUPPORTED';
  end if;
  if v_contract.status not in ('ACTIVE','COMPLETED') then
    raise exception 'CONTRACT_NOT_ACTIVE';
  end if;
  if p_period_start<v_contract.starts_on
     or (v_contract.ends_on is not null and p_period_end>v_contract.ends_on) then
    raise exception 'PERIOD_OUTSIDE_CONTRACT';
  end if;

  if exists(
    select 1
    from public.equipment_owner_settlements s
    where s.contract_id=v_contract.id
      and s.status<>'CANCELLED'
      and daterange(s.period_start,s.period_end,'[]') && daterange(p_period_start,p_period_end,'[]')
      and not(
        s.period_start=p_period_start
        and s.period_end=p_period_end
        and s.status='DRAFT'
      )
  ) then raise exception 'SETTLEMENT_PERIOD_OVERLAP'; end if;

  v_actor:=public.current_staff_user_id();

  insert into public.equipment_owner_settlements(
    contract_id,partner_id,period_start,period_end,status,calculation_basis,
    owner_share_percent,hub_share_percent,direct_costs_before_split,currency,generated_by
  ) values(
    v_contract.id,v_contract.partner_id,p_period_start,p_period_end,'DRAFT',
    v_contract.calculation_basis,v_contract.owner_share_percent,v_contract.hub_share_percent,
    v_contract.direct_costs_before_split,v_contract.currency,v_actor
  )
  on conflict(contract_id,period_start,period_end) do update
  set partner_id=excluded.partner_id,
      calculation_basis=excluded.calculation_basis,
      owner_share_percent=excluded.owner_share_percent,
      hub_share_percent=excluded.hub_share_percent,
      direct_costs_before_split=excluded.direct_costs_before_split,
      currency=excluded.currency,
      generated_by=excluded.generated_by,
      generated_at=clock_timestamp()
  where public.equipment_owner_settlements.status='DRAFT'
  returning * into v_settlement;

  if v_settlement.id is null or v_settlement.status<>'DRAFT' then
    raise exception 'SETTLEMENT_LOCKED';
  end if;

  delete from public.equipment_owner_settlement_lines
  where settlement_id=v_settlement.id;

  insert into public.equipment_owner_settlement_lines(
    settlement_id,production_job_id,equipment_id,order_id,completed_at,
    operation_revenue,received_revenue,direct_costs,split_base,owner_amount,hub_amount
  )
  select
    v_settlement.id,j.id,j.equipment_id,j.order_id,j.completed_at,
    round(greatest(coalesce(j.operation_amount,0),0),2),
    round(case
      when j.order_id is null or greatest(coalesce(j.operation_amount,0),0)=0 then 0
      else least(
        greatest(coalesce(j.operation_amount,0),0),
        greatest(coalesce(pay.net_received,0),0)*greatest(coalesce(j.operation_amount,0),0)
          / greatest(coalesce(o.total,0),coalesce(op.order_operations,0),0.01)
      )
    end,2),
    round(greatest(coalesce(j.production_cost,0),0),2),
    0,0,0
  from public.production_jobs j
  join public.equipment_contract_assets ca
    on ca.contract_id=v_contract.id
   and ca.equipment_id=j.equipment_id
  left join public.orders o on o.id=j.order_id
  left join lateral(
    select coalesce(sum(case
      when p.status='PAID' and p.payment_type='INCOME' then p.amount
      when p.status='PAID' and p.payment_type='REFUND' then -p.amount
      else 0 end),0) as net_received
    from public.payments p
    where p.order_id=j.order_id
  ) pay on true
  left join lateral(
    select coalesce(sum(greatest(coalesce(j2.operation_amount,0),0)),0) as order_operations
    from public.production_jobs j2
    where j2.order_id=j.order_id
      and j2.status<>'CANCELLED'
  ) op on true
  where j.status='DONE'
    and j.completed_at is not null
    and j.completed_at::date between p_period_start and p_period_end
    and (ca.starts_on is null or j.completed_at::date>=ca.starts_on)
    and (ca.ends_on is null or j.completed_at::date<=ca.ends_on)
    and j.completed_at::date>=v_contract.starts_on
    and (v_contract.ends_on is null or j.completed_at::date<=v_contract.ends_on)
    and not exists(
      select 1
      from public.equipment_owner_settlement_lines old_l
      join public.equipment_owner_settlements old_s on old_s.id=old_l.settlement_id
      where old_l.production_job_id=j.id
        and old_s.id<>v_settlement.id
        and old_s.status in('APPROVED','PAID')
    );

  update public.equipment_owner_settlement_lines l
  set split_base=round(greatest(0,
    (case v_contract.calculation_basis
      when 'RECEIVED_REVENUE' then l.received_revenue
      when 'OPERATION_REVENUE' then l.operation_revenue
      when 'NET_AFTER_DIRECT_COSTS' then l.operation_revenue
      else l.operation_revenue end)
    - case
        when v_contract.calculation_basis='NET_AFTER_DIRECT_COSTS'
          or v_contract.direct_costs_before_split
        then l.direct_costs
        else 0
      end
  ),2)
  where l.settlement_id=v_settlement.id;

  update public.equipment_owner_settlement_lines l
  set owner_amount=round(l.split_base*v_contract.owner_share_percent/100.0,2),
      hub_amount=round(l.split_base-(l.split_base*v_contract.owner_share_percent/100.0),2)
  where l.settlement_id=v_settlement.id;

  update public.equipment_owner_settlements s
  set gross_revenue=x.gross_revenue,
      received_revenue=x.received_revenue,
      direct_costs=x.direct_costs,
      split_base=x.split_base,
      owner_amount=x.owner_amount,
      hub_amount=x.hub_amount,
      owner_share_percent=v_contract.owner_share_percent,
      hub_share_percent=v_contract.hub_share_percent,
      direct_costs_before_split=v_contract.direct_costs_before_split,
      generated_at=clock_timestamp()
  from(
    select
      coalesce(sum(operation_revenue),0)::numeric gross_revenue,
      coalesce(sum(received_revenue),0)::numeric received_revenue,
      coalesce(sum(direct_costs),0)::numeric direct_costs,
      coalesce(sum(split_base),0)::numeric split_base,
      coalesce(sum(owner_amount),0)::numeric owner_amount,
      coalesce(sum(hub_amount),0)::numeric hub_amount
    from public.equipment_owner_settlement_lines
    where settlement_id=v_settlement.id
  ) x
  where s.id=v_settlement.id
  returning s.* into v_settlement;

  return v_settlement;
end
$function$;

CREATE OR REPLACE FUNCTION public.set_equipment_owner_settlement_status(p_settlement_id uuid, p_status text, p_payment_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS equipment_owner_settlements
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_target text:=upper(trim(coalesce(p_status,'')));
  v_row public.equipment_owner_settlements;
  v_actor uuid;
  v_org uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('production.settlements.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_target not in('APPROVED','PAID','CANCELLED') then
    raise exception 'INVALID_STATUS';
  end if;

  select * into v_row
  from public.equipment_owner_settlements
  where id=p_settlement_id
  for update;
  if v_row.id is null then raise exception 'SETTLEMENT_NOT_FOUND'; end if;

  v_org:=public.equipment_payment_contract_tenant_org(v_row.contract_id);

  v_actor:=public.current_staff_user_id();

  if v_target='APPROVED' then
    if v_row.status<>'DRAFT' then raise exception 'INVALID_TRANSITION'; end if;
    if not exists(
      select 1
      from public.equipment_owner_settlement_lines l
      where l.settlement_id=v_row.id
    ) then raise exception 'SETTLEMENT_HAS_NO_JOBS'; end if;
    if exists(
      select 1
      from public.equipment_owner_settlement_lines l
      join public.equipment_owner_settlement_lines other_l
        on other_l.production_job_id=l.production_job_id
       and other_l.settlement_id<>l.settlement_id
      join public.equipment_owner_settlements other_s
        on other_s.id=other_l.settlement_id
      where l.settlement_id=v_row.id
        and other_s.status in('APPROVED','PAID')
    ) then raise exception 'PRODUCTION_JOB_ALREADY_SETTLED'; end if;
  elsif v_target='PAID' then
    if v_row.status<>'APPROVED' then raise exception 'INVALID_TRANSITION'; end if;
    if v_row.owner_amount>0
       and nullif(trim(coalesce(p_payment_reference,'')),'') is null then
      raise exception 'PAYMENT_REFERENCE_REQUIRED';
    end if;
  elsif v_target='CANCELLED' then
    if v_row.status='PAID' then raise exception 'INVALID_TRANSITION'; end if;
  end if;

  update public.equipment_owner_settlements
  set status=v_target,
      approved_by=case when v_target='APPROVED' then v_actor else approved_by end,
      approved_at=case when v_target='APPROVED' then clock_timestamp() else approved_at end,
      paid_by=case when v_target='PAID' then v_actor else paid_by end,
      paid_at=case when v_target='PAID' then clock_timestamp() else paid_at end,
      payment_reference=case
        when v_target='PAID' then nullif(trim(p_payment_reference),'')
        else payment_reference
      end,
      notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes)
  where id=p_settlement_id
  returning * into v_row;

  return v_row;
end
$function$;

CREATE OR REPLACE FUNCTION public.generate_equipment_lease_charge(p_contract_id uuid, p_period_start date, p_period_end date, p_notes text DEFAULT NULL::text)
 RETURNS equipment_lease_charges
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_contract public.equipment_contracts;
  v_charge public.equipment_lease_charges;
  v_actor uuid;
  v_credit numeric;
  v_org uuid;
begin
  perform private.assert_equipment_contract_tenant(p_contract_id);
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('production.buyout.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if p_period_start is null or p_period_end is null or p_period_end<p_period_start then
    raise exception 'INVALID_PERIOD';
  end if;

  v_org:=public.equipment_payment_contract_tenant_org(p_contract_id);

  select * into v_contract
  from public.equipment_contracts
  where id=p_contract_id
  for update;
  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if v_contract.organization_id is distinct from v_org then raise exception 'CONTRACT_NOT_AVAILABLE'; end if;
  if v_contract.contract_type not in ('LEASE','LEASE_BUYOUT') then
    raise exception 'LEASE_CONTRACT_TYPE_REQUIRED';
  end if;
  if v_contract.status<>'ACTIVE' then raise exception 'CONTRACT_NOT_ACTIVE'; end if;
  if coalesce(v_contract.lease_period_amount,0)<=0 then
    raise exception 'LEASE_TERMS_NOT_CONFIGURED';
  end if;
  if p_period_start<v_contract.starts_on
     or (v_contract.ends_on is not null and p_period_end>v_contract.ends_on) then
    raise exception 'PERIOD_OUTSIDE_CONTRACT';
  end if;

  if exists(
    select 1
    from public.equipment_lease_charges c
    where c.contract_id=v_contract.id
      and c.charge_type='LEASE'
      and c.status<>'CANCELLED'
      and daterange(c.period_start,c.period_end,'[]')
          && daterange(p_period_start,p_period_end,'[]')
  ) then raise exception 'LEASE_PERIOD_OVERLAP'; end if;

  v_actor:=public.current_staff_user_id();
  v_credit:=case
    when v_contract.buyout_enabled
    then round(v_contract.lease_period_amount*coalesce(v_contract.buyout_credit_percent,0)/100.0,2)
    else 0
  end;

  insert into public.equipment_lease_charges(
    contract_id,partner_id,charge_type,period_start,period_end,amount,
    buyout_credit_amount,status,currency,notes,generated_by
  ) values(
    v_contract.id,v_contract.partner_id,'LEASE',p_period_start,p_period_end,
    round(v_contract.lease_period_amount,2),v_credit,'DRAFT',v_contract.currency,
    nullif(trim(coalesce(p_notes,'')),''),v_actor
  )
  returning * into v_charge;

  return v_charge;
end
$function$;

CREATE OR REPLACE FUNCTION public.set_equipment_lease_charge_status(p_charge_id uuid, p_status text, p_payment_reference text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS equipment_lease_charges
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_target text:=upper(trim(coalesce(p_status,'')));
  v_charge public.equipment_lease_charges;
  v_actor uuid;
  v_contract public.equipment_contracts;
  v_paid_credit numeric;
  v_remaining numeric;
  v_org uuid;
begin
  perform private.assert_equipment_contract_child_tenant('LEASE_CHARGE',p_charge_id);
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('production.buyout.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;
  if v_target not in ('APPROVED','PAID','CANCELLED') then
    raise exception 'INVALID_STATUS';
  end if;

  select * into v_charge
  from public.equipment_lease_charges
  where id=p_charge_id
  for update;
  if v_charge.id is null then raise exception 'LEASE_CHARGE_NOT_FOUND'; end if;

  v_org:=public.equipment_payment_contract_tenant_org(v_charge.contract_id);

  select * into v_contract
  from public.equipment_contracts
  where id=v_charge.contract_id
  for update;
  if v_contract.organization_id is distinct from v_org then raise exception 'CONTRACT_NOT_AVAILABLE'; end if;

  v_actor:=public.current_staff_user_id();

  if v_target='APPROVED' then
    if v_charge.status<>'DRAFT' then raise exception 'INVALID_TRANSITION'; end if;
  elsif v_target='PAID' then
    if v_charge.status<>'APPROVED' then raise exception 'INVALID_TRANSITION'; end if;
    if nullif(trim(coalesce(p_payment_reference,'')),'') is null then
      raise exception 'PAYMENT_REFERENCE_REQUIRED';
    end if;
    if v_charge.charge_type='BUYOUT_EXTRA' then
      select coalesce(sum(c.buyout_credit_amount),0)
        into v_paid_credit
      from public.equipment_lease_charges c
      where c.contract_id=v_charge.contract_id
        and c.status='PAID'
        and c.id<>v_charge.id;

      v_remaining:=greatest(coalesce(v_contract.buyout_price,0)-v_paid_credit,0);
      if v_charge.buyout_credit_amount>v_remaining+0.009 then
        raise exception 'BUYOUT_PAYMENT_EXCEEDS_REMAINING';
      end if;
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
      payment_reference=case
        when v_target='PAID' then trim(p_payment_reference)
        else payment_reference
      end,
      notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes)
  where id=v_charge.id
  returning * into v_charge;

  return v_charge;
end
$function$;

CREATE OR REPLACE FUNCTION public.set_equipment_payment_due_date(p_entity_type text, p_entity_id uuid, p_due_date date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_type text:=upper(btrim(coalesce(p_entity_type,'')));
  v_period_end date;
  v_status text;
  v_contract_id uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not (
    public.has_permission('production.settlements.manage')
    or public.has_permission('equipment.contracts.manage')
  ) then raise exception 'PERMISSION_DENIED'; end if;
  if v_type not in ('OWNER_SETTLEMENT','LEASE_CHARGE') then
    raise exception 'INVALID_ENTITY_TYPE';
  end if;
  if p_entity_id is null then raise exception 'ENTITY_REQUIRED'; end if;
  if p_due_date is null then raise exception 'DUE_DATE_REQUIRED'; end if;

  if v_type='OWNER_SETTLEMENT' then
    select contract_id,period_end,status
      into v_contract_id,v_period_end,v_status
    from public.equipment_owner_settlements
    where id=p_entity_id
    for update;

    if v_contract_id is null then raise exception 'ENTITY_NOT_FOUND'; end if;
    perform public.equipment_payment_contract_tenant_org(v_contract_id);

    if v_status='PAID' then raise exception 'PAYMENT_ALREADY_PAID'; end if;
    if p_due_date<v_period_end then raise exception 'PAYMENT_DUE_BEFORE_PERIOD_END'; end if;

    update public.equipment_owner_settlements
    set payment_due_date=p_due_date,
        deadline_source='MANUAL'
    where id=p_entity_id;
  else
    select contract_id,period_end,status
      into v_contract_id,v_period_end,v_status
    from public.equipment_lease_charges
    where id=p_entity_id
    for update;

    if v_contract_id is null then raise exception 'ENTITY_NOT_FOUND'; end if;
    perform public.equipment_payment_contract_tenant_org(v_contract_id);

    if v_status='PAID' then raise exception 'PAYMENT_ALREADY_PAID'; end if;
    if p_due_date<v_period_end then raise exception 'PAYMENT_DUE_BEFORE_PERIOD_END'; end if;

    update public.equipment_lease_charges
    set payment_due_date=p_due_date,
        deadline_source='MANUAL'
    where id=p_entity_id;
  end if;

  return p_entity_id;
end
$function$;

CREATE OR REPLACE FUNCTION public.list_equipment_payment_obligations(p_include_paid boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
  v_org uuid;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not (
    public.has_permission('production.settlements.view')
    or public.has_permission('production.settlements.manage')
    or public.has_permission('equipment.contracts.manage')
  ) then raise exception 'PERMISSION_DENIED'; end if;

  v_org:=public.current_user_organization_id();
  if v_org is null then raise exception 'ORGANIZATION_CONTEXT_REQUIRED'; end if;

  select coalesce(
    jsonb_agg(to_jsonb(x) order by x.payment_due_date nulls last,x.period_end desc),
    '[]'::jsonb
  )
  into v_result
  from (
    select
      'OWNER_SETTLEMENT'::text entity_type,
      s.id entity_id,
      s.partner_id,
      coalesce(p.legal_name,p.name) partner_name,
      s.contract_id,
      c.contract_number,
      s.period_start,
      s.period_end,
      s.owner_amount amount,
      s.currency,
      s.status,
      s.payment_due_date,
      s.deadline_source,
      case
        when s.status='PAID' then 'PAID'
        when s.payment_due_date is null then 'NO_DUE_DATE'
        when s.payment_due_date<current_date then 'OVERDUE'
        when s.payment_due_date=current_date then 'DUE_TODAY'
        when s.payment_due_date<=current_date+3 then 'DUE_SOON'
        else 'UPCOMING'
      end due_state,
      case
        when s.status<>'PAID' and s.payment_due_date<current_date
        then current_date-s.payment_due_date
        else 0
      end days_overdue,
      s.paid_at,
      s.payment_reference
    from public.equipment_owner_settlements s
    join public.equipment_contracts c on c.id=s.contract_id
    join public.partners p on p.id=s.partner_id
    where c.organization_id=v_org
      and (coalesce(p_include_paid,false) or s.status<>'PAID')

    union all

    select
      'LEASE_CHARGE'::text entity_type,
      l.id entity_id,
      l.partner_id,
      coalesce(p.legal_name,p.name) partner_name,
      l.contract_id,
      c.contract_number,
      l.period_start,
      l.period_end,
      l.amount,
      l.currency,
      l.status,
      l.payment_due_date,
      l.deadline_source,
      case
        when l.status='PAID' then 'PAID'
        when l.payment_due_date is null then 'NO_DUE_DATE'
        when l.payment_due_date<current_date then 'OVERDUE'
        when l.payment_due_date=current_date then 'DUE_TODAY'
        when l.payment_due_date<=current_date+3 then 'DUE_SOON'
        else 'UPCOMING'
      end due_state,
      case
        when l.status<>'PAID' and l.payment_due_date<current_date
        then current_date-l.payment_due_date
        else 0
      end days_overdue,
      l.paid_at,
      l.payment_reference
    from public.equipment_lease_charges l
    join public.equipment_contracts c on c.id=l.contract_id
    join public.partners p on p.id=l.partner_id
    where c.organization_id=v_org
      and (coalesce(p_include_paid,false) or l.status<>'PAID')
  ) x;

  return v_result;
end
$function$;

revoke all on function public.equipment_payment_contract_tenant_org(uuid)
  from public,anon,authenticated;

revoke all on function public.generate_equipment_owner_settlement(uuid,date,date)
  from public,anon,authenticated;
grant execute on function public.generate_equipment_owner_settlement(uuid,date,date)
  to authenticated;

revoke all on function public.set_equipment_owner_settlement_status(uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.set_equipment_owner_settlement_status(uuid,text,text,text)
  to authenticated;

revoke all on function public.generate_equipment_lease_charge(uuid,date,date,text)
  from public,anon,authenticated;
grant execute on function public.generate_equipment_lease_charge(uuid,date,date,text)
  to authenticated;

revoke all on function public.set_equipment_lease_charge_status(uuid,text,text,text)
  from public,anon,authenticated;
grant execute on function public.set_equipment_lease_charge_status(uuid,text,text,text)
  to authenticated;

revoke all on function public.set_equipment_payment_due_date(text,uuid,date)
  from public,anon,authenticated;
grant execute on function public.set_equipment_payment_due_date(text,uuid,date)
  to authenticated;

alter function public.list_equipment_payment_obligations(boolean) security invoker;
revoke all on function public.list_equipment_payment_obligations(boolean)
  from public,anon,authenticated;
grant execute on function public.list_equipment_payment_obligations(boolean)
  to authenticated;

drop policy if exists equipment_payment_deadline_events_staff_read
  on public.equipment_payment_deadline_events;
create policy equipment_payment_deadline_events_staff_read
on public.equipment_payment_deadline_events
for select to authenticated
using(
  (
    public.has_permission('production.settlements.view')
    or public.has_permission('production.settlements.manage')
    or public.has_permission('equipment.contracts.manage')
  )
  and (
    (
      entity_type='OWNER_SETTLEMENT'
      and exists(
        select 1
        from public.equipment_owner_settlements s
        join public.equipment_contracts c on c.id=s.contract_id
        where s.id=equipment_payment_deadline_events.entity_id
          and c.organization_id=public.current_user_organization_id()
      )
    )
    or
    (
      entity_type='LEASE_CHARGE'
      and exists(
        select 1
        from public.equipment_lease_charges l
        join public.equipment_contracts c on c.id=l.contract_id
        where l.id=equipment_payment_deadline_events.entity_id
          and c.organization_id=public.current_user_organization_id()
      )
    )
  )
);

CREATE OR REPLACE FUNCTION public.emit_equipment_payment_deadline_notifications()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  r record;
  v_kind text;
  v_event_id uuid;
  v_count integer:=0;
  v_title text;
  v_body text;
begin
  for r in
    select * from (
      select
        'OWNER_SETTLEMENT'::text entity_type,
        s.id entity_id,
        s.partner_id,
        coalesce(p.legal_name,p.name) partner_name,
        c.contract_number,
        c.organization_id,
        s.payment_due_date,
        s.owner_amount amount,
        s.currency
      from public.equipment_owner_settlements s
      join public.equipment_contracts c on c.id=s.contract_id
      join public.partners p on p.id=s.partner_id
      where s.status='APPROVED'
        and c.organization_id is not null
        and s.payment_due_date is not null
        and s.payment_due_date<=current_date+3

      union all

      select
        'LEASE_CHARGE'::text,
        l.id,
        l.partner_id,
        coalesce(p.legal_name,p.name),
        c.contract_number,
        c.organization_id,
        l.payment_due_date,
        l.amount,
        l.currency
      from public.equipment_lease_charges l
      join public.equipment_contracts c on c.id=l.contract_id
      join public.partners p on p.id=l.partner_id
      where l.status='APPROVED'
        and c.organization_id is not null
        and l.payment_due_date is not null
        and l.payment_due_date<=current_date+3
    ) q
  loop
    v_event_id:=null;
    v_kind:=case
      when r.payment_due_date<current_date then 'OVERDUE'
      when r.payment_due_date=current_date then 'DUE_TODAY'
      else 'DUE_SOON'
    end;

    insert into public.equipment_payment_deadline_events(
      entity_type,entity_id,partner_id,due_date,notice_kind
    )
    values(
      r.entity_type,r.entity_id,r.partner_id,r.payment_due_date,v_kind
    )
    on conflict(entity_type,entity_id,due_date,notice_kind) do nothing
    returning id into v_event_id;

    if v_event_id is null then continue; end if;

    v_count:=v_count+1;
    v_title:=case v_kind
      when 'OVERDUE' then 'Просрочена выплата владельцу'
      when 'DUE_TODAY' then 'Сегодня срок выплаты владельцу'
      else 'Приближается срок выплаты владельцу'
    end;
    v_body:=r.partner_name||
      ' · договор '||r.contract_number||
      ' · срок '||to_char(r.payment_due_date,'DD.MM.YYYY')||
      ' · '||trim(to_char(r.amount,'FM9999999990D00'))||
      ' '||r.currency;

    insert into public.notifications(
      user_id,title,body,type,entity_type,entity_id
    )
    select distinct
      u.id,
      v_title,
      v_body,
      case when v_kind='OVERDUE' then 'WARNING' else 'INFO' end,
      'EQUIPMENT_PAYMENT_DEADLINE',
      v_event_id
    from public.users u
    join public.organization_units ou on ou.id=u.organization_unit_id
    join public.user_roles ur on ur.user_id=u.id
    join public.roles ro on ro.id=ur.role_id
    left join public.role_permissions rp on rp.role_id=ro.id
    left join public.permissions pp on pp.id=rp.permission_id
    where u.is_active=true
      and ou.is_active=true
      and ou.organization_id=r.organization_id
      and (
        ro.name='ADMIN'
        or pp.code in('production.settlements.manage','equipment.contracts.manage')
      );
  end loop;

  return v_count;
end
$function$;

revoke all on function public.emit_equipment_payment_deadline_notifications()
  from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.touch_owner_settlement()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at=clock_timestamp();
  return new;
end
$function$;

revoke all on function public.touch_owner_settlement()
  from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.touch_equipment_lease_charge()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  new.updated_at:=clock_timestamp();
  return new;
end
$function$;

revoke all on function public.touch_equipment_lease_charge()
  from public,anon,authenticated;
