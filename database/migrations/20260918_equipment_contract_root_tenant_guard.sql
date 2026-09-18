-- PHASE 2 CORE MULTI-COMPANY
-- Enforce equipment contract tenant on every root-row update, including SECURITY DEFINER RPC updates.

drop trigger if exists trg_equipment_contracts_assign_organization on public.equipment_contracts;

create trigger trg_equipment_contracts_assign_organization
before insert or update
on public.equipment_contracts
for each row
execute function private.assign_equipment_contract_organization();
