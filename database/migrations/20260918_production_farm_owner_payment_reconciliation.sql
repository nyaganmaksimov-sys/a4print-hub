-- A4PRINT HUB: Production Farm Phase 48 — owner payment reconciliation.

create or replace view public.equipment_owner_payment_reconciliation
with (security_invoker=true)
as
 WITH obligations AS (
         SELECT 'OWNER_SETTLEMENT'::text AS entity_type,
            s.id AS entity_id,
            s.contract_id,
            s.partner_id,
            c.organization_id,
            c.contract_number,
            COALESCE(NULLIF(p.legal_name, ''::text), NULLIF(p.name, ''::text), 'Владелец'::text) AS partner_name,
            s.period_start,
            s.period_end,
            s.status AS obligation_status,
            s.owner_amount::numeric AS amount,
            s.currency,
            s.settlement_document_id AS audit_document_id
           FROM equipment_owner_settlements s
             JOIN equipment_contracts c ON c.id = s.contract_id
             JOIN partners p ON p.id = s.partner_id
        UNION ALL
         SELECT 'LEASE_CHARGE'::text AS text,
            lc.id,
            lc.contract_id,
            lc.partner_id,
            c.organization_id,
            c.contract_number,
            COALESCE(NULLIF(p.legal_name, ''::text), NULLIF(p.name, ''::text), 'Владелец'::text) AS "coalesce",
            lc.period_start,
            lc.period_end,
            lc.status,
            lc.amount::numeric AS amount,
            lc.currency,
            lc.allocation_document_id
           FROM equipment_lease_charges lc
             JOIN equipment_contracts c ON c.id = lc.contract_id
             JOIN partners p ON p.id = lc.partner_id
        ), joined AS (
         SELECT o.entity_type,
            o.entity_id,
            o.contract_id,
            o.partner_id,
            o.organization_id,
            o.contract_number,
            o.partner_name,
            o.period_start,
            o.period_end,
            o.obligation_status,
            o.amount,
            o.currency,
            o.audit_document_id,
            lp.id AS posting_id,
            lp.contract_id AS posting_contract_id,
            lp.partner_id AS posting_partner_id,
            lp.organization_id AS posting_organization_id,
            lp.amount AS posting_amount,
            lp.currency AS posting_currency,
            lp.cash_account_id AS posting_cash_account_id,
            lp.transaction_id,
            lp.payment_reference,
            lp.posted_at,
            lp.reversal_transaction_id,
            lp.reversal_reference,
            lp.reversal_reason,
            lp.reversed_at,
            ot.organization_id AS original_org_id,
            ot.cash_account_id AS original_cash_account_id,
            ot.direction AS original_direction,
            ot.amount AS original_amount,
            ot.external_source AS original_external_source,
            ot.external_id AS original_external_id,
            rt.organization_id AS reversal_org_id,
            rt.cash_account_id AS reversal_cash_account_id,
            rt.direction AS reversal_direction,
            rt.amount AS reversal_amount,
            rt.external_source AS reversal_external_source,
            rt.external_id AS reversal_external_id,
                CASE
                    WHEN o.audit_document_id IS NULL THEN true
                    ELSE (EXISTS ( SELECT 1
                       FROM document_links dl
                      WHERE dl.document_id = o.audit_document_id AND dl.entity_type = 'CASH_TRANSACTION'::text AND dl.entity_id = lp.transaction_id AND dl.relationship = 'PAYMENT_POSTING'::text))
                END AS payment_document_link_ok,
                CASE
                    WHEN lp.reversed_at IS NULL OR o.audit_document_id IS NULL THEN true
                    ELSE (EXISTS ( SELECT 1
                       FROM document_links dl
                      WHERE dl.document_id = o.audit_document_id AND dl.entity_type = 'CASH_TRANSACTION'::text AND dl.entity_id = lp.reversal_transaction_id AND dl.relationship = 'PAYMENT_REVERSAL'::text))
                END AS reversal_document_link_ok
           FROM obligations o
             LEFT JOIN LATERAL ( SELECT p.id,
                    p.entity_type,
                    p.entity_id,
                    p.contract_id,
                    p.partner_id,
                    p.organization_id,
                    p.amount,
                    p.currency,
                    p.cash_account_id,
                    p.transaction_id,
                    p.payment_reference,
                    p.note,
                    p.posted_by,
                    p.posted_at,
                    p.reversal_transaction_id,
                    p.reversal_reason,
                    p.reversal_reference,
                    p.reversed_by,
                    p.reversed_at,
                    p.created_at
                   FROM equipment_owner_payment_postings p
                  WHERE p.entity_type = o.entity_type AND p.entity_id = o.entity_id
                  ORDER BY (p.reversed_at IS NULL) DESC, p.posted_at DESC, p.created_at DESC
                 LIMIT 1) lp ON true
             LEFT JOIN cash_transactions ot ON ot.id = lp.transaction_id
             LEFT JOIN cash_transactions rt ON rt.id = lp.reversal_transaction_id
        ), evaluated AS (
         SELECT j.entity_type,
            j.entity_id,
            j.contract_id,
            j.partner_id,
            j.organization_id,
            j.contract_number,
            j.partner_name,
            j.period_start,
            j.period_end,
            j.obligation_status,
            j.amount,
            j.currency,
            j.audit_document_id,
            j.posting_id,
            j.posting_contract_id,
            j.posting_partner_id,
            j.posting_organization_id,
            j.posting_amount,
            j.posting_currency,
            j.posting_cash_account_id,
            j.transaction_id,
            j.payment_reference,
            j.posted_at,
            j.reversal_transaction_id,
            j.reversal_reference,
            j.reversal_reason,
            j.reversed_at,
            j.original_org_id,
            j.original_cash_account_id,
            j.original_direction,
            j.original_amount,
            j.original_external_source,
            j.original_external_id,
            j.reversal_org_id,
            j.reversal_cash_account_id,
            j.reversal_direction,
            j.reversal_amount,
            j.reversal_external_source,
            j.reversal_external_id,
            j.payment_document_link_ok,
            j.reversal_document_link_ok,
            array_remove(ARRAY[
                CASE
                    WHEN j.obligation_status = 'PAID'::text AND (j.posting_id IS NULL OR j.reversed_at IS NOT NULL) THEN 'PAID_WITHOUT_ACTIVE_POSTING'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN j.obligation_status <> 'PAID'::text AND j.posting_id IS NOT NULL AND j.reversed_at IS NULL THEN 'ACTIVE_POSTING_ENTITY_NOT_PAID'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN j.posting_id IS NOT NULL AND (j.posting_contract_id IS DISTINCT FROM j.contract_id OR j.posting_partner_id IS DISTINCT FROM j.partner_id OR j.posting_organization_id IS DISTINCT FROM j.organization_id OR abs(COALESCE(j.posting_amount, 0::numeric) - COALESCE(j.amount, 0::numeric)) > 0.01 OR upper(COALESCE(j.posting_currency, ''::text)) <> upper(COALESCE(j.currency, ''::text))) THEN 'LEDGER_ENTITY_MISMATCH'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN j.posting_id IS NOT NULL AND j.transaction_id IS NULL THEN 'ORIGINAL_TRANSACTION_MISSING'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN j.posting_id IS NOT NULL AND j.transaction_id IS NOT NULL AND (j.original_org_id IS DISTINCT FROM j.organization_id OR j.original_cash_account_id IS DISTINCT FROM j.posting_cash_account_id OR j.original_direction IS DISTINCT FROM 'EXPENSE'::text OR abs(COALESCE(j.original_amount, 0::numeric) - COALESCE(j.posting_amount, 0::numeric)) > 0.01 OR j.original_external_source IS DISTINCT FROM 'EQUIPMENT_OWNER_PAYMENT'::text OR j.original_external_id IS DISTINCT FROM j.posting_id::text) THEN 'ORIGINAL_TRANSACTION_MISMATCH'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN j.reversed_at IS NOT NULL AND j.reversal_transaction_id IS NULL THEN 'REVERSAL_TRANSACTION_MISSING'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN j.reversed_at IS NOT NULL AND j.reversal_transaction_id IS NOT NULL AND (j.reversal_org_id IS DISTINCT FROM j.organization_id OR j.reversal_cash_account_id IS DISTINCT FROM j.posting_cash_account_id OR j.reversal_direction IS DISTINCT FROM 'INCOME'::text OR abs(COALESCE(j.reversal_amount, 0::numeric) - COALESCE(j.posting_amount, 0::numeric)) > 0.01 OR j.reversal_external_source IS DISTINCT FROM 'EQUIPMENT_OWNER_PAYMENT_REVERSAL'::text OR j.reversal_external_id IS DISTINCT FROM j.posting_id::text) THEN 'REVERSAL_TRANSACTION_MISMATCH'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN j.reversed_at IS NOT NULL AND j.obligation_status = 'PAID'::text THEN 'REVERSED_POSTING_ENTITY_STILL_PAID'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN j.posting_id IS NOT NULL AND NOT j.payment_document_link_ok THEN 'PAYMENT_DOCUMENT_LINK_MISSING'::text
                    ELSE NULL::text
                END,
                CASE
                    WHEN j.reversed_at IS NOT NULL AND NOT j.reversal_document_link_ok THEN 'REVERSAL_DOCUMENT_LINK_MISSING'::text
                    ELSE NULL::text
                END], NULL::text) AS error_codes
           FROM joined j
        )
 SELECT entity_type,
    entity_id,
    contract_id,
    partner_id,
    organization_id,
    contract_number,
    partner_name,
    period_start,
    period_end,
    obligation_status,
    amount,
    currency,
    audit_document_id,
    posting_id,
    transaction_id,
    payment_reference,
    posted_at,
    reversal_transaction_id,
    reversal_reference,
    reversal_reason,
    reversed_at,
    error_codes,
        CASE
            WHEN cardinality(error_codes) = 0 THEN 'OK'::text
            ELSE 'ERROR'::text
        END AS integrity_status,
    cardinality(error_codes) AS error_count,
    clock_timestamp() AS checked_at
   FROM evaluated e;;

revoke all on public.equipment_owner_payment_reconciliation
from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.get_my_equipment_owner_payment_reconciliation()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_partner uuid:=public.current_partner_id();
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  if v_partner is null then raise exception 'PARTNER_ACCESS_REQUIRED'; end if;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'entity_type',r.entity_type,
      'entity_id',r.entity_id,
      'contract_id',r.contract_id,
      'contract_number',r.contract_number,
      'period_start',r.period_start,
      'period_end',r.period_end,
      'obligation_status',r.obligation_status,
      'amount',r.amount,
      'currency',r.currency,
      'payment_reference',r.payment_reference,
      'posted_at',r.posted_at,
      'reversal_reference',r.reversal_reference,
      'reversed_at',r.reversed_at,
      'integrity_status',r.integrity_status,
      'error_count',r.error_count
    )
    order by r.period_end desc nulls last,r.contract_number
  ),'[]'::jsonb)
  into v_result
  from public.equipment_owner_payment_reconciliation r
  where r.partner_id=v_partner;

  return v_result;
end
$function$
;

revoke all on function public.get_my_equipment_owner_payment_reconciliation()
from public,anon,authenticated;
grant execute on function public.get_my_equipment_owner_payment_reconciliation()
to authenticated;

CREATE OR REPLACE FUNCTION public.list_equipment_owner_payment_reconciliation(p_errors_only boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_org uuid:=public.current_user_organization_id();
  v_result jsonb;
begin
  if auth.uid() is null then raise exception 'AUTH_REQUIRED'; end if;
  perform private.assert_non_partner_staff_context();

  if v_org is null then raise exception 'ORGANIZATION_CONTEXT_REQUIRED'; end if;
  if not public.has_permission('equipment.contracts.manage')
     or not public.has_permission('production.settlements.manage') then
    raise exception 'PERMISSION_DENIED';
  end if;

  select coalesce(jsonb_agg(to_jsonb(x) order by
    case when x.integrity_status='ERROR' then 0 else 1 end,
    x.period_end desc nulls last,
    x.contract_number,
    x.entity_type
  ),'[]'::jsonb)
  into v_result
  from (
    select r.*
    from public.equipment_owner_payment_reconciliation r
    where r.organization_id=v_org
      and (not coalesce(p_errors_only,true) or r.integrity_status='ERROR')
  ) x;

  return v_result;
end
$function$
;

revoke all on function public.list_equipment_owner_payment_reconciliation(boolean)
from public,anon,authenticated;
grant execute on function public.list_equipment_owner_payment_reconciliation(boolean)
to authenticated;

select private.assert_production_farm_security_baseline();
