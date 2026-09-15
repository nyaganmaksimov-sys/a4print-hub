-- A4PRINT HUB: Production Farm Phase 15
-- Generated legal document snapshots for partner-owned equipment contracts.

insert into public.document_types(code,name,description,requires_signature,default_validity_days)
values
  ('EQ_ACCEPTANCE_ACT','Акт приёма-передачи оборудования','Передача оборудования владельца в A4PRINT HUB',true,null),
  ('EQ_ASSET_LIST','Перечень оборудования к договору','Приложение с перечнем и идентификацией оборудования',true,null),
  ('EQ_TERMS_APPENDIX','Приложение об условиях сотрудничества','Фиксирует экономические и эксплуатационные условия договора',true,null),
  ('EQ_RETURN_ACT','Акт возврата оборудования','Возврат оборудования владельцу при прекращении договора',true,null),
  ('EQ_RECONCILIATION_ACT','Акт сверки по оборудованию','Финальная сверка расчётов по договору оборудования',true,null)
on conflict(code) do update set
  name=excluded.name,
  description=excluded.description,
  requires_signature=excluded.requires_signature,
  default_validity_days=excluded.default_validity_days;

-- Existing archive links already have RLS enabled but had no staff SELECT policy.
-- The archive itself is readable by HUB staff, so exposing its relation graph to the same staff
-- keeps security boundaries consistent and lets security_invoker views work correctly.
drop policy if exists document_links_hub_staff_read on public.document_links;
create policy document_links_hub_staff_read on public.document_links
for select to authenticated
using(public.is_hub_staff());

grant select on public.document_links to authenticated;

create or replace view public.equipment_contract_document_overview
with (security_invoker=true) as
select
  dl.entity_id as contract_id,
  c.contract_number,
  c.contract_type,
  c.status as contract_status,
  c.partner_id,
  coalesce(p.legal_name,p.name,'—') as partner_name,
  d.id as document_id,
  d.document_number,
  dt.code as document_type_code,
  dt.name as document_type_name,
  d.title,
  d.status,
  d.business_unit,
  d.issue_date,
  d.valid_from,
  d.valid_until,
  d.signed_at,
  d.archived_at,
  d.notes,
  d.metadata,
  d.created_by,
  d.responsible_user_id,
  d.created_at,
  d.updated_at
from public.document_links dl
join public.documents d on d.id=dl.document_id
join public.document_types dt on dt.id=d.document_type_id
join public.equipment_contracts c on c.id=dl.entity_id
join public.partners p on p.id=c.partner_id
where dl.entity_type='EQUIPMENT_CONTRACT'
  and dt.code in ('EQ_ACCEPTANCE_ACT','EQ_ASSET_LIST','EQ_TERMS_APPENDIX','EQ_RETURN_ACT','EQ_RECONCILIATION_ACT');

revoke all on public.equipment_contract_document_overview from public,anon,authenticated;
grant select on public.equipment_contract_document_overview to authenticated;

create or replace function public.generate_equipment_contract_document(
  p_contract_id uuid,
  p_document_kind text,
  p_termination_id uuid default null,
  p_hub_organization_id uuid default null,
  p_notes text default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid;
  v_contract public.equipment_contracts%rowtype;
  v_partner public.partners%rowtype;
  v_hub public.organizations%rowtype;
  v_termination public.equipment_contract_terminations%rowtype;
  v_kind text:=upper(btrim(coalesce(p_document_kind,'')));
  v_type_code text;
  v_type_id uuid;
  v_prefix text;
  v_title text;
  v_document_id uuid;
  v_document_number text;
  v_business_unit public.business_unit:='COMMON'::public.business_unit;
  v_equipment jsonb:='[]'::jsonb;
  v_settlement_summary jsonb:='{}'::jsonb;
  v_lease_summary jsonb:='{}'::jsonb;
  v_termination_snapshot jsonb:=null;
  v_metadata jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.contracts.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_contract_id is null then raise exception 'CONTRACT_REQUIRED'; end if;

  if v_kind='ACCEPTANCE_ACT' then
    v_type_code:='EQ_ACCEPTANCE_ACT'; v_prefix:='АПП'; v_title:='Акт приёма-передачи оборудования';
  elsif v_kind='ASSET_LIST' then
    v_type_code:='EQ_ASSET_LIST'; v_prefix:='ПЕР'; v_title:='Перечень оборудования к договору';
  elsif v_kind='TERMS_APPENDIX' then
    v_type_code:='EQ_TERMS_APPENDIX'; v_prefix:='УСЛ'; v_title:='Приложение об условиях сотрудничества';
  elsif v_kind='RETURN_ACT' then
    v_type_code:='EQ_RETURN_ACT'; v_prefix:='ВОЗ'; v_title:='Акт возврата оборудования';
  elsif v_kind='RECONCILIATION_ACT' then
    v_type_code:='EQ_RECONCILIATION_ACT'; v_prefix:='СВР'; v_title:='Акт сверки по договору оборудования';
  else
    raise exception 'INVALID_DOCUMENT_KIND';
  end if;

  select * into v_contract from public.equipment_contracts where id=p_contract_id;
  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;

  select * into v_partner from public.partners where id=v_contract.partner_id;
  if v_partner.id is null then raise exception 'PARTNER_NOT_FOUND'; end if;

  if v_kind in ('RETURN_ACT','RECONCILIATION_ACT') then
    if p_termination_id is null then raise exception 'TERMINATION_REQUIRED'; end if;
    select * into v_termination
      from public.equipment_contract_terminations
     where id=p_termination_id and contract_id=v_contract.id;
    if v_termination.id is null then raise exception 'TERMINATION_NOT_FOUND'; end if;
    if v_termination.status='CANCELLED' then raise exception 'TERMINATION_CANCELLED'; end if;
  elsif p_termination_id is not null then
    select * into v_termination
      from public.equipment_contract_terminations
     where id=p_termination_id and contract_id=v_contract.id;
    if v_termination.id is null then raise exception 'TERMINATION_NOT_FOUND'; end if;
  end if;

  if p_hub_organization_id is not null then
    select * into v_hub from public.organizations where id=p_hub_organization_id and is_active=true;
  else
    select o.* into v_hub
      from public.organizations o
     where o.id=(
       select case when count(distinct a.organization_id)=1 then min(a.organization_id) else null end
         from public.equipment_contract_assets ca
         join public.equipment_assets a on a.id=ca.equipment_id
        where ca.contract_id=v_contract.id and a.organization_id is not null
     )
     limit 1;
    if v_hub.id is null then
      select * into v_hub from public.organizations where code='A4PRINT' and is_active=true limit 1;
    end if;
  end if;
  if v_hub.id is null then raise exception 'HUB_ORGANIZATION_NOT_FOUND'; end if;

  if v_hub.code='A4PRINT' then v_business_unit:='A4_PRINT'::public.business_unit;
  elsif v_hub.code='3DARTPRINT' then v_business_unit:='3D_ARTPRINT'::public.business_unit;
  else v_business_unit:='COMMON'::public.business_unit;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'equipment_id',a.id,
    'inventory_number',a.inventory_number,
    'name',a.name,
    'category',a.category,
    'brand',a.brand,
    'model',a.model,
    'serial_number',a.serial_number,
    'manufacture_year',a.manufacture_year,
    'ownership_type',a.ownership_type,
    'market_value',a.market_value,
    'location',a.location,
    'received_at',a.received_at,
    'commissioned_at',a.commissioned_at,
    'contract_starts_on',coalesce(ca.starts_on,v_contract.starts_on),
    'contract_ends_on',coalesce(ca.ends_on,v_contract.ends_on),
    'allocation_weight',ca.allocation_weight
  ) order by a.inventory_number),'[]'::jsonb)
    into v_equipment
    from public.equipment_contract_assets ca
    join public.equipment_assets a on a.id=ca.equipment_id
   where ca.contract_id=v_contract.id;

  select jsonb_build_object(
    'settlement_count',count(*),
    'paid_count',count(*) filter(where status='PAID'),
    'gross_revenue_total',coalesce(sum(gross_revenue),0),
    'received_revenue_total',coalesce(sum(received_revenue),0),
    'direct_costs_total',coalesce(sum(direct_costs),0),
    'split_base_total',coalesce(sum(split_base),0),
    'owner_amount_total',coalesce(sum(owner_amount),0),
    'owner_amount_paid',coalesce(sum(owner_amount) filter(where status='PAID'),0),
    'hub_amount_total',coalesce(sum(hub_amount),0),
    'currency',coalesce(max(currency),v_contract.currency)
  ) into v_settlement_summary
  from public.equipment_owner_settlements
  where contract_id=v_contract.id;

  select jsonb_build_object(
    'charge_count',count(*),
    'paid_count',count(*) filter(where status='PAID'),
    'amount_total',coalesce(sum(amount),0),
    'amount_paid',coalesce(sum(amount) filter(where status='PAID'),0),
    'buyout_credit_total',coalesce(sum(buyout_credit_amount),0),
    'buyout_credit_paid',coalesce(sum(buyout_credit_amount) filter(where status='PAID'),0),
    'currency',coalesce(max(currency),v_contract.currency)
  ) into v_lease_summary
  from public.equipment_lease_charges
  where contract_id=v_contract.id;

  if v_termination.id is not null then
    v_termination_snapshot:=jsonb_build_object(
      'termination_id',v_termination.id,
      'status',v_termination.status,
      'initiated_by_party',v_termination.initiated_by_party,
      'notice_date',v_termination.notice_date,
      'requested_end_date',v_termination.requested_end_date,
      'effective_end_date',v_termination.effective_end_date,
      'notice_waived',v_termination.notice_waived,
      'waiver_reason',v_termination.waiver_reason,
      'reason',v_termination.reason,
      'return_reference',v_termination.return_reference,
      'financial_clearance_reference',v_termination.financial_clearance_reference,
      'final_notes',v_termination.final_notes,
      'completed_at',v_termination.completed_at
    );
  end if;

  v_metadata:=jsonb_build_object(
    'schema','equipment_contract_document_v1',
    'document_kind',v_kind,
    'snapshot_generated_at',clock_timestamp(),
    'partner_snapshot',jsonb_build_object(
      'partner_id',v_partner.id,
      'name',v_partner.name,
      'legal_name',v_partner.legal_name,
      'legal_form',v_partner.legal_form,
      'tax_id',v_partner.tax_id,
      'registration_number',v_partner.registration_number,
      'contact_name',v_partner.contact_name,
      'email',v_partner.email,
      'phone',v_partner.phone,
      'address',v_partner.address,
      'bank_details',v_partner.bank_details
    ),
    'hub_snapshot',jsonb_build_object(
      'organization_id',v_hub.id,
      'name',v_hub.name,
      'legal_name',v_hub.legal_name,
      'code',v_hub.code,
      'tax_id',v_hub.tax_id,
      'registration_number',v_hub.registration_number,
      'email',v_hub.email,
      'phone',v_hub.phone,
      'address',v_hub.address
    ),
    'contract_snapshot',jsonb_build_object(
      'contract_id',v_contract.id,
      'contract_number',v_contract.contract_number,
      'contract_type',v_contract.contract_type,
      'status',v_contract.status,
      'starts_on',v_contract.starts_on,
      'ends_on',v_contract.ends_on,
      'hub_share_percent',v_contract.hub_share_percent,
      'owner_share_percent',v_contract.owner_share_percent,
      'calculation_basis',v_contract.calculation_basis,
      'direct_costs_before_split',v_contract.direct_costs_before_split,
      'settlement_frequency',v_contract.settlement_frequency,
      'settlement_day',v_contract.settlement_day,
      'repair_responsibility',v_contract.repair_responsibility,
      'early_termination_notice_days',v_contract.early_termination_notice_days,
      'lease_period_amount',v_contract.lease_period_amount,
      'buyout_enabled',v_contract.buyout_enabled,
      'buyout_price',v_contract.buyout_price,
      'buyout_credit_percent',v_contract.buyout_credit_percent,
      'buyout_completed_at',v_contract.buyout_completed_at,
      'buyout_transfer_reference',v_contract.buyout_transfer_reference,
      'currency',v_contract.currency,
      'terms',v_contract.terms,
      'notes',v_contract.notes
    ),
    'equipment_snapshot',v_equipment,
    'financial_snapshot',jsonb_build_object(
      'revenue_share',v_settlement_summary,
      'lease',v_lease_summary
    ),
    'termination_snapshot',v_termination_snapshot
  );

  select id into v_type_id from public.document_types where code=v_type_code limit 1;
  if v_type_id is null then raise exception 'DOCUMENT_TYPE_NOT_FOUND:%',v_type_code; end if;

  v_actor:=public.current_staff_user_id();
  if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;

  v_document_number:=v_prefix||'-'||regexp_replace(v_contract.contract_number,'[^A-Za-zА-Яа-я0-9_-]+','','g')||'-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(gen_random_uuid()::text,1,4));

  insert into public.documents(
    document_number,document_type_id,title,status,business_unit,
    created_by,responsible_user_id,issue_date,valid_from,valid_until,notes,metadata
  ) values(
    v_document_number,v_type_id,v_title||' № '||v_document_number,'DRAFT'::public.document_status,v_business_unit,
    v_actor,v_actor,current_date,
    case when v_kind in ('ACCEPTANCE_ACT','ASSET_LIST','TERMS_APPENDIX') then v_contract.starts_on else current_date end,
    case when v_kind in ('ACCEPTANCE_ACT','ASSET_LIST','TERMS_APPENDIX') then v_contract.ends_on else null end,
    nullif(btrim(coalesce(p_notes,'')),''),v_metadata
  ) returning id into v_document_id;

  insert into public.document_links(document_id,entity_type,entity_id,relationship)
  values(v_document_id,'EQUIPMENT_CONTRACT',v_contract.id,v_kind);

  insert into public.document_links(document_id,entity_type,entity_id,relationship)
  values(v_document_id,'PARTNER',v_partner.id,'COUNTERPARTY');

  insert into public.document_links(document_id,entity_type,entity_id,relationship)
  select v_document_id,'EQUIPMENT',ca.equipment_id,'SUBJECT'
    from public.equipment_contract_assets ca
   where ca.contract_id=v_contract.id
  on conflict(document_id,entity_type,entity_id) do nothing;

  if v_termination.id is not null then
    insert into public.document_links(document_id,entity_type,entity_id,relationship)
    values(v_document_id,'EQUIPMENT_CONTRACT_TERMINATION',v_termination.id,v_kind)
    on conflict(document_id,entity_type,entity_id) do nothing;
  end if;

  insert into public.document_status_history(document_id,old_status,new_status,changed_by,comment)
  values(v_document_id,null,'DRAFT'::public.document_status,v_actor,'Документ сформирован из снимка договора оборудования');

  return v_document_id;
end
$$;

revoke all on function public.generate_equipment_contract_document(uuid,text,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.generate_equipment_contract_document(uuid,text,uuid,uuid,text) to authenticated;

create or replace function public.set_equipment_contract_document_status(
  p_document_id uuid,
  p_status text,
  p_comment text default null
) returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_actor uuid;
  v_old public.document_status;
  v_new public.document_status;
  v_type_code text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.contracts.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_document_id is null then raise exception 'DOCUMENT_REQUIRED'; end if;

  begin
    v_new:=upper(btrim(coalesce(p_status,'')))::public.document_status;
  exception when others then
    raise exception 'INVALID_DOCUMENT_STATUS';
  end;

  if v_new not in (
    'DRAFT'::public.document_status,
    'PENDING_APPROVAL'::public.document_status,
    'APPROVED'::public.document_status,
    'SIGNED'::public.document_status,
    'ACTIVE'::public.document_status,
    'ARCHIVED'::public.document_status
  ) then raise exception 'INVALID_DOCUMENT_STATUS'; end if;

  select d.status,dt.code into v_old,v_type_code
    from public.documents d
    join public.document_types dt on dt.id=d.document_type_id
   where d.id=p_document_id
     and dt.code in ('EQ_ACCEPTANCE_ACT','EQ_ASSET_LIST','EQ_TERMS_APPENDIX','EQ_RETURN_ACT','EQ_RECONCILIATION_ACT')
     and exists(
       select 1 from public.document_links dl
        where dl.document_id=d.id and dl.entity_type='EQUIPMENT_CONTRACT'
     )
   for update of d;

  if v_old is null then raise exception 'EQUIPMENT_CONTRACT_DOCUMENT_NOT_FOUND'; end if;
  if v_old='ARCHIVED'::public.document_status and v_new<>v_old then raise exception 'ARCHIVED_DOCUMENT_IMMUTABLE'; end if;
  if v_old in ('SIGNED'::public.document_status,'ACTIVE'::public.document_status)
     and v_new in ('DRAFT'::public.document_status,'PENDING_APPROVAL'::public.document_status,'APPROVED'::public.document_status)
  then raise exception 'SIGNED_DOCUMENT_CANNOT_REOPEN'; end if;
  if v_new='ACTIVE'::public.document_status and v_old not in ('SIGNED'::public.document_status,'ACTIVE'::public.document_status)
  then raise exception 'DOCUMENT_MUST_BE_SIGNED_FIRST'; end if;

  if v_new=v_old then return p_document_id; end if;

  v_actor:=public.current_staff_user_id();
  if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;

  update public.documents
     set status=v_new,
         signed_at=case when v_new='SIGNED'::public.document_status then coalesce(signed_at,clock_timestamp()) else signed_at end,
         archived_at=case when v_new='ARCHIVED'::public.document_status then coalesce(archived_at,clock_timestamp()) else archived_at end,
         updated_at=clock_timestamp()
   where id=p_document_id;

  insert into public.document_status_history(document_id,old_status,new_status,changed_by,comment)
  values(p_document_id,v_old,v_new,v_actor,nullif(btrim(coalesce(p_comment,'')),''));

  return p_document_id;
end
$$;

revoke all on function public.set_equipment_contract_document_status(uuid,text,text) from public,anon,authenticated;
grant execute on function public.set_equipment_contract_document_status(uuid,text,text) to authenticated;
