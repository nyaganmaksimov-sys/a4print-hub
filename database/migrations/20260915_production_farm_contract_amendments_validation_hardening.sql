-- Keep amendment validation aligned with the equipment_contracts constraints.
create or replace function public.create_equipment_contract_amendment(p_contract_id uuid,p_effective_on date,p_changes jsonb,p_reason text)
returns uuid
language plpgsql
security definer
set search_path=''
as $$
declare
  v_contract public.equipment_contracts%rowtype; v_partner public.partners%rowtype; v_actor uuid; v_before jsonb;
  v_amendment_id uuid; v_document_id uuid; v_type_id uuid; v_number text; v_kind text; v_invalid_key text; v_key_count integer;
  v_ends_on date; v_hub numeric; v_owner numeric; v_settlement_day integer; v_notice_days integer; v_lease numeric;
  v_buyout_enabled boolean; v_buyout_price numeric; v_credit numeric; v_terms jsonb;
  v_calc_basis text; v_frequency text; v_repair text;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if not public.has_permission('equipment.contracts.manage') then raise exception 'PERMISSION_DENIED'; end if;
  if p_contract_id is null then raise exception 'CONTRACT_REQUIRED'; end if;
  if p_effective_on is null then raise exception 'EFFECTIVE_DATE_REQUIRED'; end if;
  if p_effective_on<current_date then raise exception 'PAST_EFFECTIVE_DATE_NOT_ALLOWED'; end if;
  if jsonb_typeof(coalesce(p_changes,'{}'::jsonb))<>'object' or p_changes='{}'::jsonb then raise exception 'CHANGES_REQUIRED'; end if;
  if nullif(btrim(coalesce(p_reason,'')),'') is null then raise exception 'REASON_REQUIRED'; end if;
  select * into v_contract from public.equipment_contracts where id=p_contract_id for update;
  if v_contract.id is null then raise exception 'CONTRACT_NOT_FOUND'; end if;
  if v_contract.status not in ('ACTIVE','SUSPENDED') then raise exception 'ACTIVE_OR_SUSPENDED_CONTRACT_REQUIRED'; end if;
  select key into v_invalid_key from jsonb_object_keys(p_changes) key where key not in ('ends_on','hub_share_percent','owner_share_percent','calculation_basis','direct_costs_before_split','settlement_frequency','settlement_day','repair_responsibility','early_termination_notice_days','lease_period_amount','buyout_enabled','buyout_price','buyout_credit_percent','terms') limit 1;
  if v_invalid_key is not null then raise exception 'INVALID_AMENDMENT_FIELD:%',v_invalid_key; end if;
  v_ends_on:=case when p_changes ? 'ends_on' then nullif(p_changes->>'ends_on','')::date else v_contract.ends_on end;
  v_hub:=case when p_changes ? 'hub_share_percent' then (p_changes->>'hub_share_percent')::numeric else v_contract.hub_share_percent end;
  v_owner:=case when p_changes ? 'owner_share_percent' then (p_changes->>'owner_share_percent')::numeric else v_contract.owner_share_percent end;
  v_calc_basis:=case when p_changes ? 'calculation_basis' then p_changes->>'calculation_basis' else v_contract.calculation_basis end;
  v_frequency:=case when p_changes ? 'settlement_frequency' then p_changes->>'settlement_frequency' else v_contract.settlement_frequency end;
  v_settlement_day:=case when p_changes ? 'settlement_day' then nullif(p_changes->>'settlement_day','')::integer else v_contract.settlement_day end;
  v_repair:=case when p_changes ? 'repair_responsibility' then p_changes->>'repair_responsibility' else v_contract.repair_responsibility end;
  v_notice_days:=case when p_changes ? 'early_termination_notice_days' then (p_changes->>'early_termination_notice_days')::integer else v_contract.early_termination_notice_days end;
  v_lease:=case when p_changes ? 'lease_period_amount' then (p_changes->>'lease_period_amount')::numeric else v_contract.lease_period_amount end;
  v_buyout_enabled:=case when p_changes ? 'buyout_enabled' then (p_changes->>'buyout_enabled')::boolean else v_contract.buyout_enabled end;
  v_buyout_price:=case when p_changes ? 'buyout_price' then nullif(p_changes->>'buyout_price','')::numeric else v_contract.buyout_price end;
  v_credit:=case when p_changes ? 'buyout_credit_percent' then (p_changes->>'buyout_credit_percent')::numeric else v_contract.buyout_credit_percent end;
  v_terms:=case when p_changes ? 'terms' then p_changes->'terms' else v_contract.terms end;
  if v_ends_on is not null and v_ends_on<p_effective_on then raise exception 'END_DATE_BEFORE_EFFECTIVE_DATE'; end if;
  if v_contract.contract_type='REVENUE_SHARE' and (v_hub<0 or v_owner<0 or abs(v_hub+v_owner-100)>0.001) then raise exception 'SHARES_MUST_TOTAL_100'; end if;
  if v_calc_basis not in ('RECEIVED_REVENUE','OPERATION_REVENUE','NET_AFTER_DIRECT_COSTS') then raise exception 'INVALID_CALCULATION_BASIS'; end if;
  if v_frequency not in ('MONTHLY','WEEKLY','ON_DEMAND','OTHER') then raise exception 'INVALID_SETTLEMENT_FREQUENCY'; end if;
  if v_settlement_day is not null and (v_settlement_day<1 or v_settlement_day>28) then raise exception 'INVALID_SETTLEMENT_DAY'; end if;
  if v_repair not in ('HUB','OWNER','SHARED','BY_AGREEMENT') then raise exception 'INVALID_REPAIR_RESPONSIBILITY'; end if;
  if coalesce(v_notice_days,0)<0 then raise exception 'INVALID_NOTICE_DAYS'; end if;
  if coalesce(v_lease,0)<0 then raise exception 'INVALID_LEASE_AMOUNT'; end if;
  if coalesce(v_credit,0)<0 or coalesce(v_credit,0)>100 then raise exception 'INVALID_BUYOUT_CREDIT_PERCENT'; end if;
  if coalesce(v_buyout_enabled,false) and coalesce(v_buyout_price,0)<=0 then raise exception 'BUYOUT_PRICE_REQUIRED'; end if;
  if v_terms is null or jsonb_typeof(v_terms)<>'object' then raise exception 'TERMS_MUST_BE_OBJECT'; end if;
  v_before:=public.equipment_contract_legal_snapshot(v_contract.id);
  select count(*) into v_key_count from jsonb_object_keys(p_changes);
  v_kind:=case when p_changes ? 'ends_on' and v_key_count=1 then 'RENEWAL' else 'TERMS_CHANGE' end;
  v_actor:=public.current_staff_user_id(); if v_actor is null then raise exception 'STAFF_USER_NOT_FOUND'; end if;
  v_number:='ДС-'||regexp_replace(v_contract.contract_number,'[^A-Za-zА-Яа-я0-9_-]+','','g')||'-'||to_char(current_date,'YYYYMMDD')||'-'||upper(substr(gen_random_uuid()::text,1,4));
  insert into public.equipment_contract_amendments(contract_id,partner_id,amendment_number,amendment_kind,effective_on,proposed_changes,before_snapshot,reason,created_by)
  values(v_contract.id,v_contract.partner_id,v_number,v_kind,p_effective_on,p_changes,v_before,btrim(p_reason),v_actor) returning id into v_amendment_id;
  select * into v_partner from public.partners where id=v_contract.partner_id;
  select id into v_type_id from public.document_types where code='EQ_CONTRACT_AMENDMENT';
  if v_type_id is null then raise exception 'DOCUMENT_TYPE_NOT_FOUND'; end if;
  insert into public.documents(document_number,document_type_id,title,status,business_unit,created_by,responsible_user_id,issue_date,valid_from,notes,metadata)
  values(v_number,v_type_id,'Дополнительное соглашение '||v_number,'DRAFT'::public.document_status,'COMMON'::public.business_unit,v_actor,v_actor,current_date,p_effective_on,btrim(p_reason),jsonb_build_object('schema','equipment_contract_amendment_v1','amendment_id',v_amendment_id,'amendment_number',v_number,'amendment_kind',v_kind,'effective_on',p_effective_on,'reason',btrim(p_reason),'contract_snapshot_before',v_before,'proposed_changes',p_changes,'partner_snapshot',jsonb_build_object('partner_id',v_partner.id,'name',v_partner.name,'legal_name',v_partner.legal_name,'tax_id',v_partner.tax_id,'registration_number',v_partner.registration_number,'address',v_partner.address))) returning id into v_document_id;
  update public.equipment_contract_amendments set document_id=v_document_id where id=v_amendment_id;
  insert into public.document_links(document_id,entity_type,entity_id,relationship) values(v_document_id,'EQUIPMENT_CONTRACT',v_contract.id,'AMENDMENT');
  insert into public.document_links(document_id,entity_type,entity_id,relationship) values(v_document_id,'EQUIPMENT_CONTRACT_AMENDMENT',v_amendment_id,'SOURCE');
  insert into public.document_links(document_id,entity_type,entity_id,relationship) values(v_document_id,'PARTNER',v_contract.partner_id,'COUNTERPARTY');
  insert into public.document_status_history(document_id,old_status,new_status,changed_by,comment) values(v_document_id,null,'DRAFT'::public.document_status,v_actor,'Создано из допсоглашения '||v_number);
  return v_amendment_id;
end
$$;
revoke all on function public.create_equipment_contract_amendment(uuid,date,jsonb,text) from public,anon,authenticated;
grant execute on function public.create_equipment_contract_amendment(uuid,date,jsonb,text) to authenticated;
