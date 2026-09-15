-- A4PRINT HUB: Production Farm Phase 16 — partner equipment-owner cabinet.
-- Sanitized read-only RPCs for external equipment owners.

create or replace function public.get_partner_equipment_cabinet()
returns jsonb
language plpgsql
security definer
stable
set search_path=''
as $$
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
    'id',p.id,'name',p.name,'legal_name',p.legal_name,'legal_form',p.legal_form,
    'tax_id',p.tax_id,'registration_number',p.registration_number,'contact_name',p.contact_name,
    'email',p.email,'phone',p.phone,'address',p.address
  ) into v_partner
  from public.partners p
  where p.id=v_partner_id and p.is_active=true;
  if v_partner is null then raise exception 'PARTNER_DISABLED'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'contract_number',c.contract_number,'contract_type',c.contract_type,'status',c.status,
    'starts_on',c.starts_on,'ends_on',c.ends_on,'hub_share_percent',c.hub_share_percent,
    'owner_share_percent',c.owner_share_percent,'calculation_basis',c.calculation_basis,
    'direct_costs_before_split',c.direct_costs_before_split,'settlement_frequency',c.settlement_frequency,
    'settlement_day',c.settlement_day,'repair_responsibility',c.repair_responsibility,
    'early_termination_notice_days',c.early_termination_notice_days,'lease_period_amount',c.lease_period_amount,
    'buyout_enabled',c.buyout_enabled,'buyout_price',c.buyout_price,'buyout_credit_percent',c.buyout_credit_percent,
    'buyout_completed_at',c.buyout_completed_at,'buyout_transfer_reference',c.buyout_transfer_reference,
    'currency',c.currency,'terms',c.terms,'notes',c.notes,
    'equipment_count',(select count(*) from public.equipment_contract_assets ca where ca.contract_id=c.id)
  ) order by c.starts_on desc,c.created_at desc),'[]'::jsonb)
  into v_contracts
  from public.equipment_contracts c
  where c.partner_id=v_partner_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'inventory_number',a.inventory_number,'name',a.name,'category',a.category,'brand',a.brand,
    'model',a.model,'serial_number',a.serial_number,'location',a.location,'lifecycle_status',a.status,
    'ownership_type',a.ownership_type,'operational_status',a.operational_status,'manufacture_year',a.manufacture_year,
    'market_value',a.market_value,'received_at',a.received_at,'commissioned_at',a.commissioned_at,
    'contracts',coalesce((select jsonb_agg(jsonb_build_object(
      'contract_id',c.id,'contract_number',c.contract_number,'contract_status',c.status,
      'starts_on',coalesce(ca.starts_on,c.starts_on),'ends_on',coalesce(ca.ends_on,c.ends_on)
    ) order by coalesce(ca.starts_on,c.starts_on) desc)
    from public.equipment_contract_assets ca
    join public.equipment_contracts c on c.id=ca.contract_id
    where ca.equipment_id=a.id and c.partner_id=v_partner_id),'[]'::jsonb)
  ) order by a.inventory_number),'[]'::jsonb)
  into v_equipment
  from public.equipment_assets a
  where a.id in (select ca.equipment_id from public.equipment_contract_assets ca
                 join public.equipment_contracts c on c.id=ca.contract_id where c.partner_id=v_partner_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'contract_id',s.contract_id,'contract_number',c.contract_number,'period_start',s.period_start,
    'period_end',s.period_end,'status',s.status,'calculation_basis',s.calculation_basis,
    'gross_revenue',s.gross_revenue,'received_revenue',s.received_revenue,'direct_costs',s.direct_costs,
    'split_base',s.split_base,'owner_share_percent',s.owner_share_percent,'owner_amount',s.owner_amount,
    'currency',s.currency,'paid_at',s.paid_at,'payment_reference',s.payment_reference
  ) order by s.period_end desc,s.created_at desc),'[]'::jsonb)
  into v_settlements
  from public.equipment_owner_settlements s
  join public.equipment_contracts c on c.id=s.contract_id
  where s.partner_id=v_partner_id and c.partner_id=v_partner_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',lc.id,'contract_id',lc.contract_id,'contract_number',c.contract_number,'charge_type',lc.charge_type,
    'period_start',lc.period_start,'period_end',lc.period_end,'amount',lc.amount,
    'buyout_credit_amount',lc.buyout_credit_amount,'status',lc.status,'currency',lc.currency,
    'paid_at',lc.paid_at,'payment_reference',lc.payment_reference
  ) order by lc.period_end desc,lc.created_at desc),'[]'::jsonb)
  into v_lease_charges
  from public.equipment_lease_charges lc
  join public.equipment_contracts c on c.id=lc.contract_id
  where lc.partner_id=v_partner_id and c.partner_id=v_partner_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',t.id,'contract_id',t.contract_id,'contract_number',c.contract_number,'status',t.status,
    'initiated_by_party',t.initiated_by_party,'notice_date',t.notice_date,'requested_end_date',t.requested_end_date,
    'effective_end_date',t.effective_end_date,'notice_waived',t.notice_waived,'waiver_reason',t.waiver_reason,
    'reason',t.reason,'return_reference',t.return_reference,
    'financial_clearance_reference',t.financial_clearance_reference,'final_notes',t.final_notes,
    'completed_at',t.completed_at
  ) order by t.created_at desc),'[]'::jsonb)
  into v_terminations
  from public.equipment_contract_terminations t
  join public.equipment_contracts c on c.id=t.contract_id
  where t.partner_id=v_partner_id and c.partner_id=v_partner_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',i.id,'equipment_id',i.equipment_id,'inventory_number',a.inventory_number,'equipment_name',a.name,
    'reported_at',i.reported_at,'description',i.description,'severity',i.severity,'status',i.status,
    'resolution',case when i.status in ('RESOLVED','CLOSED') then i.resolution else null end,
    'downtime_started_at',i.downtime_started_at,'downtime_ended_at',i.downtime_ended_at,'resolved_at',i.resolved_at
  ) order by i.reported_at desc),'[]'::jsonb)
  into v_incidents
  from public.equipment_incidents i
  join public.equipment_assets a on a.id=i.equipment_id
  where i.equipment_id in (select ca.equipment_id from public.equipment_contract_assets ca
                           join public.equipment_contracts c on c.id=ca.contract_id where c.partner_id=v_partner_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'document_id',d.id,'document_number',d.document_number,'document_type_code',dt.code,
    'document_type_name',dt.name,'title',d.title,'status',d.status,'issue_date',d.issue_date,
    'valid_from',d.valid_from,'valid_until',d.valid_until,'signed_at',d.signed_at,'archived_at',d.archived_at,
    'contract_id',cl.entity_id,'contract_number',c.contract_number
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

  return jsonb_build_object('partner',v_partner,'summary',v_summary,'contracts',v_contracts,'equipment',v_equipment,
    'settlements',v_settlements,'lease_charges',v_lease_charges,'terminations',v_terminations,
    'incidents',v_incidents,'documents',v_documents,'generated_at',clock_timestamp());
end
$$;

revoke all on function public.get_partner_equipment_cabinet() from public,anon,authenticated;
grant execute on function public.get_partner_equipment_cabinet() to authenticated;

create or replace function public.get_partner_equipment_document(p_document_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path=''
as $$
declare
  v_partner_id uuid;
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  v_partner_id:=public.current_partner_id();
  if v_partner_id is null then raise exception 'PARTNER_ACCESS_REQUIRED'; end if;
  if p_document_id is null then raise exception 'DOCUMENT_REQUIRED'; end if;

  select jsonb_build_object(
    'document_id',d.id,'document_number',d.document_number,'document_type_code',dt.code,
    'document_type_name',dt.name,'title',d.title,'status',d.status,'business_unit',d.business_unit,
    'issue_date',d.issue_date,'valid_from',d.valid_from,'valid_until',d.valid_until,
    'signed_at',d.signed_at,'archived_at',d.archived_at,'notes',d.notes,'metadata',d.metadata
  ) into v_result
  from public.documents d
  join public.document_types dt on dt.id=d.document_type_id
  join public.document_links pl on pl.document_id=d.id and pl.entity_type='PARTNER' and pl.entity_id=v_partner_id
  join public.document_links cl on cl.document_id=d.id and cl.entity_type='EQUIPMENT_CONTRACT'
  join public.equipment_contracts c on c.id=cl.entity_id and c.partner_id=v_partner_id
  where d.id=p_document_id
    and dt.code in ('EQ_ACCEPTANCE_ACT','EQ_ASSET_LIST','EQ_TERMS_APPENDIX','EQ_RETURN_ACT','EQ_RECONCILIATION_ACT')
    and d.status in ('APPROVED','SIGNED','ACTIVE','TERMINATED','ARCHIVED')
  limit 1;

  if v_result is null then raise exception 'DOCUMENT_NOT_AVAILABLE'; end if;
  return v_result;
end
$$;

revoke all on function public.get_partner_equipment_document(uuid) from public,anon,authenticated;
grant execute on function public.get_partner_equipment_document(uuid) to authenticated;
