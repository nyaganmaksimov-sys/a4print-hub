-- A4PRINT HUB: Production Farm Phase 30 hardening — integrity events are immutable.

create or replace function public.guard_equipment_condition_claim_financial_integrity_event_append_only()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  raise exception 'CONDITION_CLAIM_FINANCIAL_INTEGRITY_EVENT_APPEND_ONLY';
end
$$;
revoke all on function public.guard_equipment_condition_claim_financial_integrity_event_append_only() from public,anon,authenticated;

drop trigger if exists trg_guard_equipment_condition_claim_financial_integrity_event_append_only on public.equipment_condition_claim_financial_integrity_events;
create trigger trg_guard_equipment_condition_claim_financial_integrity_event_append_only
before update or delete on public.equipment_condition_claim_financial_integrity_events
for each row execute function public.guard_equipment_condition_claim_financial_integrity_event_append_only();
