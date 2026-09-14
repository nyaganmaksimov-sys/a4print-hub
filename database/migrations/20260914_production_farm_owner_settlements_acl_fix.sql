-- Production Farm phase 4 ACL tightening.
-- Remove residual table capabilities inherited from the initial ALL grant.
-- Authenticated users read through RLS and mutate only through settlement RPCs.

revoke all on public.equipment_owner_settlements from authenticated;
revoke all on public.equipment_owner_settlement_lines from authenticated;
grant select on public.equipment_owner_settlements to authenticated;
grant select on public.equipment_owner_settlement_lines to authenticated;

-- Evaluate stable permission/identity helpers once per statement where possible.
drop policy if exists owner_settlements_read on public.equipment_owner_settlements;
create policy owner_settlements_read
on public.equipment_owner_settlements
for select to authenticated
using (
  (select public.has_permission('production.settlements.view'))
  or (select public.has_permission('production.settlements.manage'))
  or partner_id = (select public.current_partner_id())
);

drop policy if exists owner_settlement_lines_read on public.equipment_owner_settlement_lines;
create policy owner_settlement_lines_read
on public.equipment_owner_settlement_lines
for select to authenticated
using (
  exists (
    select 1
    from public.equipment_owner_settlements s
    where s.id = settlement_id
      and (
        (select public.has_permission('production.settlements.view'))
        or (select public.has_permission('production.settlements.manage'))
        or s.partner_id = (select public.current_partner_id())
      )
  )
);
