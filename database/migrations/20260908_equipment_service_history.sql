-- A4PRINT HUB: equipment maintenance history synchronization.
-- equipment_service_log already stores date, type, work description, cost,
-- provider and optional next due date. Keep equipment summary dates in sync.

create or replace function public.sync_equipment_service_dates()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_interval integer;
  v_next date;
begin
  select service_interval_days into v_interval
  from public.equipment_assets
  where id = new.equipment_id;

  v_next := new.next_due_date;
  if v_next is null
     and new.service_type = 'MAINTENANCE'
     and coalesce(v_interval, 0) > 0 then
    v_next := new.serviced_at + v_interval;
  end if;

  update public.equipment_assets
  set last_service_date = case
        when last_service_date is null or new.serviced_at >= last_service_date
          then new.serviced_at
        else last_service_date
      end,
      next_service_date = case
        when v_next is not null then v_next
        else next_service_date
      end,
      updated_at = now()
  where id = new.equipment_id;

  -- Persist the automatically calculated next due date in the history row too.
  if v_next is not null and new.next_due_date is distinct from v_next then
    update public.equipment_service_log
    set next_due_date = v_next
    where id = new.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_equipment_service_dates on public.equipment_service_log;
create trigger trg_equipment_service_dates
after insert or update of serviced_at, service_type, next_due_date
on public.equipment_service_log
for each row execute function public.sync_equipment_service_dates();

-- Trigger-only helper: clients must not call it through PostgREST RPC.
revoke all on function public.sync_equipment_service_dates() from public, anon, authenticated;
