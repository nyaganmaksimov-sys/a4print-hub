-- A4PRINT HUB: Production Farm Phase 30 hardening — avoid PostgreSQL 63-char identifier truncation.

alter function public.emit_equipment_condition_claim_financial_integrity_notification()
  rename to emit_equipment_claim_financial_integrity_notifications;
alter function public.guard_equipment_condition_claim_financial_integrity_event_appen()
  rename to guard_equipment_claim_financial_integrity_event;

revoke all on function public.emit_equipment_claim_financial_integrity_notifications() from public,anon,authenticated;
revoke all on function public.guard_equipment_claim_financial_integrity_event() from public,anon,authenticated;

do $$
declare v_job bigint;
begin
  for v_job in select jobid from cron.job where jobname='equipment-claim-financial-integrity-daily'
  loop
    perform cron.unschedule(v_job);
  end loop;
  perform cron.schedule('equipment-claim-financial-integrity-daily','30 6 * * *','select public.emit_equipment_claim_financial_integrity_notifications();');
end
$$;
