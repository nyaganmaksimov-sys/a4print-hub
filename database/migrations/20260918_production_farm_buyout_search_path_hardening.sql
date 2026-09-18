-- A4PRINT HUB: Production Farm Phase 35 — buyout/lease SECURITY DEFINER search_path hardening.

alter function public.configure_equipment_lease_terms(uuid,numeric,numeric,numeric)
  set search_path to '';

alter function public.record_equipment_buyout_payment(uuid,numeric,text)
  set search_path to '';

alter function public.complete_equipment_buyout(uuid,text,text)
  set search_path to '';

alter function public.validate_equipment_buyout_contract()
  set search_path to '';
