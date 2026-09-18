-- PHASE 2 CORE MULTI-COMPANY
-- Read/list equipment RPCs that have been verified to work as SECURITY INVOKER.
-- They now inherit caller privileges and tenant-aware RLS instead of bypassing it.

alter function public.list_equipment_contract_amendments(text) security invoker;
alter function public.list_equipment_condition_inspections(boolean) security invoker;
alter function public.list_equipment_condition_comparisons(boolean) security invoker;
alter function public.list_equipment_condition_claims(boolean) security invoker;
alter function public.list_equipment_contract_deadlines(boolean) security invoker;
alter function public.list_equipment_payment_obligations(boolean) security invoker;
alter function public.list_equipment_partner_disputes(boolean) security invoker;
alter function public.get_equipment_condition_inspection_targets() security invoker;
alter function public.list_equipment_condition_claim_financial_reposts() security invoker;
alter function public.list_equipment_condition_claim_financial_reversals() security invoker;
