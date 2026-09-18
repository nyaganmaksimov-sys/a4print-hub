-- A4PRINT HUB: Production Farm Phase 45 — allocation weight annex + staff-context hardening.

alter table public.equipment_contract_amendments
  drop constraint equipment_contract_amendments_amendment_kind_check;

alter table public.equipment_contract_amendments
  add constraint equipment_contract_amendments_amendment_kind_check
  check(amendment_kind in (
    'RENEWAL','TERMS_CHANGE','EQUIPMENT_COMPOSITION','EQUIPMENT_ALLOCATION_WEIGHT'
  ));

create table public.equipment_contract_amendment_allocations(
  id uuid primary key default gen_random_uuid(),
  amendment_id uuid not null references public.equipment_contract_amendments(id) on delete cascade,
  contract_id uuid not null references public.equipment_contracts(id) on delete restrict,
  partner_id uuid not null references public.partners(id) on delete restrict,
  equipment_id uuid not null references public.equipment_assets(id) on delete restrict,
  source_contract_asset_id uuid not null references public.equipment_contract_assets(id) on delete restrict,
  result_contract_asset_id uuid null references public.equipment_contract_assets(id) on delete restrict,
  previous_allocation_weight numeric not null check(previous_allocation_weight>0),
  new_allocation_weight numeric not null check(new_allocation_weight>0),
  equipment_snapshot jsonb not null,
  note text null,
  created_at timestamptz not null default clock_timestamp(),
  unique(amendment_id,equipment_id)
);

create index idx_equipment_contract_amendment_allocations_contract
  on public.equipment_contract_amendment_allocations(contract_id,amendment_id);

alter table public.equipment_contract_amendment_allocations enable row level security;

revoke all on table public.equipment_contract_amendment_allocations
from public,anon,authenticated;

create or replace function private.assert_non_partner_staff_context()
returns void
language plpgsql
stable
security definer
set search_path=''
as $$
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED';
  end if;

  if public.current_partner_id() is not null then
    raise exception 'STAFF_CONTEXT_REQUIRED';
  end if;
end
$$;

revoke all on function private.assert_non_partner_staff_context()
from public,anon,authenticated;

create or replace function public.create_equipment_allocation_weight_amendment(
  p_contract_id uuid,
  p_effective_on date,
  p_changes jsonb,
  p_reason text
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
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
  v_new_weight numeric;
  v_note text;
  v_asset public.equipment_assets%rowtype;
  v_period public.equipment_contract_assets%rowtype;
  v_snapshot jsonb;
  v_enriched jsonb:='[]'::jsonb;
  v_dup uuid;
begin
  perform private.assert_non_partner_staff_context();
  perform private.assert_equipment_contract_tenant(p_contract_id);

  if not public.has_permission('equipment.contracts.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_contract_id is null then raise exception 'CONTRACT_REQUIRED'; end if;
  if p_effective_on is null then raise exception 'EFFECTIVE_DATE_REQUIRED'; end if;
  if p_effective_on<current_date then raise exception 'PAST_EFFECTIVE_DATE_NOT_ALLOWED'; end if;
  if jsonb_typeof(coalesce(p_changes,'[]'::jsonb))<>'array' then
    raise exception 'ALLOCATION_CHANGES_MUST_BE_ARRAY';
  end if;
  if jsonb_array_length(coalesce(p_changes,'[]'::jsonb))=0 then
    raise exception 'ALLOCATION_CHANGES_REQUIRED';
  end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'REASON_REQUIRED'; end if;

  select * into v_contract
  from public.equipment_contracts
  where id=p_contract_id
  for update;

  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if v_contract.status not in ('ACTIVE','SUSPENDED') then
    raise exception 'ACTIVE_OR_SUSPENDED_CONTRACT_REQUIRED';
  end if;
  if v_contract.organization_id is null then raise exception 'CONTRACT_ORGANIZATION_REQUIRED'; end if;
  if p_effective_on<v_contract.starts_on then raise exception 'EFFECTIVE_DATE_BEFORE_CONTRACT_START'; end if;
  if v_contract.ends_on is not null and p_effective_on>v_contract.ends_on then
    raise exception 'EFFECTIVE_DATE_AFTER_CONTRACT_END';
  end if;

  select (x->>'equipment_id')::uuid
    into v_dup
  from jsonb_array_elements(coalesce(p_changes,'[]'::jsonb)) x
  group by (x->>'equipment_id')::uuid
  having count(*)>1
  limit 1;

  if v_dup is not null then raise exception 'DUPLICATE_EQUIPMENT_CHANGE:%',v_dup; end if;

  v_before:=public.equipment_contract_legal_snapshot(v_contract.id);
  v_actor:=public.current_staff_user_id();
  if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;

  v_number:='ДС-ВЕС-'||
    regexp_replace(v_contract.contract_number,'[^A-Za-zА-Яа-я0-9_-]+','','g')||
    '-'||to_char(current_date,'YYYYMMDD')||
    '-'||upper(substr(gen_random_uuid()::text,1,4));

  insert into public.equipment_contract_amendments(
    id,contract_id,partner_id,amendment_number,amendment_kind,
    effective_on,proposed_changes,before_snapshot,reason,created_by
  ) values(
    v_amendment_id,v_contract.id,v_contract.partner_id,v_number,
    'EQUIPMENT_ALLOCATION_WEIGHT',p_effective_on,
    jsonb_build_object('equipment_weight_change','[]'::jsonb),
    v_before,btrim(p_reason),v_actor
  );

  for v_item in
    select value from jsonb_array_elements(coalesce(p_changes,'[]'::jsonb))
  loop
    if nullif(v_item->>'equipment_id','') is null then raise exception 'EQUIPMENT_ID_REQUIRED'; end if;
    if nullif(v_item->>'allocation_weight','') is null then raise exception 'ALLOCATION_WEIGHT_REQUIRED'; end if;

    v_equipment_id:=(v_item->>'equipment_id')::uuid;
    v_new_weight:=(v_item->>'allocation_weight')::numeric;
    v_note:=nullif(btrim(coalesce(v_item->>'note','')),'');

    if v_new_weight<=0 then raise exception 'INVALID_ALLOCATION_WEIGHT:%',v_equipment_id; end if;

    select * into v_asset
    from public.equipment_assets
    where id=v_equipment_id;

    if v_asset.id is null
       or v_asset.organization_id is distinct from v_contract.organization_id then
      raise exception 'EQUIPMENT_NOT_AVAILABLE:%',v_equipment_id;
    end if;

    select * into v_period
    from public.equipment_contract_assets ca
    where ca.contract_id=v_contract.id
      and ca.equipment_id=v_equipment_id
      and ca.starts_on<=p_effective_on
      and p_effective_on<=coalesce(ca.ends_on,'infinity'::date)
    order by ca.starts_on desc
    limit 1
    for update;

    if v_period.id is null then
      raise exception 'EQUIPMENT_NOT_ACTIVE_FOR_ALLOCATION_CHANGE:%',v_equipment_id;
    end if;
    if v_period.allocation_weight=v_new_weight then
      raise exception 'ALLOCATION_WEIGHT_UNCHANGED:%',v_equipment_id;
    end if;

    v_snapshot:=jsonb_build_object(
      'equipment_id',v_asset.id,
      'inventory_number',v_asset.inventory_number,
      'name',v_asset.name,
      'brand',v_asset.brand,
      'model',v_asset.model,
      'serial_number',v_asset.serial_number,
      'organization_id',v_asset.organization_id
    );

    insert into public.equipment_contract_amendment_allocations(
      amendment_id,contract_id,partner_id,equipment_id,source_contract_asset_id,
      previous_allocation_weight,new_allocation_weight,equipment_snapshot,note
    ) values(
      v_amendment_id,v_contract.id,v_contract.partner_id,v_equipment_id,v_period.id,
      v_period.allocation_weight,v_new_weight,v_snapshot,v_note
    );

    v_enriched:=v_enriched||jsonb_build_array(jsonb_build_object(
      'equipment_id',v_equipment_id,
      'equipment',v_snapshot,
      'source_contract_asset_id',v_period.id,
      'previous_allocation_weight',v_period.allocation_weight,
      'new_allocation_weight',v_new_weight,
      'note',v_note
    ));
  end loop;

  update public.equipment_contract_amendments
  set proposed_changes=jsonb_build_object('equipment_weight_change',v_enriched)
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
    v_number,v_type_id,'Дополнительное соглашение по распределению оборудования '||v_number,
    'DRAFT'::public.document_status,'COMMON'::public.business_unit,
    v_actor,v_actor,current_date,p_effective_on,btrim(p_reason),
    jsonb_build_object(
      'schema','equipment_contract_allocation_weight_amendment_v1',
      'amendment_id',v_amendment_id,
      'amendment_number',v_number,
      'amendment_kind','EQUIPMENT_ALLOCATION_WEIGHT',
      'effective_on',p_effective_on,
      'reason',btrim(p_reason),
      'contract_snapshot_before',v_before,
      'proposed_changes',jsonb_build_object('equipment_weight_change',v_enriched),
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
  select v_document_id,'EQUIPMENT_ASSET',x.equipment_id,'ALLOCATION_WEIGHT_SUBJECT'
  from public.equipment_contract_amendment_allocations x
  where x.amendment_id=v_amendment_id;

  insert into public.document_status_history(
    document_id,old_status,new_status,changed_by,comment
  ) values(
    v_document_id,null,'DRAFT'::public.document_status,v_actor,
    'Создано ДС по изменению распределения оборудования '||v_number
  );

  return v_amendment_id;
end
$$;

revoke all on function public.create_equipment_allocation_weight_amendment(uuid,date,jsonb,text)
from public,anon,authenticated;
grant execute on function public.create_equipment_allocation_weight_amendment(uuid,date,jsonb,text)
to authenticated;

create or replace function private.apply_equipment_contract_allocation_weight_amendment(
  p_amendment_id uuid
)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_a public.equipment_contract_amendments%rowtype;
  v_contract public.equipment_contracts%rowtype;
  v_doc_status public.document_status;
  v_actor uuid;
  v_change public.equipment_contract_amendment_allocations%rowtype;
  v_period public.equipment_contract_assets%rowtype;
  v_result_asset_id uuid;
  v_after jsonb;
begin
  perform private.assert_non_partner_staff_context();

  if not public.has_permission('equipment.contracts.manage') then raise exception 'PERMISSION_DENIED'; end if;

  select * into v_a
  from public.equipment_contract_amendments
  where id=p_amendment_id
  for update;

  if v_a.id is null then raise exception 'AMENDMENT_NOT_FOUND'; end if;
  if v_a.amendment_kind<>'EQUIPMENT_ALLOCATION_WEIGHT' then
    raise exception 'ALLOCATION_WEIGHT_AMENDMENT_REQUIRED';
  end if;
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
    from public.equipment_contract_amendment_allocations
    where amendment_id=v_a.id
    order by created_at,id
  loop
    select * into v_period
    from public.equipment_contract_assets ca
    where ca.id=v_change.source_contract_asset_id
      and ca.contract_id=v_contract.id
      and ca.equipment_id=v_change.equipment_id
      and ca.starts_on<=v_a.effective_on
      and v_a.effective_on<=coalesce(ca.ends_on,'infinity'::date)
    for update;

    if v_period.id is null then
      raise exception 'ALLOCATION_PERIOD_CHANGED_SINCE_DRAFT:%',v_change.equipment_id;
    end if;
    if v_period.allocation_weight is distinct from v_change.previous_allocation_weight then
      raise exception 'ALLOCATION_WEIGHT_CHANGED_SINCE_DRAFT:%',v_change.equipment_id;
    end if;

    if v_period.starts_on=v_a.effective_on then
      update public.equipment_contract_assets
      set allocation_weight=v_change.new_allocation_weight
      where id=v_period.id
      returning id into v_result_asset_id;
    else
      update public.equipment_contract_assets
      set ends_on=v_a.effective_on-1,
          ended_by_amendment_id=v_a.id
      where id=v_period.id;

      insert into public.equipment_contract_assets(
        contract_id,equipment_id,starts_on,ends_on,allocation_weight,source_amendment_id
      ) values(
        v_contract.id,v_change.equipment_id,v_a.effective_on,
        v_period.ends_on,v_change.new_allocation_weight,v_a.id
      )
      returning id into v_result_asset_id;
    end if;

    update public.equipment_contract_amendment_allocations
    set result_contract_asset_id=v_result_asset_id
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
      v_actor,'Изменение allocation weight применено к договору'
    );
  end if;

  return v_a.id;
end
$$;

revoke all on function private.apply_equipment_contract_allocation_weight_amendment(uuid)
from public,anon,authenticated;

do $$
declare
  v_oid oid;
  v_def text;
  v_old text;
  v_new text;
begin
  v_oid:=to_regprocedure('public.apply_equipment_contract_amendment(uuid)');
  if v_oid is null then raise exception 'RPC_NOT_FOUND:apply_equipment_contract_amendment'; end if;
  select pg_get_functiondef(v_oid) into v_def;

  v_old:=
    '  if v_a.amendment_kind=''EQUIPMENT_COMPOSITION'' then'||
    E'\n    return private.apply_equipment_contract_composition_amendment(v_a.id);'||
    E'\n  end if;';

  v_new:=
    '  if v_a.amendment_kind=''EQUIPMENT_COMPOSITION'' then'||
    E'\n    return private.apply_equipment_contract_composition_amendment(v_a.id);'||
    E'\n  end if;'||
    E'\n  if v_a.amendment_kind=''EQUIPMENT_ALLOCATION_WEIGHT'' then'||
    E'\n    return private.apply_equipment_contract_allocation_weight_amendment(v_a.id);'||
    E'\n  end if;';

  if position(v_old in v_def)=0 then
    raise exception 'APPLY_ALLOCATION_WEIGHT_PATCH_POINT_NOT_FOUND';
  end if;

  execute replace(v_def,v_old,v_new);
end
$$;

do $$
declare
  r record;
  v_oid oid;
  v_def text;
begin
  for r in
    select * from (values
      ('public.create_equipment_contract_amendment(uuid,date,jsonb,text)'),
      ('public.create_equipment_composition_amendment(uuid,date,jsonb,jsonb,text)'),
      ('public.create_equipment_allocation_weight_amendment(uuid,date,jsonb,text)'),
      ('public.approve_equipment_contract_amendment(uuid,text)'),
      ('public.cancel_equipment_contract_amendment(uuid,text)'),
      ('public.apply_equipment_contract_amendment(uuid)'),
      ('public.record_equipment_contract_amendment_signature(uuid,text,text,text)'),
      ('public.mark_equipment_contract_amendment_signed(uuid,text)')
    ) as x(signature)
  loop
    v_oid:=to_regprocedure(r.signature);
    if v_oid is null then raise exception 'RPC_NOT_FOUND:%',r.signature; end if;
    select pg_get_functiondef(v_oid) into v_def;

    if v_def ilike '%private.assert_non_partner_staff_context()%' then
      continue;
    end if;

    v_def:=regexp_replace(
      v_def,
      E'\nbegin\n',
      E'\nbegin\n  perform private.assert_non_partner_staff_context();\n',
      1,1
    );

    execute v_def;
  end loop;
end
$$;

create or replace function public.list_equipment_contract_amendments(
  p_status text default null
)
returns jsonb
language plpgsql
stable
set search_path=''
as $$
declare
  v_result jsonb;
begin
  perform private.assert_non_partner_staff_context();

  if not (
    public.has_permission('equipment.view')
    or public.has_permission('equipment.contracts.manage')
  ) then
    raise exception 'PERMISSION_DENIED';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by x.created_at desc),'[]'::jsonb)
  into v_result
  from (
    select
      a.id amendment_id,
      a.contract_id,
      c.contract_number,
      c.contract_type,
      a.partner_id,
      coalesce(p.legal_name,p.name) partner_name,
      a.amendment_number,
      a.amendment_kind,
      a.status,
      a.effective_on,
      a.proposed_changes,
      a.before_snapshot,
      a.after_snapshot,
      a.reason,
      a.document_id,
      d.document_number,
      d.status document_status,
      a.created_at,
      a.approved_at,
      a.applied_at,
      a.cancelled_at
    from public.equipment_contract_amendments a
    join public.equipment_contracts c on c.id=a.contract_id
    join public.partners p on p.id=a.partner_id
    left join public.documents d on d.id=a.document_id
    where c.organization_id=public.current_user_organization_id()
      and (
        p_status is null
        or upper(btrim(p_status))=''
        or a.status=upper(btrim(p_status))
      )
  ) x;

  return v_result;
end
$$;

revoke all on function public.list_equipment_contract_amendments(text)
from public,anon,authenticated;
grant execute on function public.list_equipment_contract_amendments(text)
to authenticated;

select private.assert_production_farm_security_baseline();
