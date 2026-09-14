-- Production Farm phase 4 advisor hardening.
-- Covers settlement foreign keys, consolidates SELECT RLS policies and keeps
-- mutations behind permission-checked SECURITY DEFINER RPCs.

create index if not exists equipment_owner_settlement_lines_equipment_idx
  on public.equipment_owner_settlement_lines(equipment_id);

create index if not exists equipment_owner_settlement_lines_order_idx
  on public.equipment_owner_settlement_lines(order_id);

create index if not exists equipment_owner_settlements_generated_by_idx
  on public.equipment_owner_settlements(generated_by);

create index if not exists equipment_owner_settlements_approved_by_idx
  on public.equipment_owner_settlements(approved_by);

create index if not exists equipment_owner_settlements_paid_by_idx
  on public.equipment_owner_settlements(paid_by);

-- One permissive SELECT policy per table. Staff with either settlement
-- permission can read all rows; equipment-owner partners can read only theirs.
drop policy if exists owner_settlements_staff_read on public.equipment_owner_settlements;
drop policy if exists owner_settlements_partner_read on public.equipment_owner_settlements;
drop policy if exists owner_settlements_manage on public.equipment_owner_settlements;
drop policy if exists owner_settlements_read on public.equipment_owner_settlements;

create policy owner_settlements_read
on public.equipment_owner_settlements
for select to authenticated
using (
  public.has_permission('production.settlements.view')
  or public.has_permission('production.settlements.manage')
  or partner_id = public.current_partner_id()
);

drop policy if exists owner_settlement_lines_staff_read on public.equipment_owner_settlement_lines;
drop policy if exists owner_settlement_lines_partner_read on public.equipment_owner_settlement_lines;
drop policy if exists owner_settlement_lines_manage on public.equipment_owner_settlement_lines;
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
        public.has_permission('production.settlements.view')
        or public.has_permission('production.settlements.manage')
        or s.partner_id = public.current_partner_id()
      )
  )
);

-- Direct writes are intentionally closed. All mutations go through the two
-- permission-checked settlement RPCs.
revoke all on public.equipment_owner_settlements from anon;
revoke all on public.equipment_owner_settlement_lines from anon;
revoke insert,update,delete on public.equipment_owner_settlements from authenticated;
revoke insert,update,delete on public.equipment_owner_settlement_lines from authenticated;
grant select on public.equipment_owner_settlements to authenticated;
grant select on public.equipment_owner_settlement_lines to authenticated;
