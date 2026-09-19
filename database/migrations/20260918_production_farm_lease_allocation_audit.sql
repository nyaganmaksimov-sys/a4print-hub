-- A4PRINT HUB: Production Farm Phase 44 — lease allocation audit, immutable snapshot and financial document.

-- Live migration: production_farm_lease_allocation_snapshot (20260918090340)
insert into public.document_types(name,code,description,requires_signature)
values(
  'Начисление аренды оборудования',
  'EQ_LEASE_CHARGE',
  'Утверждённое начисление аренды с фиксированной расшифровкой по оборудованию',
  false
)
on conflict(code) do update
set name=excluded.name,
    description=excluded.description,
    requires_signature=excluded.requires_signature;

alter table public.equipment_lease_charges
  add column if not exists allocation_snapshot jsonb,
  add column if not exists allocation_snapshot_at timestamptz,
  add column if not exists allocation_snapshot_by uuid references public.users(id) on delete set null,
  add column if not exists allocation_document_id uuid references public.documents(id) on delete restrict;

create or replace function private.build_equipment_lease_charge_allocation_snapshot(
  p_charge_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_charge public.equipment_lease_charges%rowtype;
  v_allocations jsonb;
  v_allocated_total numeric;
  v_credit_total numeric;
begin
  select * into v_charge
  from public.equipment_lease_charges
  where id=p_charge_id;

  if v_charge.id is null then raise exception 'LEASE_CHARGE_NOT_FOUND'; end if;
  if v_charge.charge_type<>'LEASE' then raise exception 'LEASE_CHARGE_REQUIRED'; end if;

  select
    coalesce(jsonb_agg(jsonb_build_object(
      'equipment_id',x.equipment_id,
      'inventory_number',a.inventory_number,
      'equipment_name',a.name,
      'brand',a.brand,
      'model',a.model,
      'serial_number',a.serial_number,
      'first_active_on',x.first_active_on,
      'last_active_on',x.last_active_on,
      'active_days',x.active_days,
      'period_count',x.period_count,
      'effective_weight',x.effective_weight,
      'total_effective_weight',x.total_effective_weight,
      'allocation_ratio',x.allocation_ratio,
      'allocated_amount',x.allocated_amount,
      'allocated_buyout_credit_amount',x.allocated_buyout_credit_amount
    ) order by a.inventory_number,a.name),'[]'::jsonb),
    coalesce(sum(x.allocated_amount),0),
    coalesce(sum(x.allocated_buyout_credit_amount),0)
  into v_allocations,v_allocated_total,v_credit_total
  from public.equipment_lease_charge_allocations x
  join public.equipment_assets a on a.id=x.equipment_id
  where x.charge_id=v_charge.id;

  if jsonb_array_length(v_allocations)=0 then
    raise exception 'LEASE_ALLOCATION_EMPTY';
  end if;

  if abs(v_allocated_total-v_charge.amount)>0.01 then
    raise exception 'LEASE_ALLOCATION_TOTAL_MISMATCH:%:%',v_allocated_total,v_charge.amount;
  end if;

  if abs(v_credit_total-v_charge.buyout_credit_amount)>0.01 then
    raise exception 'LEASE_ALLOCATION_CREDIT_MISMATCH:%:%',v_credit_total,v_charge.buyout_credit_amount;
  end if;

  return jsonb_build_object(
    'schema','equipment_lease_allocation_v1',
    'charge_id',v_charge.id,
    'contract_id',v_charge.contract_id,
    'partner_id',v_charge.partner_id,
    'period_start',v_charge.period_start,
    'period_end',v_charge.period_end,
    'currency',v_charge.currency,
    'charge_amount',v_charge.amount,
    'buyout_credit_amount',v_charge.buyout_credit_amount,
    'allocated_amount_total',v_allocated_total,
    'allocated_buyout_credit_total',v_credit_total,
    'allocations',v_allocations,
    'generated_at',clock_timestamp()
  );
end
$$;

revoke all on function private.build_equipment_lease_charge_allocation_snapshot(uuid)
from public,anon,authenticated;

create or replace function private.create_equipment_lease_charge_allocation_document(
  p_charge_id uuid,
  p_snapshot jsonb,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_charge public.equipment_lease_charges%rowtype;
  v_contract public.equipment_contracts%rowtype;
  v_partner public.partners%rowtype;
  v_type uuid;
  v_doc uuid;
  v_number text;
  v_business_unit public.business_unit:='COMMON'::public.business_unit;
  v_org_code text;
begin
  select * into v_charge
  from public.equipment_lease_charges
  where id=p_charge_id;

  if v_charge.id is null then raise exception 'LEASE_CHARGE_NOT_FOUND'; end if;
  if v_charge.charge_type<>'LEASE' then raise exception 'LEASE_CHARGE_REQUIRED'; end if;
  if p_snapshot is null
     or p_snapshot->>'schema'<>'equipment_lease_allocation_v1'
  then raise exception 'LEASE_ALLOCATION_SNAPSHOT_REQUIRED'; end if;

  select * into v_contract
  from public.equipment_contracts
  where id=v_charge.contract_id;

  select * into v_partner
  from public.partners
  where id=v_charge.partner_id;

  select code into v_org_code
  from public.organizations
  where id=v_contract.organization_id;

  if v_org_code='A4PRINT' then v_business_unit:='A4_PRINT'::public.business_unit;
  elsif v_org_code='3DARTPRINT' then v_business_unit:='3D_ARTPRINT'::public.business_unit;
  end if;

  select id into v_type
  from public.document_types
  where code='EQ_LEASE_CHARGE';

  if v_type is null then raise exception 'DOCUMENT_TYPE_NOT_FOUND:EQ_LEASE_CHARGE'; end if;

  v_number:='АР-'||
    regexp_replace(v_contract.contract_number,'[^A-Za-zА-Яа-я0-9_-]+','','g')||
    '-'||to_char(v_charge.period_end,'YYYYMMDD')||
    '-'||upper(substr(v_charge.id::text,1,6));

  insert into public.documents(
    document_number,document_type_id,title,status,business_unit,
    created_by,responsible_user_id,issue_date,valid_from,valid_until,
    notes,metadata
  ) values(
    v_number,v_type,
    'Начисление аренды по договору '||v_contract.contract_number,
    'ACTIVE'::public.document_status,v_business_unit,
    p_actor,p_actor,current_date,v_charge.period_start,v_charge.period_end,
    v_charge.notes,
    jsonb_build_object(
      'schema','equipment_lease_charge_document_v1',
      'charge_id',v_charge.id,
      'charge_status','APPROVED',
      'contract_id',v_contract.id,
      'contract_number',v_contract.contract_number,
      'contract_type',v_contract.contract_type,
      'partner_snapshot',jsonb_build_object(
        'partner_id',v_partner.id,
        'name',v_partner.name,
        'legal_name',v_partner.legal_name,
        'tax_id',v_partner.tax_id,
        'registration_number',v_partner.registration_number,
        'address',v_partner.address
      ),
      'allocation_snapshot',p_snapshot
    )
  )
  returning id into v_doc;

  insert into public.document_links(document_id,entity_type,entity_id,relationship)
  values
    (v_doc,'EQUIPMENT_LEASE_CHARGE',v_charge.id,'SOURCE'),
    (v_doc,'EQUIPMENT_CONTRACT',v_contract.id,'LEASE_CHARGE'),
    (v_doc,'PARTNER',v_charge.partner_id,'COUNTERPARTY');

  insert into public.document_links(document_id,entity_type,entity_id,relationship)
  select
    v_doc,
    'EQUIPMENT_ASSET',
    (x->>'equipment_id')::uuid,
    'LEASE_ALLOCATION'
  from jsonb_array_elements(p_snapshot->'allocations') x
  on conflict(document_id,entity_type,entity_id) do nothing;

  insert into public.document_status_history(
    document_id,old_status,new_status,changed_by,comment
  ) values(
    v_doc,null,'ACTIVE'::public.document_status,p_actor,
    'Зафиксировано утверждённое начисление аренды и allocation snapshot'
  );

  return v_doc;
end
$$;

revoke all on function private.create_equipment_lease_charge_allocation_document(uuid,jsonb,uuid)
from public,anon,authenticated;

create or replace function private.guard_equipment_lease_charge_allocation_snapshot()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_internal text:=coalesce(current_setting('app.equipment_lease_allocation_write',true),'');
begin
  if old.allocation_snapshot is not null
     and v_internal<>'1'
     and (
       new.allocation_snapshot is distinct from old.allocation_snapshot
       or new.allocation_snapshot_at is distinct from old.allocation_snapshot_at
       or new.allocation_snapshot_by is distinct from old.allocation_snapshot_by
       or new.allocation_document_id is distinct from old.allocation_document_id
     )
  then
    raise exception 'LEASE_ALLOCATION_SNAPSHOT_IMMUTABLE';
  end if;

  if old.status in ('APPROVED','PAID')
     and (
       new.contract_id is distinct from old.contract_id
       or new.partner_id is distinct from old.partner_id
       or new.charge_type is distinct from old.charge_type
       or new.period_start is distinct from old.period_start
       or new.period_end is distinct from old.period_end
       or new.amount is distinct from old.amount
       or new.buyout_credit_amount is distinct from old.buyout_credit_amount
       or new.currency is distinct from old.currency
     )
  then
    raise exception 'APPROVED_LEASE_CHARGE_IMMUTABLE';
  end if;

  return new;
end
$$;

revoke all on function private.guard_equipment_lease_charge_allocation_snapshot()
from public,anon,authenticated;

drop trigger if exists trg_equipment_lease_charge_allocation_snapshot
on public.equipment_lease_charges;

create trigger trg_equipment_lease_charge_allocation_snapshot
before update on public.equipment_lease_charges
for each row execute function private.guard_equipment_lease_charge_allocation_snapshot();

create or replace function public.set_equipment_lease_charge_status(
  p_charge_id uuid,
  p_status text,
  p_payment_reference text default null,
  p_notes text default null
)
returns public.equipment_lease_charges
language plpgsql
security definer
set search_path=''
as $$
declare
  v_target text:=upper(trim(coalesce(p_status,'')));
  v_charge public.equipment_lease_charges;
  v_actor uuid;
  v_contract public.equipment_contracts;
  v_paid_credit numeric;
  v_remaining numeric;
  v_org uuid;
  v_snapshot jsonb;
  v_document_id uuid;
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

    if v_charge.charge_type='LEASE' then
      v_snapshot:=private.build_equipment_lease_charge_allocation_snapshot(v_charge.id);
      v_document_id:=private.create_equipment_lease_charge_allocation_document(
        v_charge.id,v_snapshot,v_actor
      );
    end if;

  elsif v_target='PAID' then
    if v_charge.status<>'APPROVED' then raise exception 'INVALID_TRANSITION'; end if;
    if nullif(trim(coalesce(p_payment_reference,'')),'') is null then
      raise exception 'PAYMENT_REFERENCE_REQUIRED';
    end if;

    if v_charge.charge_type='LEASE' and v_charge.allocation_snapshot is null then
      raise exception 'LEASE_ALLOCATION_SNAPSHOT_REQUIRED';
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

  perform set_config('app.equipment_lease_allocation_write','1',true);

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
      notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes),
      allocation_snapshot=case
        when v_target='APPROVED' and charge_type='LEASE' then v_snapshot
        else allocation_snapshot
      end,
      allocation_snapshot_at=case
        when v_target='APPROVED' and charge_type='LEASE' then clock_timestamp()
        else allocation_snapshot_at
      end,
      allocation_snapshot_by=case
        when v_target='APPROVED' and charge_type='LEASE' then v_actor
        else allocation_snapshot_by
      end,
      allocation_document_id=case
        when v_target='APPROVED' and charge_type='LEASE' then v_document_id
        else allocation_document_id
      end
  where id=v_charge.id
  returning * into v_charge;

  return v_charge;
end
$$;

revoke all on function public.set_equipment_lease_charge_status(uuid,text,text,text)
from public,anon,authenticated;
grant execute on function public.set_equipment_lease_charge_status(uuid,text,text,text)
to authenticated;

do $$
declare
  v_oid oid;
  v_def text;
begin
  v_oid:=to_regprocedure('public.get_partner_equipment_cabinet()');
  if v_oid is null then raise exception 'RPC_NOT_FOUND:get_partner_equipment_cabinet'; end if;

  select pg_get_functiondef(v_oid) into v_def;

  if position('''allocation_snapshot'',lc.allocation_snapshot' in v_def)=0 then
    v_def:=replace(
      v_def,
      '''payment_reference'',lc.payment_reference',
      '''payment_reference'',lc.payment_reference,'||
      E'\n    ''allocation_snapshot'',lc.allocation_snapshot,'||
      E'\n    ''allocation_snapshot_at'',lc.allocation_snapshot_at,'||
      E'\n    ''allocation_document_id'',lc.allocation_document_id'
    );
  end if;

  v_def:=replace(
    v_def,
    '''EQ_ACCEPTANCE_ACT'',''EQ_ASSET_LIST'',''EQ_TERMS_APPENDIX'',''EQ_RETURN_ACT'',''EQ_RECONCILIATION_ACT''',
    '''EQ_ACCEPTANCE_ACT'',''EQ_ASSET_LIST'',''EQ_TERMS_APPENDIX'',''EQ_RETURN_ACT'',''EQ_RECONCILIATION_ACT'',''EQ_LEASE_CHARGE'''
  );

  execute v_def;
end
$$;

do $$
declare
  v_oid oid;
  v_def text;
begin
  v_oid:=to_regprocedure('public.get_partner_equipment_document(uuid)');
  if v_oid is null then raise exception 'RPC_NOT_FOUND:get_partner_equipment_document'; end if;

  select pg_get_functiondef(v_oid) into v_def;

  v_def:=replace(
    v_def,
    '''EQ_ACCEPTANCE_ACT'',''EQ_ASSET_LIST'',''EQ_TERMS_APPENDIX'',''EQ_RETURN_ACT'',''EQ_RECONCILIATION_ACT''',
    '''EQ_ACCEPTANCE_ACT'',''EQ_ASSET_LIST'',''EQ_TERMS_APPENDIX'',''EQ_RETURN_ACT'',''EQ_RECONCILIATION_ACT'',''EQ_LEASE_CHARGE'''
  );

  execute v_def;
end
$$;

select private.assert_production_farm_security_baseline();

-- Live migration: production_farm_lease_allocation_flag_restore (20260918090435)
do $$
declare
  v_oid oid;
  v_def text;
begin
  v_oid:=to_regprocedure('public.set_equipment_lease_charge_status(uuid,text,text,text)');
  if v_oid is null then raise exception 'RPC_NOT_FOUND:set_equipment_lease_charge_status'; end if;

  select pg_get_functiondef(v_oid) into v_def;

  if position('v_prev_allocation_write text' in v_def)=0 then
    v_def:=replace(
      v_def,
      '  v_document_id uuid;',
      E'  v_document_id uuid;\n  v_prev_allocation_write text:=coalesce(current_setting(''app.equipment_lease_allocation_write'',true),'''');'
    );
  end if;

  if position('set_config(''app.equipment_lease_allocation_write'',v_prev_allocation_write,true)' in v_def)=0 then
    v_def:=replace(
      v_def,
      E'  where id=v_charge.id\n  returning * into v_charge;\n\n  return v_charge;',
      E'  where id=v_charge.id\n  returning * into v_charge;\n\n  perform set_config(''app.equipment_lease_allocation_write'',v_prev_allocation_write,true);\n\n  return v_charge;'
    );
  end if;

  execute v_def;
end
$$;

select private.assert_production_farm_security_baseline();

-- Live migration: production_farm_lease_allocation_detail_rpc (20260918114254)
create or replace function public.get_equipment_lease_charge_allocation(
  p_charge_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_charge public.equipment_lease_charges%rowtype;
  v_contract public.equipment_contracts%rowtype;
  v_partner_id uuid;
  v_snapshot jsonb;
  v_mode text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_charge_id is null then raise exception 'LEASE_CHARGE_REQUIRED'; end if;

  perform private.assert_equipment_contract_child_tenant('LEASE_CHARGE',p_charge_id);

  select * into v_charge
  from public.equipment_lease_charges
  where id=p_charge_id;

  if v_charge.id is null then raise exception 'LEASE_CHARGE_NOT_FOUND'; end if;
  if v_charge.charge_type<>'LEASE' then raise exception 'LEASE_CHARGE_REQUIRED'; end if;

  select * into v_contract
  from public.equipment_contracts
  where id=v_charge.contract_id;

  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;

  v_partner_id:=public.current_partner_id();

  if v_partner_id is not null then
    if v_charge.partner_id is distinct from v_partner_id
       or v_contract.partner_id is distinct from v_partner_id then
      raise exception 'LEASE_CHARGE_NOT_AVAILABLE';
    end if;

    if v_charge.allocation_snapshot is null then
      raise exception 'LEASE_ALLOCATION_NOT_PUBLISHED';
    end if;

    v_snapshot:=v_charge.allocation_snapshot;
    v_mode:='SNAPSHOT';
  else
    if not (
      public.has_permission('production.buyout.manage')
      or public.has_permission('production.settlements.view')
      or public.has_permission('production.settlements.manage')
      or public.has_permission('equipment.contracts.manage')
    ) then
      raise exception 'PERMISSION_DENIED';
    end if;

    if v_charge.allocation_snapshot is not null then
      v_snapshot:=v_charge.allocation_snapshot;
      v_mode:='SNAPSHOT';
    else
      v_snapshot:=private.build_equipment_lease_charge_allocation_snapshot(v_charge.id);
      v_mode:='LIVE_PREVIEW';
    end if;
  end if;

  return jsonb_build_object(
    'mode',v_mode,
    'charge_id',v_charge.id,
    'contract_id',v_charge.contract_id,
    'contract_number',v_contract.contract_number,
    'partner_id',v_charge.partner_id,
    'status',v_charge.status,
    'currency',v_charge.currency,
    'period_start',v_charge.period_start,
    'period_end',v_charge.period_end,
    'amount',v_charge.amount,
    'buyout_credit_amount',v_charge.buyout_credit_amount,
    'allocation_snapshot_at',v_charge.allocation_snapshot_at,
    'allocation_document_id',v_charge.allocation_document_id,
    'snapshot',v_snapshot
  );
end
$$;

revoke all on function public.get_equipment_lease_charge_allocation(uuid)
from public,anon,authenticated;
grant execute on function public.get_equipment_lease_charge_allocation(uuid)
to authenticated;

select private.assert_production_farm_security_baseline();

