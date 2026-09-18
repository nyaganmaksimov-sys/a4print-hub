-- A4PRINT HUB: Production Farm Phase 45 — owner revenue-share settlement audit, immutable snapshot and financial document.

-- Live migration: production_farm_owner_settlement_audit (20260918115205)
insert into public.document_types(name,code,description,requires_signature)
values(
  'Расчёт доли владельца оборудования',
  'EQ_OWNER_SETTLEMENT',
  'Утверждённый расчёт доли владельца по производственным заданиям с фиксированным snapshot',
  false
)
on conflict(code) do update
set name=excluded.name,
    description=excluded.description,
    requires_signature=excluded.requires_signature;

alter table public.equipment_owner_settlements
  add column if not exists settlement_snapshot jsonb,
  add column if not exists settlement_snapshot_at timestamptz,
  add column if not exists settlement_snapshot_by uuid references public.users(id) on delete set null,
  add column if not exists settlement_document_id uuid references public.documents(id) on delete restrict;

create or replace function private.build_equipment_owner_settlement_snapshot(
  p_settlement_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_s public.equipment_owner_settlements%rowtype;
  v_contract public.equipment_contracts%rowtype;
  v_lines jsonb;
  v_gross numeric;
  v_received numeric;
  v_costs numeric;
  v_base numeric;
  v_owner numeric;
  v_hub numeric;
begin
  select * into v_s
  from public.equipment_owner_settlements
  where id=p_settlement_id;

  if v_s.id is null then raise exception 'SETTLEMENT_NOT_FOUND'; end if;

  select * into v_contract
  from public.equipment_contracts
  where id=v_s.contract_id;

  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;

  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'line_id',l.id,
        'production_job_id',l.production_job_id,
        'job_title',j.title,
        'equipment_id',l.equipment_id,
        'inventory_number',a.inventory_number,
        'equipment_name',a.name,
        'brand',a.brand,
        'model',a.model,
        'serial_number',a.serial_number,
        'order_id',l.order_id,
        'order_number',o.order_number,
        'completed_at',l.completed_at,
        'operation_revenue',l.operation_revenue,
        'received_revenue',l.received_revenue,
        'direct_costs',l.direct_costs,
        'split_base',l.split_base,
        'owner_amount',l.owner_amount,
        'hub_amount',l.hub_amount
      )
      order by l.completed_at,l.production_job_id
    ),'[]'::jsonb),
    coalesce(sum(l.operation_revenue),0),
    coalesce(sum(l.received_revenue),0),
    coalesce(sum(l.direct_costs),0),
    coalesce(sum(l.split_base),0),
    coalesce(sum(l.owner_amount),0),
    coalesce(sum(l.hub_amount),0)
  into v_lines,v_gross,v_received,v_costs,v_base,v_owner,v_hub
  from public.equipment_owner_settlement_lines l
  left join public.production_jobs j on j.id=l.production_job_id
  left join public.equipment_assets a on a.id=l.equipment_id
  left join public.orders o on o.id=l.order_id
  where l.settlement_id=v_s.id;

  if jsonb_array_length(v_lines)=0 then
    raise exception 'OWNER_SETTLEMENT_SNAPSHOT_EMPTY';
  end if;

  if abs(v_gross-v_s.gross_revenue)>0.01 then
    raise exception 'OWNER_SETTLEMENT_SNAPSHOT_MISMATCH:GROSS_REVENUE:%:%',v_gross,v_s.gross_revenue;
  end if;
  if abs(v_received-v_s.received_revenue)>0.01 then
    raise exception 'OWNER_SETTLEMENT_SNAPSHOT_MISMATCH:RECEIVED_REVENUE:%:%',v_received,v_s.received_revenue;
  end if;
  if abs(v_costs-v_s.direct_costs)>0.01 then
    raise exception 'OWNER_SETTLEMENT_SNAPSHOT_MISMATCH:DIRECT_COSTS:%:%',v_costs,v_s.direct_costs;
  end if;
  if abs(v_base-v_s.split_base)>0.01 then
    raise exception 'OWNER_SETTLEMENT_SNAPSHOT_MISMATCH:SPLIT_BASE:%:%',v_base,v_s.split_base;
  end if;
  if abs(v_owner-v_s.owner_amount)>0.01 then
    raise exception 'OWNER_SETTLEMENT_SNAPSHOT_MISMATCH:OWNER_AMOUNT:%:%',v_owner,v_s.owner_amount;
  end if;
  if abs(v_hub-v_s.hub_amount)>0.01 then
    raise exception 'OWNER_SETTLEMENT_SNAPSHOT_MISMATCH:HUB_AMOUNT:%:%',v_hub,v_s.hub_amount;
  end if;

  return jsonb_build_object(
    'schema','equipment_owner_settlement_v1',
    'settlement_id',v_s.id,
    'contract_id',v_s.contract_id,
    'partner_id',v_s.partner_id,
    'period_start',v_s.period_start,
    'period_end',v_s.period_end,
    'currency',v_s.currency,
    'calculation_basis',v_s.calculation_basis,
    'owner_share_percent',v_s.owner_share_percent,
    'hub_share_percent',v_s.hub_share_percent,
    'direct_costs_before_split',v_s.direct_costs_before_split,
    'gross_revenue',v_s.gross_revenue,
    'received_revenue',v_s.received_revenue,
    'direct_costs',v_s.direct_costs,
    'split_base',v_s.split_base,
    'owner_amount',v_s.owner_amount,
    'hub_amount',v_s.hub_amount,
    'line_count',jsonb_array_length(v_lines),
    'lines',v_lines,
    'generated_at',clock_timestamp()
  );
end
$$;

revoke all on function private.build_equipment_owner_settlement_snapshot(uuid)
from public,anon,authenticated;

create or replace function private.create_equipment_owner_settlement_document(
  p_settlement_id uuid,
  p_snapshot jsonb,
  p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_s public.equipment_owner_settlements%rowtype;
  v_contract public.equipment_contracts%rowtype;
  v_partner public.partners%rowtype;
  v_type uuid;
  v_doc uuid;
  v_number text;
  v_business_unit public.business_unit:='COMMON'::public.business_unit;
  v_org_code text;
begin
  select * into v_s
  from public.equipment_owner_settlements
  where id=p_settlement_id;

  if v_s.id is null then raise exception 'SETTLEMENT_NOT_FOUND'; end if;
  if p_snapshot is null
     or p_snapshot->>'schema'<>'equipment_owner_settlement_v1'
  then raise exception 'OWNER_SETTLEMENT_SNAPSHOT_REQUIRED'; end if;

  select * into v_contract
  from public.equipment_contracts
  where id=v_s.contract_id;

  select * into v_partner
  from public.partners
  where id=v_s.partner_id;

  select code into v_org_code
  from public.organizations
  where id=v_contract.organization_id;

  if v_org_code='A4PRINT' then v_business_unit:='A4_PRINT'::public.business_unit;
  elsif v_org_code='3DARTPRINT' then v_business_unit:='3D_ARTPRINT'::public.business_unit;
  end if;

  select id into v_type
  from public.document_types
  where code='EQ_OWNER_SETTLEMENT';

  if v_type is null then raise exception 'DOCUMENT_TYPE_NOT_FOUND:EQ_OWNER_SETTLEMENT'; end if;

  v_number:='РС-'||
    regexp_replace(v_contract.contract_number,'[^A-Za-zА-Яа-я0-9_-]+','','g')||
    '-'||to_char(v_s.period_end,'YYYYMMDD')||
    '-'||upper(substr(v_s.id::text,1,6));

  insert into public.documents(
    document_number,document_type_id,title,status,business_unit,
    created_by,responsible_user_id,issue_date,valid_from,valid_until,
    notes,metadata
  ) values(
    v_number,v_type,
    'Расчёт доли владельца по договору '||v_contract.contract_number,
    'ACTIVE'::public.document_status,v_business_unit,
    p_actor,p_actor,current_date,v_s.period_start,v_s.period_end,
    v_s.notes,
    jsonb_build_object(
      'schema','equipment_owner_settlement_document_v1',
      'settlement_id',v_s.id,
      'settlement_status','APPROVED',
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
      'settlement_snapshot',p_snapshot
    )
  )
  returning id into v_doc;

  insert into public.document_links(document_id,entity_type,entity_id,relationship)
  values
    (v_doc,'EQUIPMENT_OWNER_SETTLEMENT',v_s.id,'SOURCE'),
    (v_doc,'EQUIPMENT_CONTRACT',v_contract.id,'OWNER_SETTLEMENT'),
    (v_doc,'PARTNER',v_s.partner_id,'COUNTERPARTY');

  insert into public.document_links(document_id,entity_type,entity_id,relationship)
  select distinct
    v_doc,'EQUIPMENT_ASSET',(x->>'equipment_id')::uuid,'SETTLEMENT_EQUIPMENT'
  from jsonb_array_elements(p_snapshot->'lines') x
  where nullif(x->>'equipment_id','') is not null
  on conflict(document_id,entity_type,entity_id) do nothing;

  insert into public.document_links(document_id,entity_type,entity_id,relationship)
  select distinct
    v_doc,'PRODUCTION_JOB',(x->>'production_job_id')::uuid,'SETTLEMENT_JOB'
  from jsonb_array_elements(p_snapshot->'lines') x
  where nullif(x->>'production_job_id','') is not null
  on conflict(document_id,entity_type,entity_id) do nothing;

  insert into public.document_status_history(
    document_id,old_status,new_status,changed_by,comment
  ) values(
    v_doc,null,'ACTIVE'::public.document_status,p_actor,
    'Зафиксирован утверждённый расчёт доли владельца и settlement snapshot'
  );

  return v_doc;
end
$$;

revoke all on function private.create_equipment_owner_settlement_document(uuid,jsonb,uuid)
from public,anon,authenticated;

create or replace function private.guard_equipment_owner_settlement_snapshot()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_internal text:=coalesce(current_setting('app.equipment_owner_settlement_snapshot_write',true),'');
begin
  if old.settlement_snapshot is not null
     and v_internal<>'1'
     and (
       new.settlement_snapshot is distinct from old.settlement_snapshot
       or new.settlement_snapshot_at is distinct from old.settlement_snapshot_at
       or new.settlement_snapshot_by is distinct from old.settlement_snapshot_by
       or new.settlement_document_id is distinct from old.settlement_document_id
     )
  then
    raise exception 'OWNER_SETTLEMENT_SNAPSHOT_IMMUTABLE';
  end if;

  if (old.status in ('APPROVED','PAID') or old.settlement_snapshot is not null)
     and (
       new.contract_id is distinct from old.contract_id
       or new.partner_id is distinct from old.partner_id
       or new.period_start is distinct from old.period_start
       or new.period_end is distinct from old.period_end
       or new.calculation_basis is distinct from old.calculation_basis
       or new.gross_revenue is distinct from old.gross_revenue
       or new.received_revenue is distinct from old.received_revenue
       or new.direct_costs is distinct from old.direct_costs
       or new.split_base is distinct from old.split_base
       or new.owner_amount is distinct from old.owner_amount
       or new.hub_amount is distinct from old.hub_amount
       or new.owner_share_percent is distinct from old.owner_share_percent
       or new.hub_share_percent is distinct from old.hub_share_percent
       or new.direct_costs_before_split is distinct from old.direct_costs_before_split
       or new.currency is distinct from old.currency
     )
  then
    raise exception 'APPROVED_OWNER_SETTLEMENT_IMMUTABLE';
  end if;

  return new;
end
$$;

revoke all on function private.guard_equipment_owner_settlement_snapshot()
from public,anon,authenticated;

drop trigger if exists trg_equipment_owner_settlement_snapshot
on public.equipment_owner_settlements;

create trigger trg_equipment_owner_settlement_snapshot
before update on public.equipment_owner_settlements
for each row execute function private.guard_equipment_owner_settlement_snapshot();

create or replace function private.guard_equipment_owner_settlement_line_immutable()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  v_settlement_id uuid:=case when tg_op='DELETE' then old.settlement_id else new.settlement_id end;
  v_locked boolean;
begin
  select (s.status in ('APPROVED','PAID') or s.settlement_snapshot is not null)
    into v_locked
  from public.equipment_owner_settlements s
  where s.id=v_settlement_id;

  if coalesce(v_locked,false) then
    raise exception 'APPROVED_OWNER_SETTLEMENT_LINES_IMMUTABLE';
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end
$$;

revoke all on function private.guard_equipment_owner_settlement_line_immutable()
from public,anon,authenticated;

drop trigger if exists trg_equipment_owner_settlement_line_immutable
on public.equipment_owner_settlement_lines;

create trigger trg_equipment_owner_settlement_line_immutable
before insert or update or delete on public.equipment_owner_settlement_lines
for each row execute function private.guard_equipment_owner_settlement_line_immutable();

create or replace function public.set_equipment_owner_settlement_status(
  p_settlement_id uuid,
  p_status text,
  p_payment_reference text default null,
  p_notes text default null
)
returns public.equipment_owner_settlements
language plpgsql
security definer
set search_path=''
as $$
declare
  v_target text:=upper(trim(coalesce(p_status,'')));
  v_row public.equipment_owner_settlements;
  v_actor uuid;
  v_org uuid;
  v_snapshot jsonb;
  v_document_id uuid;
  v_prev_snapshot_write text:=coalesce(current_setting('app.equipment_owner_settlement_snapshot_write',true),'');
  v_doc_status public.document_status;
begin
  perform private.assert_equipment_contract_child_tenant('OWNER_SETTLEMENT',p_settlement_id);

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

    v_snapshot:=private.build_equipment_owner_settlement_snapshot(v_row.id);
    v_document_id:=private.create_equipment_owner_settlement_document(
      v_row.id,v_snapshot,v_actor
    );

  elsif v_target='PAID' then
    if v_row.status<>'APPROVED' then raise exception 'INVALID_TRANSITION'; end if;
    if v_row.settlement_snapshot is null then raise exception 'OWNER_SETTLEMENT_SNAPSHOT_REQUIRED'; end if;
    if v_row.owner_amount>0
       and nullif(trim(coalesce(p_payment_reference,'')),'') is null then
      raise exception 'PAYMENT_REFERENCE_REQUIRED';
    end if;

  elsif v_target='CANCELLED' then
    if v_row.status='PAID' then raise exception 'INVALID_TRANSITION'; end if;
  end if;

  perform set_config('app.equipment_owner_settlement_snapshot_write','1',true);

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
      notes=coalesce(nullif(trim(coalesce(p_notes,'')),''),notes),
      settlement_snapshot=case
        when v_target='APPROVED' then v_snapshot
        else settlement_snapshot
      end,
      settlement_snapshot_at=case
        when v_target='APPROVED' then clock_timestamp()
        else settlement_snapshot_at
      end,
      settlement_snapshot_by=case
        when v_target='APPROVED' then v_actor
        else settlement_snapshot_by
      end,
      settlement_document_id=case
        when v_target='APPROVED' then v_document_id
        else settlement_document_id
      end
  where id=p_settlement_id
  returning * into v_row;

  perform set_config('app.equipment_owner_settlement_snapshot_write',v_prev_snapshot_write,true);

  if v_target='CANCELLED' and v_row.settlement_document_id is not null then
    select status into v_doc_status
    from public.documents
    where id=v_row.settlement_document_id
    for update;

    if v_doc_status is distinct from 'ARCHIVED'::public.document_status then
      update public.documents
      set status='ARCHIVED'::public.document_status,
          archived_at=coalesce(archived_at,clock_timestamp()),
          updated_at=clock_timestamp()
      where id=v_row.settlement_document_id;

      insert into public.document_status_history(
        document_id,old_status,new_status,changed_by,comment
      ) values(
        v_row.settlement_document_id,v_doc_status,'ARCHIVED'::public.document_status,
        v_actor,'Расчёт владельца отменён после согласования'
      );
    end if;
  end if;

  return v_row;
end
$$;

revoke all on function public.set_equipment_owner_settlement_status(uuid,text,text,text)
from public,anon,authenticated;
grant execute on function public.set_equipment_owner_settlement_status(uuid,text,text,text)
to authenticated;

create or replace function public.get_equipment_owner_settlement_detail(
  p_settlement_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_s public.equipment_owner_settlements%rowtype;
  v_contract public.equipment_contracts%rowtype;
  v_partner_id uuid;
  v_snapshot jsonb;
  v_mode text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_settlement_id is null then raise exception 'SETTLEMENT_REQUIRED'; end if;

  perform private.assert_equipment_contract_child_tenant('OWNER_SETTLEMENT',p_settlement_id);

  select * into v_s
  from public.equipment_owner_settlements
  where id=p_settlement_id;

  if v_s.id is null then raise exception 'SETTLEMENT_NOT_FOUND'; end if;

  select * into v_contract
  from public.equipment_contracts
  where id=v_s.contract_id;

  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;

  v_partner_id:=public.current_partner_id();

  if v_partner_id is not null then
    if v_s.partner_id is distinct from v_partner_id
       or v_contract.partner_id is distinct from v_partner_id then
      raise exception 'OWNER_SETTLEMENT_NOT_AVAILABLE';
    end if;

    if v_s.settlement_snapshot is null then
      raise exception 'OWNER_SETTLEMENT_NOT_PUBLISHED';
    end if;

    v_snapshot:=v_s.settlement_snapshot;
    v_mode:='SNAPSHOT';
  else
    if not (
      public.has_permission('production.settlements.view')
      or public.has_permission('production.settlements.manage')
      or public.has_permission('equipment.contracts.manage')
    ) then
      raise exception 'PERMISSION_DENIED';
    end if;

    if v_s.settlement_snapshot is not null then
      v_snapshot:=v_s.settlement_snapshot;
      v_mode:='SNAPSHOT';
    else
      v_snapshot:=private.build_equipment_owner_settlement_snapshot(v_s.id);
      v_mode:='LIVE_PREVIEW';
    end if;
  end if;

  return jsonb_build_object(
    'mode',v_mode,
    'settlement_id',v_s.id,
    'contract_id',v_s.contract_id,
    'contract_number',v_contract.contract_number,
    'partner_id',v_s.partner_id,
    'status',v_s.status,
    'currency',v_s.currency,
    'period_start',v_s.period_start,
    'period_end',v_s.period_end,
    'owner_amount',v_s.owner_amount,
    'hub_amount',v_s.hub_amount,
    'settlement_snapshot_at',v_s.settlement_snapshot_at,
    'settlement_document_id',v_s.settlement_document_id,
    'snapshot',v_snapshot
  );
end
$$;

revoke all on function public.get_equipment_owner_settlement_detail(uuid)
from public,anon,authenticated;
grant execute on function public.get_equipment_owner_settlement_detail(uuid)
to authenticated;

do $$
declare
  v_oid oid;
  v_def text;
begin
  v_oid:=to_regprocedure('public.get_partner_equipment_cabinet()');
  if v_oid is null then raise exception 'RPC_NOT_FOUND:get_partner_equipment_cabinet'; end if;

  select pg_get_functiondef(v_oid) into v_def;

  if position('''settlement_snapshot'',s.settlement_snapshot' in v_def)=0 then
    v_def:=replace(
      v_def,
      '''payment_reference'',s.payment_reference',
      '''payment_reference'',s.payment_reference,'||
      E'\n    ''settlement_snapshot'',s.settlement_snapshot,'||
      E'\n    ''settlement_snapshot_at'',s.settlement_snapshot_at,'||
      E'\n    ''settlement_document_id'',s.settlement_document_id'
    );
  end if;

  v_def:=replace(
    v_def,
    '''EQ_RECONCILIATION_ACT'',''EQ_LEASE_CHARGE''',
    '''EQ_RECONCILIATION_ACT'',''EQ_LEASE_CHARGE'',''EQ_OWNER_SETTLEMENT'''
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
    '''EQ_RECONCILIATION_ACT'',''EQ_LEASE_CHARGE''',
    '''EQ_RECONCILIATION_ACT'',''EQ_LEASE_CHARGE'',''EQ_OWNER_SETTLEMENT'''
  );

  execute v_def;
end
$$;

select private.assert_production_farm_security_baseline();

