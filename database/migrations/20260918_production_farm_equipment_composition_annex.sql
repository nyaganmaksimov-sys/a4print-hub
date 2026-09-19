-- A4PRINT HUB: Production Farm Phase 42 — controlled equipment composition annexes.
-- Direct changes to ACTIVE/SUSPENDED contract composition remain prohibited.

create or replace function private.assert_equipment_contract_child_tenant(
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql
security definer
set search_path=''
as $
declare
  v_type text:=upper(btrim(coalesce(p_entity_type,'')));
  v_contract_id uuid;
  v_partner_id uuid;
begin
  if p_entity_id is null then
    raise exception 'EQUIPMENT_CONTRACT_ENTITY_NOT_AVAILABLE';
  end if;

  if auth.uid() is null then
    return;
  end if;

  if v_type='AMENDMENT' then
    select a.contract_id into v_contract_id
    from public.equipment_contract_amendments a
    where a.id=p_entity_id;
  elsif v_type='TERMINATION' then
    select t.contract_id into v_contract_id
    from public.equipment_contract_terminations t
    where t.id=p_entity_id;
  elsif v_type='CLAIM' then
    select c.contract_id into v_contract_id
    from public.equipment_condition_claims c
    where c.id=p_entity_id;
  elsif v_type='COMPARISON' then
    select c.contract_id into v_contract_id
    from public.equipment_condition_comparisons c
    where c.id=p_entity_id;
  elsif v_type='LEASE_CHARGE' then
    select c.contract_id into v_contract_id
    from public.equipment_lease_charges c
    where c.id=p_entity_id;
  elsif v_type='OWNER_SETTLEMENT' then
    select s.contract_id into v_contract_id
    from public.equipment_owner_settlements s
    where s.id=p_entity_id;
  elsif v_type='INSPECTION' then
    select i.contract_id into v_contract_id
    from public.equipment_condition_inspections i
    where i.id=p_entity_id;
  else
    raise exception 'EQUIPMENT_CONTRACT_ENTITY_TYPE_INVALID';
  end if;

  if v_contract_id is null then
    raise exception 'EQUIPMENT_CONTRACT_ENTITY_NOT_AVAILABLE';
  end if;

  v_partner_id:=public.current_partner_id();

  if v_partner_id is not null then
    if exists(
      select 1
      from public.equipment_contracts c
      where c.id=v_contract_id
        and c.partner_id=v_partner_id
    ) then
      return;
    end if;
    raise exception 'EQUIPMENT_CONTRACT_ENTITY_NOT_AVAILABLE';
  end if;

  perform private.assert_equipment_contract_tenant(v_contract_id);
end
$;

revoke all on function private.assert_equipment_contract_child_tenant(text,uuid)
from public,anon,authenticated;

alter table public.equipment_contract_amendments
  drop constraint equipment_contract_amendments_amendment_kind_check;

alter table public.equipment_contract_amendments
  add constraint equipment_contract_amendments_amendment_kind_check
  check(amendment_kind in ('RENEWAL','TERMS_CHANGE','EQUIPMENT_COMPOSITION'));

update public.equipment_contract_assets ca
set starts_on=c.starts_on
from public.equipment_contracts c
where c.id=ca.contract_id
  and ca.starts_on is null;

alter table public.equipment_contract_assets
  alter column starts_on set not null;

alter table public.equipment_contract_assets
  drop constraint equipment_contract_assets_contract_id_equipment_id_key;

alter table public.equipment_contract_assets
  add column source_amendment_id uuid
    references public.equipment_contract_amendments(id) on delete restrict,
  add column ended_by_amendment_id uuid
    references public.equipment_contract_amendments(id) on delete restrict;

create index if not exists idx_equipment_contract_assets_period
  on public.equipment_contract_assets(contract_id,equipment_id,starts_on,ends_on);

create table public.equipment_contract_amendment_assets(
  id uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references public.equipment_contract_amendments(id) on delete cascade,
  contract_id uuid not null references public.equipment_contracts(id) on delete restrict,
  partner_id uuid not null references public.partners(id) on delete restrict,
  equipment_id uuid not null references public.equipment_assets(id) on delete restrict,
  change_action text not null check(change_action in ('ADD','REMOVE')),
  condition_grade text not null
    check(condition_grade in ('EXCELLENT','GOOD','FAIR','POOR','NON_OPERATIONAL')),
  operational_state text not null
    check(operational_state in ('READY','LIMITED','NOT_OPERATIONAL')),
  meter_hours numeric null check(meter_hours is null or meter_hours>=0),
  completeness jsonb not null default '[]'::jsonb
    check(jsonb_typeof(completeness)='array'),
  evidence jsonb not null default '[]'::jsonb
    check(jsonb_typeof(evidence)='array'),
  note text null,
  equipment_snapshot jsonb not null,
  contract_asset_id uuid null
    references public.equipment_contract_assets(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  unique(amendment_id,equipment_id)
);

create index idx_equipment_contract_amendment_assets_contract
  on public.equipment_contract_amendment_assets(contract_id,amendment_id);

alter table public.equipment_contract_amendment_assets enable row level security;

revoke all on table public.equipment_contract_amendment_assets
from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.equipment_contract_legal_snapshot(p_contract_id uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select jsonb_build_object(
    'contract_id',c.id,
    'partner_id',c.partner_id,
    'contract_number',c.contract_number,
    'contract_type',c.contract_type,
    'starts_on',c.starts_on,
    'ends_on',c.ends_on,
    'hub_share_percent',c.hub_share_percent,
    'owner_share_percent',c.owner_share_percent,
    'calculation_basis',c.calculation_basis,
    'direct_costs_before_split',c.direct_costs_before_split,
    'settlement_frequency',c.settlement_frequency,
    'settlement_day',c.settlement_day,
    'repair_responsibility',c.repair_responsibility,
    'early_termination_notice_days',c.early_termination_notice_days,
    'lease_period_amount',c.lease_period_amount,
    'buyout_enabled',c.buyout_enabled,
    'buyout_price',c.buyout_price,
    'buyout_credit_percent',c.buyout_credit_percent,
    'currency',c.currency,
    'terms',c.terms,
    'equipment_composition',coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'contract_asset_id',ca.id,
          'equipment_id',ca.equipment_id,
          'starts_on',ca.starts_on,
          'ends_on',ca.ends_on,
          'allocation_weight',ca.allocation_weight,
          'source_amendment_id',ca.source_amendment_id,
          'ended_by_amendment_id',ca.ended_by_amendment_id
        )
        order by ca.equipment_id,ca.starts_on,ca.id
      )
      from public.equipment_contract_assets ca
      where ca.contract_id=c.id
    ),'[]'::jsonb)
  )
  from public.equipment_contracts c
  where c.id=p_contract_id
$function$
;

CREATE OR REPLACE FUNCTION public.guard_equipment_contract_asset_period_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if exists(
    select 1
    from public.equipment_contract_assets ca
    where ca.contract_id=new.contract_id
      and ca.equipment_id=new.equipment_id
      and ca.id<>coalesce(new.id,'00000000-0000-0000-0000-000000000000'::uuid)
      and ca.starts_on<=coalesce(new.ends_on,'infinity'::date)
      and new.starts_on<=coalesce(ca.ends_on,'infinity'::date)
  ) then
    raise exception 'EQUIPMENT_CONTRACT_PERIOD_OVERLAP';
  end if;

  if exists(
    select 1
    from public.equipment_contract_assets ca
    where ca.contract_id<>new.contract_id
      and ca.equipment_id=new.equipment_id
      and ca.starts_on<=coalesce(new.ends_on,'infinity'::date)
      and new.starts_on<=coalesce(ca.ends_on,'infinity'::date)
  ) then
    raise exception 'EQUIPMENT_CONTRACT_PERIOD_CONFLICT';
  end if;

  return new;
end
$function$
;

CREATE OR REPLACE FUNCTION public.guard_closed_equipment_contract_asset()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_contract_id uuid:=case when tg_op='DELETE' then old.contract_id else new.contract_id end;
  v_status text;
  v_amendment_apply text:=coalesce(current_setting('app.equipment_contract_amendment_apply',true),'');
  v_initial_save text:=coalesce(current_setting('app.equipment_contract_initial_composition_save',true),'');
  v_termination_finalize text:=coalesce(current_setting('app.equipment_contract_termination_finalize',true),'');
begin
  select status into v_status
  from public.equipment_contracts
  where id=v_contract_id;

  if v_status in ('TERMINATED','COMPLETED')
     and v_termination_finalize<>'1'
  then
    raise exception 'CLOSED_CONTRACT_ASSET_IMMUTABLE';
  end if;

  if v_status in ('ACTIVE','SUSPENDED')
     and v_amendment_apply<>'1'
     and v_initial_save<>'1'
     and v_termination_finalize<>'1'
  then
    raise exception 'ACTIVE_CONTRACT_EQUIPMENT_CHANGE_REQUIRES_NEW_ANNEX';
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end
$function$
;

CREATE OR REPLACE FUNCTION public.create_equipment_composition_amendment(p_contract_id uuid, p_effective_on date, p_additions jsonb, p_removals jsonb, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_contract public.equipment_contracts%rowtype;
  v_partner public.partners%rowtype;
  v_actor uuid;
  v_before jsonb;
  v_amendment_id uuid:=gen_random_uuid();
  v_document_id uuid;
  v_type_id uuid;
  v_number text;
  v_item jsonb;
  v_equipment_id uuid;
  v_asset public.equipment_assets%rowtype;
  v_condition text;
  v_operational text;
  v_meter numeric;
  v_completeness jsonb;
  v_evidence jsonb;
  v_note text;
  v_snapshot jsonb;
  v_add_enriched jsonb:='[]'::jsonb;
  v_remove_enriched jsonb:='[]'::jsonb;
  v_changes jsonb;
  v_dup uuid;
begin
  perform private.assert_equipment_contract_tenant(p_contract_id);

  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.contracts.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_contract_id is null then raise exception 'CONTRACT_REQUIRED'; end if;
  if p_effective_on is null then raise exception 'EFFECTIVE_DATE_REQUIRED'; end if;
  if p_effective_on<current_date then raise exception 'PAST_EFFECTIVE_DATE_NOT_ALLOWED'; end if;
  if jsonb_typeof(coalesce(p_additions,'[]'::jsonb))<>'array' then raise exception 'ADDITIONS_MUST_BE_ARRAY'; end if;
  if jsonb_typeof(coalesce(p_removals,'[]'::jsonb))<>'array' then raise exception 'REMOVALS_MUST_BE_ARRAY'; end if;
  if jsonb_array_length(coalesce(p_additions,'[]'::jsonb))
     +jsonb_array_length(coalesce(p_removals,'[]'::jsonb))=0 then
    raise exception 'EQUIPMENT_CHANGES_REQUIRED';
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'REASON_REQUIRED'; end if;

  select * into v_contract
  from public.equipment_contracts
  where id=p_contract_id
  for update;

  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if v_contract.status not in ('ACTIVE','SUSPENDED') then raise exception 'ACTIVE_OR_SUSPENDED_CONTRACT_REQUIRED'; end if;
  if v_contract.organization_id is null then raise exception 'CONTRACT_ORGANIZATION_REQUIRED'; end if;
  if p_effective_on<v_contract.starts_on then raise exception 'EFFECTIVE_DATE_BEFORE_CONTRACT_START'; end if;
  if v_contract.ends_on is not null and p_effective_on>v_contract.ends_on then
    raise exception 'EFFECTIVE_DATE_AFTER_CONTRACT_END';
  end if;

  select (x->>'equipment_id')::uuid
    into v_dup
  from (
    select value x
    from jsonb_array_elements(coalesce(p_additions,'[]'::jsonb))
    union all
    select value x
    from jsonb_array_elements(coalesce(p_removals,'[]'::jsonb))
  ) q
  group by (x->>'equipment_id')::uuid
  having count(*)>1
  limit 1;

  if v_dup is not null then
    raise exception 'DUPLICATE_EQUIPMENT_CHANGE:%',v_dup;
  end if;

  v_before:=public.equipment_contract_legal_snapshot(v_contract.id);
  v_actor:=public.current_staff_user_id();
  if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;

  v_number:='ДС-СОСТАВ-'||
    regexp_replace(v_contract.contract_number,'[^A-Za-zА-Яа-я0-9_-]+','','g')||
    '-'||to_char(current_date,'YYYYMMDD')||
    '-'||upper(substr(gen_random_uuid()::text,1,4));

  insert into public.equipment_contract_amendments(
    id,contract_id,partner_id,amendment_number,amendment_kind,
    effective_on,proposed_changes,before_snapshot,reason,created_by
  ) values(
    v_amendment_id,v_contract.id,v_contract.partner_id,v_number,
    'EQUIPMENT_COMPOSITION',p_effective_on,
    jsonb_build_object('equipment_add','[]'::jsonb,'equipment_remove','[]'::jsonb),
    v_before,btrim(p_reason),v_actor
  );

  for v_item in
    select value from jsonb_array_elements(coalesce(p_additions,'[]'::jsonb))
  loop
    if nullif(v_item->>'equipment_id','') is null then raise exception 'EQUIPMENT_ID_REQUIRED'; end if;
    v_equipment_id:=(v_item->>'equipment_id')::uuid;
    v_condition:=upper(btrim(coalesce(v_item->>'condition_grade','')));
    v_operational:=upper(btrim(coalesce(v_item->>'operational_state','')));
    v_meter:=nullif(v_item->>'meter_hours','')::numeric;
    v_completeness:=coalesce(v_item->'completeness','[]'::jsonb);
    v_evidence:=coalesce(v_item->'evidence','[]'::jsonb);
    v_note:=nullif(btrim(coalesce(v_item->>'note','')),'');

    if v_condition not in ('EXCELLENT','GOOD','FAIR','POOR','NON_OPERATIONAL') then
      raise exception 'INVALID_CONDITION_GRADE:%',v_equipment_id;
    end if;
    if v_operational not in ('READY','LIMITED','NOT_OPERATIONAL') then
      raise exception 'INVALID_OPERATIONAL_STATE:%',v_equipment_id;
    end if;
    if v_meter is not null and v_meter<0 then raise exception 'INVALID_METER_HOURS:%',v_equipment_id; end if;
    if jsonb_typeof(v_completeness)<>'array' or jsonb_array_length(v_completeness)=0 then
      raise exception 'COMPLETENESS_REQUIRED:%',v_equipment_id;
    end if;
    if jsonb_typeof(v_evidence)<>'array' or jsonb_array_length(v_evidence)=0 then
      raise exception 'EVIDENCE_REQUIRED:%',v_equipment_id;
    end if;

    select * into v_asset
    from public.equipment_assets
    where id=v_equipment_id
    for update;

    if v_asset.id is null
       or v_asset.organization_id is distinct from v_contract.organization_id then
      raise exception 'EQUIPMENT_NOT_AVAILABLE:%',v_equipment_id;
    end if;
    if v_asset.status='WRITTEN_OFF' then
      raise exception 'WRITTEN_OFF_EQUIPMENT_NOT_ALLOWED:%',v_equipment_id;
    end if;

    if exists(
      select 1
      from public.equipment_contract_assets ca
      where ca.contract_id=v_contract.id
        and ca.equipment_id=v_equipment_id
        and ca.starts_on<=coalesce(v_contract.ends_on,'infinity'::date)
        and p_effective_on<=coalesce(ca.ends_on,'infinity'::date)
    ) then
      raise exception 'EQUIPMENT_ALREADY_IN_CONTRACT_PERIOD:%',v_equipment_id;
    end if;

    v_snapshot:=jsonb_build_object(
      'equipment_id',v_asset.id,
      'inventory_number',v_asset.inventory_number,
      'name',v_asset.name,
      'brand',v_asset.brand,
      'model',v_asset.model,
      'serial_number',v_asset.serial_number,
      'lifecycle_status',v_asset.status,
      'ownership_type',v_asset.ownership_type,
      'operational_status',v_asset.operational_status,
      'organization_id',v_asset.organization_id
    );

    insert into public.equipment_contract_amendment_assets(
      amendment_id,contract_id,partner_id,equipment_id,change_action,
      condition_grade,operational_state,meter_hours,completeness,evidence,
      note,equipment_snapshot
    ) values(
      v_amendment_id,v_contract.id,v_contract.partner_id,v_equipment_id,'ADD',
      v_condition,v_operational,v_meter,v_completeness,v_evidence,
      v_note,v_snapshot
    );

    v_add_enriched:=v_add_enriched||jsonb_build_array(
      jsonb_build_object(
        'equipment_id',v_equipment_id,
        'equipment',v_snapshot,
        'condition_grade',v_condition,
        'operational_state',v_operational,
        'meter_hours',v_meter,
        'completeness',v_completeness,
        'evidence',v_evidence,
        'note',v_note
      )
    );
  end loop;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_removals,'[]'::jsonb))
  loop
    if nullif(v_item->>'equipment_id','') is null then raise exception 'EQUIPMENT_ID_REQUIRED'; end if;
    v_equipment_id:=(v_item->>'equipment_id')::uuid;
    v_condition:=upper(btrim(coalesce(v_item->>'condition_grade','')));
    v_operational:=upper(btrim(coalesce(v_item->>'operational_state','')));
    v_meter:=nullif(v_item->>'meter_hours','')::numeric;
    v_completeness:=coalesce(v_item->'completeness','[]'::jsonb);
    v_evidence:=coalesce(v_item->'evidence','[]'::jsonb);
    v_note:=nullif(btrim(coalesce(v_item->>'note','')),'');

    if v_condition not in ('EXCELLENT','GOOD','FAIR','POOR','NON_OPERATIONAL') then
      raise exception 'INVALID_CONDITION_GRADE:%',v_equipment_id;
    end if;
    if v_operational not in ('READY','LIMITED','NOT_OPERATIONAL') then
      raise exception 'INVALID_OPERATIONAL_STATE:%',v_equipment_id;
    end if;
    if v_meter is not null and v_meter<0 then raise exception 'INVALID_METER_HOURS:%',v_equipment_id; end if;
    if jsonb_typeof(v_completeness)<>'array' or jsonb_array_length(v_completeness)=0 then
      raise exception 'COMPLETENESS_REQUIRED:%',v_equipment_id;
    end if;
    if jsonb_typeof(v_evidence)<>'array' or jsonb_array_length(v_evidence)=0 then
      raise exception 'EVIDENCE_REQUIRED:%',v_equipment_id;
    end if;

    select * into v_asset
    from public.equipment_assets
    where id=v_equipment_id
    for update;

    if v_asset.id is null
       or v_asset.organization_id is distinct from v_contract.organization_id then
      raise exception 'EQUIPMENT_NOT_AVAILABLE:%',v_equipment_id;
    end if;

    if not exists(
      select 1
      from public.equipment_contract_assets ca
      where ca.contract_id=v_contract.id
        and ca.equipment_id=v_equipment_id
        and ca.starts_on<p_effective_on
        and p_effective_on<=coalesce(ca.ends_on,'infinity'::date)
    ) then
      raise exception 'EQUIPMENT_NOT_ACTIVE_FOR_REMOVAL:%',v_equipment_id;
    end if;

    v_snapshot:=jsonb_build_object(
      'equipment_id',v_asset.id,
      'inventory_number',v_asset.inventory_number,
      'name',v_asset.name,
      'brand',v_asset.brand,
      'model',v_asset.model,
      'serial_number',v_asset.serial_number,
      'lifecycle_status',v_asset.status,
      'ownership_type',v_asset.ownership_type,
      'operational_status',v_asset.operational_status,
      'organization_id',v_asset.organization_id
    );

    insert into public.equipment_contract_amendment_assets(
      amendment_id,contract_id,partner_id,equipment_id,change_action,
      condition_grade,operational_state,meter_hours,completeness,evidence,
      note,equipment_snapshot
    ) values(
      v_amendment_id,v_contract.id,v_contract.partner_id,v_equipment_id,'REMOVE',
      v_condition,v_operational,v_meter,v_completeness,v_evidence,
      v_note,v_snapshot
    );

    v_remove_enriched:=v_remove_enriched||jsonb_build_array(
      jsonb_build_object(
        'equipment_id',v_equipment_id,
        'equipment',v_snapshot,
        'condition_grade',v_condition,
        'operational_state',v_operational,
        'meter_hours',v_meter,
        'completeness',v_completeness,
        'evidence',v_evidence,
        'note',v_note
      )
    );
  end loop;

  v_changes:=jsonb_build_object(
    'equipment_add',v_add_enriched,
    'equipment_remove',v_remove_enriched
  );

  update public.equipment_contract_amendments
  set proposed_changes=v_changes
  where id=v_amendment_id;

  select * into v_partner
  from public.partners
  where id=v_contract.partner_id;

  select id into v_type_id
  from public.document_types
  where code='EQ_CONTRACT_AMENDMENT';

  if v_type_id is null then raise exception 'DOCUMENT_TYPE_NOT_FOUND'; end if;

  insert into public.documents(
    document_number,document_type_id,title,status,business_unit,
    created_by,responsible_user_id,issue_date,valid_from,notes,metadata
  ) values(
    v_number,v_type_id,'Дополнительное соглашение по составу оборудования '||v_number,
    'DRAFT'::public.document_status,'COMMON'::public.business_unit,
    v_actor,v_actor,current_date,p_effective_on,btrim(p_reason),
    jsonb_build_object(
      'schema','equipment_contract_composition_amendment_v1',
      'amendment_id',v_amendment_id,
      'amendment_number',v_number,
      'amendment_kind','EQUIPMENT_COMPOSITION',
      'effective_on',p_effective_on,
      'reason',btrim(p_reason),
      'contract_snapshot_before',v_before,
      'proposed_changes',v_changes,
      'partner_snapshot',jsonb_build_object(
        'partner_id',v_partner.id,
        'name',v_partner.name,
        'legal_name',v_partner.legal_name,
        'tax_id',v_partner.tax_id,
        'registration_number',v_partner.registration_number,
        'address',v_partner.address
      )
    )
  ) returning id into v_document_id;

  update public.equipment_contract_amendments
  set document_id=v_document_id
  where id=v_amendment_id;

  insert into public.document_links(document_id,entity_type,entity_id,relationship)
  values
    (v_document_id,'EQUIPMENT_CONTRACT',v_contract.id,'AMENDMENT'),
    (v_document_id,'EQUIPMENT_CONTRACT_AMENDMENT',v_amendment_id,'SOURCE'),
    (v_document_id,'PARTNER',v_contract.partner_id,'COUNTERPARTY');

  insert into public.document_links(document_id,entity_type,entity_id,relationship)
  select v_document_id,'EQUIPMENT_ASSET',x.equipment_id,
         case when x.change_action='ADD' then 'ADDED_EQUIPMENT' else 'REMOVED_EQUIPMENT' end
  from public.equipment_contract_amendment_assets x
  where x.amendment_id=v_amendment_id;

  insert into public.document_status_history(
    document_id,old_status,new_status,changed_by,comment
  ) values(
    v_document_id,null,'DRAFT'::public.document_status,v_actor,
    'Создано ДС по изменению состава оборудования '||v_number
  );

  return v_amendment_id;
end
$function$
;

CREATE OR REPLACE FUNCTION private.apply_equipment_contract_composition_amendment(p_amendment_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_a public.equipment_contract_amendments%rowtype;
  v_contract public.equipment_contracts%rowtype;
  v_doc_status public.document_status;
  v_actor uuid;
  v_change public.equipment_contract_amendment_assets%rowtype;
  v_assignment_id uuid;
  v_new_asset_id uuid;
  v_after jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.contracts.manage') then raise exception 'PERMISSION_DENIED'; end if;

  select * into v_a
  from public.equipment_contract_amendments
  where id=p_amendment_id
  for update;

  if v_a.id is null then raise exception 'AMENDMENT_NOT_FOUND'; end if;
  if v_a.amendment_kind<>'EQUIPMENT_COMPOSITION' then raise exception 'COMPOSITION_AMENDMENT_REQUIRED'; end if;
  if v_a.status<>'APPROVED' then raise exception 'AMENDMENT_NOT_APPROVED'; end if;
  if v_a.effective_on>current_date then raise exception 'AMENDMENT_NOT_EFFECTIVE_YET'; end if;

  perform private.assert_equipment_contract_tenant(v_a.contract_id);

  select * into v_contract
  from public.equipment_contracts
  where id=v_a.contract_id
  for update;

  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if v_contract.status not in ('ACTIVE','SUSPENDED') then
    raise exception 'CONTRACT_NOT_ACTIVE_OR_SUSPENDED';
  end if;

  if public.equipment_contract_legal_snapshot(v_contract.id)
     is distinct from v_a.before_snapshot then
    raise exception 'CONTRACT_CHANGED_SINCE_DRAFT';
  end if;

  select status into v_doc_status
  from public.documents
  where id=v_a.document_id
  for update;

  if v_doc_status not in ('SIGNED'::public.document_status,'ACTIVE'::public.document_status) then
    raise exception 'AMENDMENT_DOCUMENT_MUST_BE_SIGNED';
  end if;

  perform set_config('app.equipment_contract_amendment_apply','1',true);

  for v_change in
    select *
    from public.equipment_contract_amendment_assets
    where amendment_id=v_a.id
      and change_action='REMOVE'
    order by created_at,id
  loop
    select ca.id into v_assignment_id
    from public.equipment_contract_assets ca
    where ca.contract_id=v_contract.id
      and ca.equipment_id=v_change.equipment_id
      and ca.starts_on<v_a.effective_on
      and v_a.effective_on<=coalesce(ca.ends_on,'infinity'::date)
    order by ca.starts_on desc
    limit 1
    for update;

    if v_assignment_id is null then
      raise exception 'COMPOSITION_CHANGED_SINCE_DRAFT:%',v_change.equipment_id;
    end if;

    update public.equipment_contract_assets
    set ends_on=v_a.effective_on-1,
        ended_by_amendment_id=v_a.id
    where id=v_assignment_id;

    update public.equipment_contract_amendment_assets
    set contract_asset_id=v_assignment_id
    where id=v_change.id;
  end loop;

  for v_change in
    select *
    from public.equipment_contract_amendment_assets
    where amendment_id=v_a.id
      and change_action='ADD'
    order by created_at,id
  loop
    if exists(
      select 1
      from public.equipment_contract_assets ca
      where ca.contract_id=v_contract.id
        and ca.equipment_id=v_change.equipment_id
        and ca.starts_on<=coalesce(v_contract.ends_on,'infinity'::date)
        and v_a.effective_on<=coalesce(ca.ends_on,'infinity'::date)
    ) then
      raise exception 'COMPOSITION_CHANGED_SINCE_DRAFT:%',v_change.equipment_id;
    end if;

    if not exists(
      select 1
      from public.equipment_assets ea
      where ea.id=v_change.equipment_id
        and ea.organization_id=v_contract.organization_id
        and ea.status<>'WRITTEN_OFF'
    ) then
      raise exception 'EQUIPMENT_NOT_AVAILABLE:%',v_change.equipment_id;
    end if;

    insert into public.equipment_contract_assets(
      contract_id,equipment_id,starts_on,ends_on,source_amendment_id
    ) values(
      v_contract.id,v_change.equipment_id,v_a.effective_on,
      v_contract.ends_on,v_a.id
    )
    returning id into v_new_asset_id;

    update public.equipment_contract_amendment_assets
    set contract_asset_id=v_new_asset_id
    where id=v_change.id;
  end loop;

  v_after:=public.equipment_contract_legal_snapshot(v_contract.id);
  v_actor:=public.current_staff_user_id();

  update public.equipment_contract_amendments
  set status='APPLIED',
      after_snapshot=v_after,
      applied_by=v_actor,
      applied_at=clock_timestamp()
  where id=v_a.id;

  if v_doc_status='SIGNED'::public.document_status then
    update public.documents
    set status='ACTIVE'::public.document_status,
        updated_at=clock_timestamp()
    where id=v_a.document_id;

    insert into public.document_status_history(
      document_id,old_status,new_status,changed_by,comment
    ) values(
      v_a.document_id,v_doc_status,'ACTIVE'::public.document_status,
      v_actor,'Изменение состава оборудования применено к договору'
    );
  end if;

  return v_a.id;
end
$function$
;

CREATE OR REPLACE FUNCTION public.apply_equipment_contract_amendment(p_amendment_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_a public.equipment_contract_amendments%rowtype;
  v_contract public.equipment_contracts%rowtype;
  v_actor uuid;
  v_doc_status public.document_status;
  v_old_end date;
  v_new_end date;
  v_after jsonb;
begin
  perform private.assert_equipment_contract_child_tenant('AMENDMENT',p_amendment_id);
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.contracts.manage') then raise exception 'PERMISSION_DENIED'; end if;
  select * into v_a from public.equipment_contract_amendments where id=p_amendment_id for update;
  if v_a.id is null then raise exception 'AMENDMENT_NOT_FOUND'; end if;
  if v_a.status<>'APPROVED' then raise exception 'AMENDMENT_NOT_APPROVED'; end if;
  if v_a.effective_on>current_date then raise exception 'AMENDMENT_NOT_EFFECTIVE_YET'; end if;
  select * into v_contract from public.equipment_contracts where id=v_a.contract_id for update;
  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if v_contract.status not in ('ACTIVE','SUSPENDED') then raise exception 'CONTRACT_NOT_ACTIVE_OR_SUSPENDED'; end if;
  if public.equipment_contract_legal_snapshot(v_contract.id) is distinct from v_a.before_snapshot then raise exception 'CONTRACT_CHANGED_SINCE_DRAFT'; end if;
  select status into v_doc_status from public.documents where id=v_a.document_id for update;
  if v_doc_status not in ('SIGNED'::public.document_status,'ACTIVE'::public.document_status) then raise exception 'AMENDMENT_DOCUMENT_MUST_BE_SIGNED'; end if;

  if v_a.amendment_kind='EQUIPMENT_COMPOSITION' then
    return private.apply_equipment_contract_composition_amendment(v_a.id);
  end if;

  v_old_end:=v_contract.ends_on;
  perform set_config('app.equipment_contract_amendment_apply','1',true);
  update public.equipment_contracts c set
    ends_on=case when v_a.proposed_changes ? 'ends_on' then nullif(v_a.proposed_changes->>'ends_on','')::date else c.ends_on end,
    hub_share_percent=case when v_a.proposed_changes ? 'hub_share_percent' then (v_a.proposed_changes->>'hub_share_percent')::numeric else c.hub_share_percent end,
    owner_share_percent=case when v_a.proposed_changes ? 'owner_share_percent' then (v_a.proposed_changes->>'owner_share_percent')::numeric else c.owner_share_percent end,
    calculation_basis=case when v_a.proposed_changes ? 'calculation_basis' then v_a.proposed_changes->>'calculation_basis' else c.calculation_basis end,
    direct_costs_before_split=case when v_a.proposed_changes ? 'direct_costs_before_split' then (v_a.proposed_changes->>'direct_costs_before_split')::boolean else c.direct_costs_before_split end,
    settlement_frequency=case when v_a.proposed_changes ? 'settlement_frequency' then v_a.proposed_changes->>'settlement_frequency' else c.settlement_frequency end,
    settlement_day=case when v_a.proposed_changes ? 'settlement_day' then nullif(v_a.proposed_changes->>'settlement_day','')::integer else c.settlement_day end,
    repair_responsibility=case when v_a.proposed_changes ? 'repair_responsibility' then v_a.proposed_changes->>'repair_responsibility' else c.repair_responsibility end,
    early_termination_notice_days=case when v_a.proposed_changes ? 'early_termination_notice_days' then (v_a.proposed_changes->>'early_termination_notice_days')::integer else c.early_termination_notice_days end,
    lease_period_amount=case when v_a.proposed_changes ? 'lease_period_amount' then round((v_a.proposed_changes->>'lease_period_amount')::numeric,2) else c.lease_period_amount end,
    buyout_enabled=case when v_a.proposed_changes ? 'buyout_enabled' then (v_a.proposed_changes->>'buyout_enabled')::boolean else c.buyout_enabled end,
    buyout_price=case when v_a.proposed_changes ? 'buyout_price' then nullif(v_a.proposed_changes->>'buyout_price','')::numeric else c.buyout_price end,
    buyout_credit_percent=case when v_a.proposed_changes ? 'buyout_credit_percent' then (v_a.proposed_changes->>'buyout_credit_percent')::numeric else c.buyout_credit_percent end,
    terms=case when v_a.proposed_changes ? 'terms' then v_a.proposed_changes->'terms' else c.terms end
  where c.id=v_contract.id
  returning ends_on into v_new_end;

  if v_a.proposed_changes ? 'ends_on' then
    update public.equipment_contract_assets ca set ends_on=v_new_end
     where ca.contract_id=v_contract.id and (ca.ends_on is not distinct from v_old_end or ca.ends_on is null);
  end if;

  v_after:=public.equipment_contract_legal_snapshot(v_contract.id);
  v_actor:=public.current_staff_user_id();
  update public.equipment_contract_amendments set status='APPLIED',after_snapshot=v_after,applied_by=v_actor,applied_at=clock_timestamp() where id=v_a.id;
  if v_doc_status='SIGNED'::public.document_status then
    update public.documents set status='ACTIVE'::public.document_status,updated_at=clock_timestamp() where id=v_a.document_id;
    insert into public.document_status_history(document_id,old_status,new_status,changed_by,comment)
    values(v_a.document_id,v_doc_status,'ACTIVE'::public.document_status,v_actor,'Условия допсоглашения применены к договору');
  end if;
  return v_a.id;
end
$function$
;

CREATE OR REPLACE FUNCTION public.save_equipment_contract(p_contract_id uuid, p_partner_id uuid, p_contract_number text, p_contract_type text, p_status text, p_starts_on date, p_ends_on date, p_hub_share_percent numeric, p_owner_share_percent numeric, p_calculation_basis text, p_direct_costs_before_split boolean, p_settlement_frequency text, p_settlement_day integer, p_repair_responsibility text, p_early_termination_notice_days integer, p_buyout_enabled boolean, p_buyout_price numeric, p_currency text, p_notes text, p_equipment_ids uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_id uuid;
  v_equipment_id uuid;
  v_existing public.equipment_contracts%rowtype;
begin
  perform private.assert_equipment_contract_tenant(p_contract_id);
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
      if v_existing.partner_id is distinct from p_partner_id or v_existing.contract_number is distinct from btrim(p_contract_number) or v_existing.contract_type is distinct from p_contract_type or v_existing.starts_on is distinct from p_starts_on or v_existing.ends_on is distinct from p_ends_on or v_existing.hub_share_percent is distinct from coalesce(p_hub_share_percent,70) or v_existing.owner_share_percent is distinct from coalesce(p_owner_share_percent,30) or v_existing.calculation_basis is distinct from p_calculation_basis or v_existing.direct_costs_before_split is distinct from coalesce(p_direct_costs_before_split,false) or v_existing.settlement_frequency is distinct from p_settlement_frequency or v_existing.settlement_day is distinct from p_settlement_day or v_existing.repair_responsibility is distinct from p_repair_responsibility or v_existing.early_termination_notice_days is distinct from coalesce(p_early_termination_notice_days,30) or v_existing.buyout_enabled is distinct from coalesce(p_buyout_enabled,false) or v_existing.buyout_price is distinct from p_buyout_price or v_existing.currency is distinct from coalesce(nullif(upper(btrim(p_currency)),''),'RUB') then
        raise exception 'ACTIVE_CONTRACT_REQUIRES_AMENDMENT';
      end if;
      if exists(select ca.equipment_id from public.equipment_contract_assets ca where ca.contract_id=v_existing.id and ca.starts_on<=current_date and current_date<=coalesce(ca.ends_on,'infinity'::date) except select unnest(coalesce(p_equipment_ids,'{}'::uuid[]))) or exists(select unnest(coalesce(p_equipment_ids,'{}'::uuid[])) except select ca.equipment_id from public.equipment_contract_assets ca where ca.contract_id=v_existing.id and ca.starts_on<=current_date and current_date<=coalesce(ca.ends_on,'infinity'::date)) then
        raise exception 'ACTIVE_CONTRACT_EQUIPMENT_CHANGE_REQUIRES_NEW_ANNEX';
      end if;
      update public.equipment_contracts set status=p_status,notes=nullif(btrim(coalesce(p_notes,'')),'') where id=v_existing.id;
      return v_existing.id;
    end if;
    update public.equipment_contracts set partner_id=p_partner_id,contract_number=btrim(p_contract_number),contract_type=p_contract_type,status=p_status,starts_on=p_starts_on,ends_on=p_ends_on,hub_share_percent=coalesce(p_hub_share_percent,70),owner_share_percent=coalesce(p_owner_share_percent,30),calculation_basis=p_calculation_basis,direct_costs_before_split=coalesce(p_direct_costs_before_split,false),settlement_frequency=p_settlement_frequency,settlement_day=p_settlement_day,repair_responsibility=p_repair_responsibility,early_termination_notice_days=coalesce(p_early_termination_notice_days,30),buyout_enabled=coalesce(p_buyout_enabled,false),buyout_price=p_buyout_price,currency=coalesce(nullif(upper(btrim(p_currency)),''),'RUB'),notes=nullif(btrim(coalesce(p_notes,'')),'') where id=p_contract_id;
    v_id:=p_contract_id;
  end if;

  perform set_config('app.equipment_contract_initial_composition_save','1',true);
  delete from public.equipment_contract_assets where contract_id=v_id;
  foreach v_equipment_id in array coalesce(p_equipment_ids,'{}'::uuid[]) loop
    if not exists(select 1 from public.equipment_assets a where a.id=v_equipment_id) then raise exception 'EQUIPMENT_NOT_FOUND: %',v_equipment_id; end if;
    insert into public.equipment_contract_assets(contract_id,equipment_id,starts_on,ends_on) values(v_id,v_equipment_id,p_starts_on,p_ends_on) on conflict(contract_id,equipment_id) do nothing;
  end loop;
  return v_id;
end
$function$
;

CREATE OR REPLACE FUNCTION public.get_partner_equipment_cabinet()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_partner_id uuid;
  v_partner jsonb;
  v_contracts jsonb;
  v_equipment jsonb;
  v_settlements jsonb;
  v_lease_charges jsonb;
  v_terminations jsonb;
  v_incidents jsonb;
  v_documents jsonb;
  v_summary jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  v_partner_id := public.current_partner_id();
  if v_partner_id is null then raise exception 'PARTNER_ACCESS_REQUIRED'; end if;

  select jsonb_build_object(
    'id',p.id,
    'name',p.name,
    'legal_name',p.legal_name,
    'legal_form',p.legal_form,
    'tax_id',p.tax_id,
    'registration_number',p.registration_number,
    'contact_name',p.contact_name,
    'email',p.email,
    'phone',p.phone,
    'address',p.address
  ) into v_partner
  from public.partners p
  where p.id=v_partner_id and p.is_active=true;

  if v_partner is null then raise exception 'PARTNER_DISABLED'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,
    'contract_number',c.contract_number,
    'contract_type',c.contract_type,
    'status',c.status,
    'starts_on',c.starts_on,
    'ends_on',c.ends_on,
    'hub_share_percent',c.hub_share_percent,
    'owner_share_percent',c.owner_share_percent,
    'calculation_basis',c.calculation_basis,
    'direct_costs_before_split',c.direct_costs_before_split,
    'settlement_frequency',c.settlement_frequency,
    'settlement_day',c.settlement_day,
    'repair_responsibility',c.repair_responsibility,
    'early_termination_notice_days',c.early_termination_notice_days,
    'lease_period_amount',c.lease_period_amount,
    'buyout_enabled',c.buyout_enabled,
    'buyout_price',c.buyout_price,
    'buyout_credit_percent',c.buyout_credit_percent,
    'buyout_completed_at',c.buyout_completed_at,
    'buyout_transfer_reference',c.buyout_transfer_reference,
    'currency',c.currency,
    'terms',c.terms,
    'notes',c.notes,
    'equipment_count',(select count(distinct ca.equipment_id) from public.equipment_contract_assets ca where ca.contract_id=c.id)
  ) order by c.starts_on desc,c.created_at desc),'[]'::jsonb)
  into v_contracts
  from public.equipment_contracts c
  where c.partner_id=v_partner_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,
    'inventory_number',a.inventory_number,
    'name',a.name,
    'category',a.category,
    'brand',a.brand,
    'model',a.model,
    'serial_number',a.serial_number,
    'location',a.location,
    'lifecycle_status',a.status,
    'ownership_type',a.ownership_type,
    'operational_status',a.operational_status,
    'manufacture_year',a.manufacture_year,
    'market_value',a.market_value,
    'received_at',a.received_at,
    'commissioned_at',a.commissioned_at,
    'contracts',coalesce((
      select jsonb_agg(jsonb_build_object(
        'contract_id',c.id,
        'contract_number',c.contract_number,
        'contract_status',c.status,
        'starts_on',coalesce(ca.starts_on,c.starts_on),
        'ends_on',coalesce(ca.ends_on,c.ends_on)
      ) order by coalesce(ca.starts_on,c.starts_on) desc)
      from public.equipment_contract_assets ca
      join public.equipment_contracts c on c.id=ca.contract_id
      where ca.equipment_id=a.id and c.partner_id=v_partner_id
    ),'[]'::jsonb)
  ) order by a.inventory_number),'[]'::jsonb)
  into v_equipment
  from public.equipment_assets a
  where a.id in (
    select ca.equipment_id
    from public.equipment_contract_assets ca
    join public.equipment_contracts c on c.id=ca.contract_id
    where c.partner_id=v_partner_id
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,
    'contract_id',s.contract_id,
    'contract_number',c.contract_number,
    'period_start',s.period_start,
    'period_end',s.period_end,
    'status',s.status,
    'calculation_basis',s.calculation_basis,
    'gross_revenue',s.gross_revenue,
    'received_revenue',s.received_revenue,
    'direct_costs',s.direct_costs,
    'split_base',s.split_base,
    'owner_share_percent',s.owner_share_percent,
    'owner_amount',s.owner_amount,
    'currency',s.currency,
    'paid_at',s.paid_at,
    'payment_reference',s.payment_reference
  ) order by s.period_end desc,s.created_at desc),'[]'::jsonb)
  into v_settlements
  from public.equipment_owner_settlements s
  join public.equipment_contracts c on c.id=s.contract_id
  where s.partner_id=v_partner_id and c.partner_id=v_partner_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',lc.id,
    'contract_id',lc.contract_id,
    'contract_number',c.contract_number,
    'charge_type',lc.charge_type,
    'period_start',lc.period_start,
    'period_end',lc.period_end,
    'amount',lc.amount,
    'buyout_credit_amount',lc.buyout_credit_amount,
    'status',lc.status,
    'currency',lc.currency,
    'paid_at',lc.paid_at,
    'payment_reference',lc.payment_reference
  ) order by lc.period_end desc,lc.created_at desc),'[]'::jsonb)
  into v_lease_charges
  from public.equipment_lease_charges lc
  join public.equipment_contracts c on c.id=lc.contract_id
  where lc.partner_id=v_partner_id and c.partner_id=v_partner_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,
    'contract_id',t.contract_id,
    'contract_number',c.contract_number,
    'status',t.status,
    'initiated_by_party',t.initiated_by_party,
    'notice_date',t.notice_date,
    'requested_end_date',t.requested_end_date,
    'effective_end_date',t.effective_end_date,
    'notice_waived',t.notice_waived,
    'waiver_reason',t.waiver_reason,
    'reason',t.reason,
    'return_reference',t.return_reference,
    'financial_clearance_reference',t.financial_clearance_reference,
    'final_notes',t.final_notes,
    'completed_at',t.completed_at
  ) order by t.created_at desc),'[]'::jsonb)
  into v_terminations
  from public.equipment_contract_terminations t
  join public.equipment_contracts c on c.id=t.contract_id
  where t.partner_id=v_partner_id and c.partner_id=v_partner_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,
    'equipment_id',i.equipment_id,
    'inventory_number',a.inventory_number,
    'equipment_name',a.name,
    'reported_at',i.reported_at,
    'description',i.description,
    'severity',i.severity,
    'status',i.status,
    'resolution',case when i.status in ('RESOLVED','CLOSED') then i.resolution else null end,
    'downtime_started_at',i.downtime_started_at,
    'downtime_ended_at',i.downtime_ended_at,
    'resolved_at',i.resolved_at
  ) order by i.reported_at desc),'[]'::jsonb)
  into v_incidents
  from public.equipment_incidents i
  join public.equipment_assets a on a.id=i.equipment_id
  where i.equipment_id in (
    select ca.equipment_id
    from public.equipment_contract_assets ca
    join public.equipment_contracts c on c.id=ca.contract_id
    where c.partner_id=v_partner_id
  );

  select coalesce(jsonb_agg(jsonb_build_object(
    'document_id',d.id,
    'document_number',d.document_number,
    'document_type_code',dt.code,
    'document_type_name',dt.name,
    'title',d.title,
    'status',d.status,
    'issue_date',d.issue_date,
    'valid_from',d.valid_from,
    'valid_until',d.valid_until,
    'signed_at',d.signed_at,
    'archived_at',d.archived_at,
    'contract_id',cl.entity_id,
    'contract_number',c.contract_number
  ) order by d.issue_date desc,d.created_at desc),'[]'::jsonb)
  into v_documents
  from public.documents d
  join public.document_types dt on dt.id=d.document_type_id
  join public.document_links pl on pl.document_id=d.id and pl.entity_type='PARTNER' and pl.entity_id=v_partner_id
  join public.document_links cl on cl.document_id=d.id and cl.entity_type='EQUIPMENT_CONTRACT'
  join public.equipment_contracts c on c.id=cl.entity_id and c.partner_id=v_partner_id
  where dt.code in ('EQ_ACCEPTANCE_ACT','EQ_ASSET_LIST','EQ_TERMS_APPENDIX','EQ_RETURN_ACT','EQ_RECONCILIATION_ACT')
    and d.status in ('APPROVED','SIGNED','ACTIVE','TERMINATED','ARCHIVED');

  select jsonb_build_object(
    'contract_count',(select count(*) from public.equipment_contracts c where c.partner_id=v_partner_id),
    'active_contract_count',(select count(*) from public.equipment_contracts c where c.partner_id=v_partner_id and c.status='ACTIVE'),
    'equipment_count',(select count(distinct ca.equipment_id) from public.equipment_contract_assets ca join public.equipment_contracts c on c.id=ca.contract_id where c.partner_id=v_partner_id),
    'open_incident_count',(select count(*) from public.equipment_incidents i where i.equipment_id in (select ca.equipment_id from public.equipment_contract_assets ca join public.equipment_contracts c on c.id=ca.contract_id where c.partner_id=v_partner_id) and i.status in ('OPEN','DIAGNOSING','WAITING_PARTS','REPAIRING')),
    'owner_amount_total',(select coalesce(sum(s.owner_amount),0) from public.equipment_owner_settlements s where s.partner_id=v_partner_id),
    'owner_amount_paid',(select coalesce(sum(s.owner_amount),0) from public.equipment_owner_settlements s where s.partner_id=v_partner_id and s.status='PAID'),
    'lease_amount_total',(select coalesce(sum(lc.amount),0) from public.equipment_lease_charges lc where lc.partner_id=v_partner_id),
    'lease_amount_paid',(select coalesce(sum(lc.amount),0) from public.equipment_lease_charges lc where lc.partner_id=v_partner_id and lc.status='PAID'),
    'buyout_credit_paid',(select coalesce(sum(lc.buyout_credit_amount),0) from public.equipment_lease_charges lc where lc.partner_id=v_partner_id and lc.status='PAID')
  ) into v_summary;

  return jsonb_build_object(
    'partner',v_partner,
    'summary',v_summary,
    'contracts',v_contracts,
    'equipment',v_equipment,
    'settlements',v_settlements,
    'lease_charges',v_lease_charges,
    'terminations',v_terminations,
    'incidents',v_incidents,
    'documents',v_documents,
    'generated_at',clock_timestamp()
  );
end
$function$
;

CREATE OR REPLACE FUNCTION public.guard_equipment_termination_return_inspections()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.status='COMPLETED' and old.status is distinct from 'COMPLETED' then
    if exists(
      select 1
      from public.equipment_contract_assets ca
      where ca.contract_id=new.contract_id
        and ca.starts_on<=new.effective_end_date
        and new.effective_end_date<=coalesce(ca.ends_on,'infinity'::date)
        and not exists(
          select 1
          from public.equipment_condition_inspections i
          where i.contract_id=new.contract_id
            and i.equipment_id=ca.equipment_id
            and i.termination_id=new.id
            and i.inspection_type='RETURN'
            and i.status='COMPLETED'
        )
    ) then
      raise exception 'RETURN_INSPECTION_REQUIRED';
    end if;
  end if;
  return new;
end
$function$
;

CREATE OR REPLACE FUNCTION public.guard_equipment_termination_condition_comparisons()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  if new.status='COMPLETED' and old.status is distinct from 'COMPLETED' then
    select count(*)::integer into v_count
    from public.equipment_contract_assets ca
    where ca.contract_id=new.contract_id
      and ca.starts_on<=new.effective_end_date
      and new.effective_end_date<=coalesce(ca.ends_on,'infinity'::date)
      and exists(
        select 1
        from public.equipment_condition_inspections i
        where i.contract_id=new.contract_id
          and i.equipment_id=ca.equipment_id
          and i.termination_id=new.id
          and i.inspection_type='RETURN'
          and i.status='COMPLETED'
      )
      and not exists(
        select 1
        from public.equipment_condition_inspections i
        join public.equipment_condition_comparisons c
          on c.return_inspection_id=i.id
        where i.contract_id=new.contract_id
          and i.equipment_id=ca.equipment_id
          and i.termination_id=new.id
          and i.inspection_type='RETURN'
          and i.status='COMPLETED'
          and c.termination_id=new.id
      );

    if v_count>0 then
      raise exception 'CONDITION_COMPARISON_REQUIRED:%',v_count;
    end if;

    select count(*)::integer into v_count
    from public.equipment_condition_comparisons c
    where c.termination_id=new.id
      and c.comparison_status='OPEN';

    if v_count>0 then
      raise exception 'CONDITION_COMPARISON_RESOLUTION_REQUIRED:%',v_count;
    end if;
  end if;

  return new;
end
$function$
;

CREATE OR REPLACE FUNCTION public.get_equipment_condition_inspection_targets()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
begin
  if not public.has_permission('equipment.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;

  select coalesce(
    jsonb_agg(to_jsonb(x) order by x.partner_name,x.contract_number,x.inventory_number),
    '[]'::jsonb
  ) into v_result
  from (
    select
      c.id contract_id,
      c.contract_number,
      c.status contract_status,
      c.starts_on,
      c.ends_on,
      c.partner_id,
      coalesce(p.legal_name,p.name) partner_name,
      a.id equipment_id,
      a.inventory_number,
      a.name equipment_name,
      a.brand,
      a.model,
      a.serial_number,
      a.location,
      a.operational_status,
      (
        select t.id
        from public.equipment_contract_terminations t
        where t.contract_id=c.id
          and t.status in ('NOTICE','PREPARING','READY')
        order by t.created_at desc
        limit 1
      ) termination_id,
      (
        select t.status
        from public.equipment_contract_terminations t
        where t.contract_id=c.id
          and t.status in ('NOTICE','PREPARING','READY')
        order by t.created_at desc
        limit 1
      ) termination_status,
      exists(
        select 1
        from public.equipment_condition_inspections i
        where i.contract_id=c.id
          and i.equipment_id=a.id
          and i.inspection_type='ACCEPTANCE'
          and i.status='COMPLETED'
      ) has_acceptance_inspection
    from public.equipment_contracts c
    join public.partners p on p.id=c.partner_id
    join public.equipment_contract_assets ca
      on ca.contract_id=c.id
     and ca.starts_on<=current_date
     and current_date<=coalesce(ca.ends_on,'infinity'::date)
    join public.equipment_assets a on a.id=ca.equipment_id
    where c.status in ('ACTIVE','SUSPENDED')
  ) x;

  return v_result;
end
$function$
;

CREATE OR REPLACE FUNCTION public.get_equipment_contract_termination_condition_preflight(p_termination_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_t public.equipment_contract_terminations%rowtype;
  v_equipment_count integer:=0;
  v_completed_returns integer:=0;
  v_missing_returns integer:=0;
  v_missing_comparisons integer:=0;
  v_open_comparisons integer:=0;
  v_missing_return_items jsonb:='[]'::jsonb;
  v_missing_comparison_items jsonb:='[]'::jsonb;
  v_open_comparison_items jsonb:='[]'::jsonb;
begin
  perform private.assert_equipment_contract_child_tenant('TERMINATION',p_termination_id);
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.contracts.manage') then raise exception 'PERMISSION_DENIED'; end if;

  select * into v_t
    from public.equipment_contract_terminations
   where id=p_termination_id;
  if v_t.id is null then raise exception 'TERMINATION_NOT_FOUND'; end if;

  select count(*)::integer into v_equipment_count
    from public.equipment_contract_assets ca
   where ca.contract_id=v_t.contract_id and ca.starts_on<=v_t.effective_end_date and v_t.effective_end_date<=coalesce(ca.ends_on,'infinity'::date);

  select count(*)::integer into v_completed_returns
    from public.equipment_contract_assets ca
   where ca.contract_id=v_t.contract_id
     and ca.starts_on<=v_t.effective_end_date
     and v_t.effective_end_date<=coalesce(ca.ends_on,'infinity'::date)
     and exists(
       select 1 from public.equipment_condition_inspections i
        where i.contract_id=v_t.contract_id
          and i.equipment_id=ca.equipment_id
          and i.termination_id=v_t.id
          and i.inspection_type='RETURN'
          and i.status='COMPLETED'
     );

  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'equipment_id',a.id,
           'inventory_number',a.inventory_number,
           'equipment_name',a.name,
           'brand',a.brand,
           'model',a.model,
           'serial_number',a.serial_number
         ) order by a.inventory_number,a.name),'[]'::jsonb)
    into v_missing_returns,v_missing_return_items
    from public.equipment_contract_assets ca
    join public.equipment_assets a on a.id=ca.equipment_id
   where ca.contract_id=v_t.contract_id
     and ca.starts_on<=v_t.effective_end_date
     and v_t.effective_end_date<=coalesce(ca.ends_on,'infinity'::date)
     and not exists(
       select 1 from public.equipment_condition_inspections i
        where i.contract_id=v_t.contract_id
          and i.equipment_id=ca.equipment_id
          and i.termination_id=v_t.id
          and i.inspection_type='RETURN'
          and i.status='COMPLETED'
     );

  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'equipment_id',a.id,
           'inventory_number',a.inventory_number,
           'equipment_name',a.name,
           'brand',a.brand,
           'model',a.model,
           'serial_number',a.serial_number
         ) order by a.inventory_number,a.name),'[]'::jsonb)
    into v_missing_comparisons,v_missing_comparison_items
    from public.equipment_contract_assets ca
    join public.equipment_assets a on a.id=ca.equipment_id
   where ca.contract_id=v_t.contract_id
     and ca.starts_on<=v_t.effective_end_date
     and v_t.effective_end_date<=coalesce(ca.ends_on,'infinity'::date)
     and exists(
       select 1 from public.equipment_condition_inspections i
        where i.contract_id=v_t.contract_id
          and i.equipment_id=ca.equipment_id
          and i.termination_id=v_t.id
          and i.inspection_type='RETURN'
          and i.status='COMPLETED'
     )
     and not exists(
       select 1
         from public.equipment_condition_inspections i
         join public.equipment_condition_comparisons c on c.return_inspection_id=i.id
        where i.contract_id=v_t.contract_id
          and i.equipment_id=ca.equipment_id
          and i.termination_id=v_t.id
          and i.inspection_type='RETURN'
          and i.status='COMPLETED'
          and c.termination_id=v_t.id
     );

  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'comparison_id',c.id,
           'equipment_id',a.id,
           'inventory_number',a.inventory_number,
           'equipment_name',a.name,
           'brand',a.brand,
           'model',a.model,
           'serial_number',a.serial_number,
           'material_change',c.material_change,
           'document_id',c.document_id,
           'partner_response_status',lr.response_status,
           'partner_response_comment',lr.comment
         ) order by a.inventory_number,a.name),'[]'::jsonb)
    into v_open_comparisons,v_open_comparison_items
    from public.equipment_condition_comparisons c
    join public.equipment_assets a on a.id=c.equipment_id
    left join lateral (
      select r.response_status,r.comment
        from public.equipment_condition_comparison_responses r
       where r.comparison_id=c.id
       order by r.event_sequence desc
       limit 1
    ) lr on true
   where c.termination_id=v_t.id
     and c.comparison_status='OPEN';

  return jsonb_build_object(
    'termination_id',v_t.id,
    'contract_id',v_t.contract_id,
    'termination_status',v_t.status,
    'effective_end_date',v_t.effective_end_date,
    'date_reached',current_date>=v_t.effective_end_date,
    'equipment_count',v_equipment_count,
    'completed_return_inspections_count',v_completed_returns,
    'missing_return_inspections_count',v_missing_returns,
    'missing_return_inspections',v_missing_return_items,
    'missing_condition_comparisons_count',v_missing_comparisons,
    'missing_condition_comparisons',v_missing_comparison_items,
    'open_condition_comparisons_count',v_open_comparisons,
    'open_condition_comparisons',v_open_comparison_items,
    'condition_gate_clear',(v_missing_returns=0 and v_missing_comparisons=0 and v_open_comparisons=0),
    'can_finalize_condition',(current_date>=v_t.effective_end_date and v_missing_returns=0 and v_missing_comparisons=0 and v_open_comparisons=0)
  );
end
$function$
;

CREATE OR REPLACE FUNCTION public.finalize_equipment_contract_termination(p_termination_id uuid, p_return_reference text, p_financial_clearance_reference text, p_document_id uuid DEFAULT NULL::uuid, p_final_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_t public.equipment_contract_terminations%rowtype;
  v_contract public.equipment_contracts%rowtype;
  v_actor uuid:=public.current_staff_user_id();
  v_count integer;
begin
  perform private.assert_equipment_contract_child_tenant('TERMINATION',p_termination_id);
  if not public.has_permission('equipment.contracts.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if nullif(btrim(coalesce(p_return_reference,'')),'') is null then raise exception 'RETURN_REFERENCE_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_financial_clearance_reference,'')),'') is null then raise exception 'FINANCIAL_CLEARANCE_REQUIRED'; end if;

  select * into v_t
    from public.equipment_contract_terminations
   where id=p_termination_id
   for update;
  if v_t.id is null then raise exception 'TERMINATION_NOT_FOUND'; end if;
  if v_t.status in ('COMPLETED','CANCELLED') then raise exception 'TERMINATION_FINAL'; end if;
  if current_date<v_t.effective_end_date then raise exception 'TERMINATION_DATE_NOT_REACHED'; end if;

  select * into v_contract
    from public.equipment_contracts
   where id=v_t.contract_id
   for update;
  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if v_contract.status not in ('ACTIVE','SUSPENDED') then raise exception 'CONTRACT_NOT_TERMINABLE'; end if;

  if p_document_id is not null
     and not exists(select 1 from public.documents where id=p_document_id)
  then raise exception 'DOCUMENT_NOT_FOUND'; end if;

  select count(*)::integer into v_count
    from public.equipment_contract_assets ca
   where ca.contract_id=v_contract.id
     and ca.starts_on<=v_t.effective_end_date
     and v_t.effective_end_date<=coalesce(ca.ends_on,'infinity'::date)
     and not exists(
       select 1 from public.equipment_condition_inspections i
        where i.contract_id=v_contract.id
          and i.equipment_id=ca.equipment_id
          and i.termination_id=v_t.id
          and i.inspection_type='RETURN'
          and i.status='COMPLETED'
     );
  if v_count>0 then raise exception 'RETURN_INSPECTION_REQUIRED:%',v_count; end if;

  select count(*)::integer into v_count
    from public.equipment_contract_assets ca
   where ca.contract_id=v_contract.id
     and ca.starts_on<=v_t.effective_end_date
     and v_t.effective_end_date<=coalesce(ca.ends_on,'infinity'::date)
     and exists(
       select 1 from public.equipment_condition_inspections i
        where i.contract_id=v_contract.id
          and i.equipment_id=ca.equipment_id
          and i.termination_id=v_t.id
          and i.inspection_type='RETURN'
          and i.status='COMPLETED'
     )
     and not exists(
       select 1
         from public.equipment_condition_inspections i
         join public.equipment_condition_comparisons c on c.return_inspection_id=i.id
        where i.contract_id=v_contract.id
          and i.equipment_id=ca.equipment_id
          and i.termination_id=v_t.id
          and i.inspection_type='RETURN'
          and i.status='COMPLETED'
          and c.termination_id=v_t.id
     );
  if v_count>0 then raise exception 'CONDITION_COMPARISON_REQUIRED:%',v_count; end if;

  select count(*)::integer into v_count
    from public.equipment_condition_comparisons c
   where c.termination_id=v_t.id
     and c.comparison_status='OPEN';
  if v_count>0 then raise exception 'CONDITION_COMPARISON_RESOLUTION_REQUIRED:%',v_count; end if;

  update public.equipment_contract_terminations
     set status='READY',
         return_reference=btrim(p_return_reference),
         financial_clearance_reference=btrim(p_financial_clearance_reference),
         final_notes=nullif(btrim(coalesce(p_final_notes,'')),'')
   where id=v_t.id;

  perform set_config('app.equipment_contract_termination_finalize','1',true);

  update public.equipment_contract_assets
     set ends_on=v_t.effective_end_date
   where contract_id=v_contract.id
     and starts_on<=v_t.effective_end_date
     and v_t.effective_end_date<=coalesce(ends_on,'infinity'::date);

  update public.equipment_assets a
     set operational_status='OFFLINE',updated_at=clock_timestamp()
   where a.id in (
     select ca.equipment_id from public.equipment_contract_assets ca where ca.contract_id=v_contract.id and ca.starts_on<=v_t.effective_end_date and v_t.effective_end_date<=coalesce(ca.ends_on,'infinity'::date)
   )
     and a.current_owner_partner_id=v_contract.partner_id
     and a.ownership_type in ('PARTNER','LEASE','LEASE_BUYOUT')
     and not exists(
       select 1
         from public.equipment_contract_assets ca2
         join public.equipment_contracts c2 on c2.id=ca2.contract_id
        where ca2.equipment_id=a.id
          and c2.id<>v_contract.id
          and c2.status='ACTIVE'
          and coalesce(ca2.starts_on,c2.starts_on)<=v_t.effective_end_date
          and (ca2.ends_on is null or ca2.ends_on>=v_t.effective_end_date)
     );

  update public.equipment_contracts
     set status='TERMINATED',ends_on=v_t.effective_end_date,updated_at=clock_timestamp()
   where id=v_contract.id;

  if p_document_id is not null then
    insert into public.document_links(document_id,entity_type,entity_id,relationship)
    select p_document_id,'EQUIPMENT_CONTRACT_TERMINATION',v_t.id,'RETURN_ACT'
     where not exists(
       select 1 from public.document_links dl
        where dl.document_id=p_document_id
          and dl.entity_type='EQUIPMENT_CONTRACT_TERMINATION'
          and dl.entity_id=v_t.id
          and dl.relationship='RETURN_ACT'
     );
  end if;

  update public.equipment_contract_terminations
     set status='COMPLETED',completed_by=v_actor,completed_at=clock_timestamp()
   where id=v_t.id;

  perform public.notify_equipment_contract_termination(v_t.id,'COMPLETED');
  return v_t.id;
end
$function$
;

revoke all on function public.equipment_contract_legal_snapshot(uuid)
from public,anon,authenticated;

revoke all on function public.guard_equipment_contract_asset_period_overlap()
from public,anon,authenticated;

drop trigger if exists trg_equipment_contract_assets_period_overlap
on public.equipment_contract_assets;

create trigger trg_equipment_contract_assets_period_overlap
before insert or update of contract_id,equipment_id,starts_on,ends_on
on public.equipment_contract_assets
for each row execute function public.guard_equipment_contract_asset_period_overlap();

revoke all on function public.guard_closed_equipment_contract_asset()
from public,anon,authenticated;

revoke all on function public.create_equipment_composition_amendment(uuid,date,jsonb,jsonb,text)
from public,anon,authenticated;
grant execute on function public.create_equipment_composition_amendment(uuid,date,jsonb,jsonb,text)
to authenticated;

revoke all on function private.apply_equipment_contract_composition_amendment(uuid)
from public,anon,authenticated;

create or replace view public.equipment_buyout_overview
with (security_invoker=true) as
SELECT c.id AS contract_id,
    c.partner_id,
    p.name AS partner_name,
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
    COALESCE(a.equipment_count, 0) AS equipment_count,
    COALESCE(ch.total_paid, 0::numeric)::numeric(14,2) AS total_paid,
    COALESCE(ch.lease_paid, 0::numeric)::numeric(14,2) AS lease_paid,
    COALESCE(ch.extra_buyout_paid, 0::numeric)::numeric(14,2) AS extra_buyout_paid,
    COALESCE(ch.buyout_credited, 0::numeric)::numeric(14,2) AS buyout_credited,
    GREATEST(COALESCE(c.buyout_price, 0::numeric) - COALESCE(ch.buyout_credited, 0::numeric), 0::numeric)::numeric(14,2) AS buyout_remaining,
    ch.last_paid_at
   FROM equipment_contracts c
     JOIN partners p ON p.id = c.partner_id
     LEFT JOIN LATERAL ( SELECT count(DISTINCT ca.equipment_id)::integer AS equipment_count
           FROM equipment_contract_assets ca
          WHERE ca.contract_id = c.id) a ON true
     LEFT JOIN LATERAL ( SELECT COALESCE(sum(x.amount) FILTER (WHERE x.status = 'PAID'::text), 0::numeric) AS total_paid,
            COALESCE(sum(x.amount) FILTER (WHERE x.status = 'PAID'::text AND x.charge_type = 'LEASE'::text), 0::numeric) AS lease_paid,
            COALESCE(sum(x.amount) FILTER (WHERE x.status = 'PAID'::text AND x.charge_type = 'BUYOUT_EXTRA'::text), 0::numeric) AS extra_buyout_paid,
            COALESCE(sum(x.buyout_credit_amount) FILTER (WHERE x.status = 'PAID'::text), 0::numeric) AS buyout_credited,
            max(x.paid_at) FILTER (WHERE x.status = 'PAID'::text) AS last_paid_at
           FROM equipment_lease_charges x
          WHERE x.contract_id = c.id) ch ON true
  WHERE c.contract_type = ANY (ARRAY['LEASE'::text, 'LEASE_BUYOUT'::text]);

create or replace view public.equipment_contract_termination_overview
with (security_invoker=true) as
SELECT t.id AS termination_id,
    t.contract_id,
    c.contract_number,
    c.contract_type,
    c.status AS contract_status,
    c.partner_id,
    COALESCE(p.legal_name, p.name, '—'::text) AS partner_name,
    c.early_termination_notice_days,
    t.status,
    t.initiated_by_party,
    t.notice_date,
    t.requested_end_date,
    t.effective_end_date,
    t.notice_waived,
    t.waiver_reason,
    t.reason,
    t.return_reference,
    t.financial_clearance_reference,
    t.final_notes,
    t.created_by,
    t.completed_by,
    t.created_at,
    t.updated_at,
    t.completed_at,
    ( SELECT count(DISTINCT ca.equipment_id)::integer AS count
           FROM equipment_contract_assets ca
          WHERE ca.contract_id = c.id AND ca.starts_on <= t.effective_end_date AND t.effective_end_date <= COALESCE(ca.ends_on, 'infinity'::date)) AS equipment_count,
    ( SELECT count(*)::integer AS count
           FROM production_jobs j
          WHERE (j.equipment_id IN ( SELECT ca.equipment_id
                   FROM equipment_contract_assets ca
                  WHERE ca.contract_id = c.id AND ca.starts_on <= t.effective_end_date AND t.effective_end_date <= COALESCE(ca.ends_on, 'infinity'::date))) AND (j.status = ANY (ARRAY['NEW'::production_status, 'QUEUED'::production_status, 'IN_PROGRESS'::production_status, 'PAUSED'::production_status]))) AS open_jobs_count,
    ( SELECT count(*)::integer AS count
           FROM equipment_incidents i
          WHERE (i.equipment_id IN ( SELECT ca.equipment_id
                   FROM equipment_contract_assets ca
                  WHERE ca.contract_id = c.id AND ca.starts_on <= t.effective_end_date AND t.effective_end_date <= COALESCE(ca.ends_on, 'infinity'::date))) AND (i.status = ANY (ARRAY['OPEN'::text, 'DIAGNOSING'::text, 'WAITING_PARTS'::text, 'REPAIRING'::text]))) AS open_incidents_count,
    ( SELECT count(*)::integer AS count
           FROM equipment_owner_settlements s
          WHERE s.contract_id = c.id AND (s.status = ANY (ARRAY['DRAFT'::text, 'APPROVED'::text]))) AS open_settlements_count,
    ( SELECT count(*)::integer AS count
           FROM equipment_lease_charges lc
          WHERE lc.contract_id = c.id AND (lc.status = ANY (ARRAY['DRAFT'::text, 'APPROVED'::text]))) AS open_lease_charges_count,
        CASE
            WHEN c.contract_type = 'REVENUE_SHARE'::text THEN ( SELECT count(*)::integer AS count
               FROM production_jobs j
                 JOIN equipment_contract_assets ca ON ca.contract_id = c.id AND ca.equipment_id = j.equipment_id
              WHERE j.status = 'DONE'::production_status AND j.completed_at IS NOT NULL AND j.completed_at::date >= GREATEST(c.starts_on, COALESCE(ca.starts_on, c.starts_on)) AND j.completed_at::date <= LEAST(t.effective_end_date, COALESCE(ca.ends_on, t.effective_end_date)) AND NOT (EXISTS ( SELECT 1
                       FROM equipment_owner_settlement_lines sl
                         JOIN equipment_owner_settlements s ON s.id = sl.settlement_id
                      WHERE sl.production_job_id = j.id AND s.contract_id = c.id AND s.status = 'PAID'::text)))
            ELSE 0
        END AS unsettled_jobs_count
   FROM equipment_contract_terminations t
     JOIN equipment_contracts c ON c.id = t.contract_id
     JOIN partners p ON p.id = c.partner_id;

select private.assert_production_farm_security_baseline();


-- Phase 42 final compatibility hardening: preserve the current multi-company
-- staff-context guard and the historical-period save model on a clean install.
do $$
declare
  v_oid oid;
  v_def text;
begin
  v_oid:=to_regprocedure(
    'public.create_equipment_composition_amendment(uuid,date,jsonb,jsonb,text)'
  );
  if v_oid is null then raise exception 'RPC_NOT_FOUND:create_equipment_composition_amendment'; end if;

  select pg_get_functiondef(v_oid) into v_def;

  if v_def not ilike '%private.assert_non_partner_staff_context(%' then
    v_def:=replace(
      v_def,
      'begin' || E'\n  perform private.assert_equipment_contract_tenant(p_contract_id);',
      'begin' || E'\n  perform private.assert_non_partner_staff_context();' ||
      E'\n  perform private.assert_equipment_contract_tenant(p_contract_id);'
    );
    execute v_def;
  end if;
end
$$;

do $$
declare
  v_oid oid;
  v_def text;
  v_old text;
  v_new text;
begin
  v_oid:=to_regprocedure(
    'public.save_equipment_contract(uuid,uuid,text,text,text,date,date,numeric,numeric,text,boolean,text,integer,text,integer,boolean,numeric,text,text,uuid[])'
  );
  if v_oid is null then raise exception 'RPC_NOT_FOUND:save_equipment_contract'; end if;

  select pg_get_functiondef(v_oid) into v_def;

  v_old:=
    '  perform set_config(''app.equipment_contract_initial_composition_save'',''1'',true);'||
    E'\n  delete from public.equipment_contract_assets where contract_id=v_id;'||
    E'\n  foreach v_equipment_id in array coalesce(p_equipment_ids,''{}''::uuid[]) loop'||
    E'\n    if not exists(select 1 from public.equipment_assets a where a.id=v_equipment_id) then raise exception ''EQUIPMENT_NOT_FOUND: %'',v_equipment_id; end if;'||
    E'\n    insert into public.equipment_contract_assets(contract_id,equipment_id,starts_on,ends_on) values(v_id,v_equipment_id,p_starts_on,p_ends_on) on conflict(contract_id,equipment_id) do nothing;'||
    E'\n  end loop;'||
    E'\n  return v_id;';

  v_new:=
    '  perform set_config(''app.equipment_contract_initial_composition_save'',''1'',true);'||
    E'\n  delete from public.equipment_contract_assets where contract_id=v_id;'||
    E'\n  foreach v_equipment_id in array coalesce(p_equipment_ids,''{}''::uuid[]) loop'||
    E'\n    perform private.assert_equipment_asset_tenant(v_equipment_id);'||
    E'\n    insert into public.equipment_contract_assets(contract_id,equipment_id,starts_on,ends_on) values(v_id,v_equipment_id,p_starts_on,p_ends_on);'||
    E'\n  end loop;'||
    E'\n  perform set_config(''app.equipment_contract_initial_composition_save'',''0'',true);'||
    E'\n  return v_id;';

  if position(v_old in v_def)>0 then
    execute replace(v_def,v_old,v_new);
  elsif v_def not ilike '%private.assert_equipment_asset_tenant(v_equipment_id)%'
        or v_def not ilike '%app.equipment_contract_initial_composition_save'',''0''%' then
    raise exception 'SAVE_CONTRACT_PERIOD_MODEL_PATCH_POINT_NOT_FOUND';
  end if;
end
$$;

select private.assert_production_farm_security_baseline();
