-- PHASE 2 CORE MULTI-COMPANY
-- Tenant foundation for equipment contracts and contract-derived records.
-- Direct RLS is tenant-aware for staff and preserves partner-specific access.
-- Write integrity is enforced by triggers even when SECURITY DEFINER RPCs bypass RLS.

create schema if not exists private;

alter table public.equipment_contracts
  add column if not exists organization_id uuid references public.organizations(id) on delete restrict;

create index if not exists idx_equipment_contracts_organization
  on public.equipment_contracts(organization_id,created_at desc);

create or replace function private.assign_equipment_contract_organization()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_staff_org uuid;
begin
  v_staff_org:=public.current_user_organization_id();

  if v_staff_org is not null then
    if new.organization_id is null then
      new.organization_id:=v_staff_org;
    elsif new.organization_id<>v_staff_org then
      raise exception 'EQUIPMENT_CONTRACT_ORGANIZATION_MISMATCH';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function private.assign_equipment_contract_organization() from public,anon,authenticated;

drop trigger if exists trg_equipment_contracts_assign_organization on public.equipment_contracts;
create trigger trg_equipment_contracts_assign_organization
before insert or update of organization_id
on public.equipment_contracts
for each row
execute function private.assign_equipment_contract_organization();

create or replace function private.enforce_equipment_contract_child_tenant()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public,auth
as $$
declare
  v_contract_id uuid;
  v_contract_org uuid;
  v_contract_partner uuid;
  v_staff_org uuid;
  v_partner uuid;
begin
  v_contract_id:=nullif(to_jsonb(new)->>'contract_id','')::uuid;
  if v_contract_id is null then
    return new;
  end if;

  select c.organization_id,c.partner_id
    into v_contract_org,v_contract_partner
  from public.equipment_contracts c
  where c.id=v_contract_id;

  if v_contract_org is null then
    raise exception 'EQUIPMENT_CONTRACT_ORGANIZATION_REQUIRED';
  end if;

  v_staff_org:=public.current_user_organization_id();
  v_partner:=public.current_partner_id();

  if v_staff_org is not null and v_contract_org<>v_staff_org then
    raise exception 'EQUIPMENT_CONTRACT_TENANT_MISMATCH';
  end if;

  if v_staff_org is null and v_partner is not null and v_contract_partner is distinct from v_partner then
    raise exception 'EQUIPMENT_CONTRACT_PARTNER_MISMATCH';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_equipment_contract_child_tenant() from public,anon,authenticated;

create or replace function private.enforce_equipment_contract_equipment_match()
returns trigger
language plpgsql
security definer
set search_path=pg_catalog,public
as $$
declare
  v_contract_id uuid;
  v_equipment_id uuid;
  v_contract_org uuid;
  v_equipment_org uuid;
begin
  v_contract_id:=nullif(to_jsonb(new)->>'contract_id','')::uuid;
  v_equipment_id:=nullif(to_jsonb(new)->>'equipment_id','')::uuid;

  if v_contract_id is null or v_equipment_id is null then
    return new;
  end if;

  select organization_id into v_contract_org
  from public.equipment_contracts
  where id=v_contract_id;

  select organization_id into v_equipment_org
  from public.equipment_assets
  where id=v_equipment_id;

  if v_contract_org is null or v_equipment_org is null or v_contract_org<>v_equipment_org then
    raise exception 'EQUIPMENT_CONTRACT_ASSET_TENANT_MISMATCH';
  end if;

  return new;
end;
$$;

revoke all on function private.enforce_equipment_contract_equipment_match() from public,anon,authenticated;

-- Attach tenant guards to all primary contract-linked writable tables.
do $$
declare
  t text;
begin
  foreach t in array array[
    'equipment_contract_assets',
    'equipment_contract_amendments',
    'equipment_contract_amendment_signatures',
    'equipment_contract_terminations',
    'equipment_condition_inspections',
    'equipment_condition_comparisons',
    'equipment_condition_claims',
    'equipment_owner_settlements',
    'equipment_lease_charges',
    'equipment_contract_deadline_events',
    'equipment_service_log'
  ]
  loop
    execute format('drop trigger if exists trg_%I_contract_tenant on public.%I',t,t);
    execute format(
      'create trigger trg_%I_contract_tenant before insert or update on public.%I for each row execute function private.enforce_equipment_contract_child_tenant()',
      t,t
    );
  end loop;
end
$$;

do $$
declare
  t text;
begin
  foreach t in array array[
    'equipment_contract_assets',
    'equipment_condition_inspections',
    'equipment_condition_comparisons',
    'equipment_condition_claims',
    'equipment_service_log'
  ]
  loop
    execute format('drop trigger if exists trg_%I_contract_equipment_match on public.%I',t,t);
    execute format(
      'create trigger trg_%I_contract_equipment_match before insert or update on public.%I for each row execute function private.enforce_equipment_contract_equipment_match()',
      t,t
    );
  end loop;
end
$$;

-- EQUIPMENT CONTRACTS: keep equipment_contracts_partner_read unchanged.
drop policy if exists equipment_contracts_manage on public.equipment_contracts;
drop policy if exists equipment_contracts_staff_read on public.equipment_contracts;

create policy equipment_contracts_tenant_manage on public.equipment_contracts
for all to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.has_permission('equipment.contracts.manage')
)
with check (
  organization_id=public.current_user_organization_id()
  and public.has_permission('equipment.contracts.manage')
);

create policy equipment_contracts_tenant_staff_read on public.equipment_contracts
for select to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.has_permission('equipment.view')
);

-- CONTRACT ASSETS: preserve equipment_contract_assets_partner_read.
drop policy if exists equipment_contract_assets_manage on public.equipment_contract_assets;
drop policy if exists equipment_contract_assets_staff_read on public.equipment_contract_assets;

create policy equipment_contract_assets_tenant_manage on public.equipment_contract_assets
for all to authenticated
using (
  public.has_permission('equipment.contracts.manage')
  and exists (
    select 1 from public.equipment_contracts c
    where c.id=equipment_contract_assets.contract_id
      and c.organization_id=public.current_user_organization_id()
  )
  and exists (
    select 1 from public.equipment_assets a
    where a.id=equipment_contract_assets.equipment_id
      and a.organization_id=public.current_user_organization_id()
  )
)
with check (
  public.has_permission('equipment.contracts.manage')
  and exists (
    select 1 from public.equipment_contracts c
    where c.id=equipment_contract_assets.contract_id
      and c.organization_id=public.current_user_organization_id()
  )
  and exists (
    select 1 from public.equipment_assets a
    where a.id=equipment_contract_assets.equipment_id
      and a.organization_id=public.current_user_organization_id()
  )
);

create policy equipment_contract_assets_tenant_staff_read on public.equipment_contract_assets
for select to authenticated
using (
  public.has_permission('equipment.view')
  and exists (
    select 1 from public.equipment_contracts c
    where c.id=equipment_contract_assets.contract_id
      and c.organization_id=public.current_user_organization_id()
  )
  and exists (
    select 1 from public.equipment_assets a
    where a.id=equipment_contract_assets.equipment_id
      and a.organization_id=public.current_user_organization_id()
  )
);

-- AMENDMENTS
drop policy if exists equipment_contract_amendments_read on public.equipment_contract_amendments;

create policy equipment_contract_amendments_tenant_staff_read on public.equipment_contract_amendments
for select to authenticated
using (
  (public.has_permission('equipment.view') or public.has_permission('equipment.contracts.manage'))
  and exists (
    select 1 from public.equipment_contracts c
    where c.id=equipment_contract_amendments.contract_id
      and c.organization_id=public.current_user_organization_id()
  )
);

create policy equipment_contract_amendments_partner_read on public.equipment_contract_amendments
for select to authenticated
using (partner_id=public.current_partner_id());

-- AMENDMENT SIGNATURES
drop policy if exists equipment_contract_amendment_signatures_read on public.equipment_contract_amendment_signatures;

create policy equipment_contract_amendment_signatures_tenant_staff_read on public.equipment_contract_amendment_signatures
for select to authenticated
using (
  (public.has_permission('equipment.view') or public.has_permission('equipment.contracts.manage'))
  and exists (
    select 1 from public.equipment_contracts c
    where c.id=equipment_contract_amendment_signatures.contract_id
      and c.organization_id=public.current_user_organization_id()
  )
);

create policy equipment_contract_amendment_signatures_partner_read on public.equipment_contract_amendment_signatures
for select to authenticated
using (partner_id=public.current_partner_id());

-- TERMINATIONS
drop policy if exists equipment_contract_terminations_read on public.equipment_contract_terminations;

create policy equipment_contract_terminations_tenant_staff_read on public.equipment_contract_terminations
for select to authenticated
using (
  (public.has_permission('equipment.view') or public.has_permission('equipment.contracts.manage'))
  and exists (
    select 1 from public.equipment_contracts c
    where c.id=equipment_contract_terminations.contract_id
      and c.organization_id=public.current_user_organization_id()
  )
);

create policy equipment_contract_terminations_partner_read on public.equipment_contract_terminations
for select to authenticated
using (partner_id=public.current_partner_id());

-- CONDITION INSPECTIONS
drop policy if exists equipment_condition_inspections_read on public.equipment_condition_inspections;

create policy equipment_condition_inspections_tenant_staff_read on public.equipment_condition_inspections
for select to authenticated
using (
  (public.has_permission('equipment.view') or public.has_permission('equipment.manage') or public.has_permission('equipment.contracts.manage'))
  and exists (
    select 1 from public.equipment_contracts c
    where c.id=equipment_condition_inspections.contract_id
      and c.organization_id=public.current_user_organization_id()
  )
);

create policy equipment_condition_inspections_partner_read on public.equipment_condition_inspections
for select to authenticated
using (
  status='COMPLETED'
  and partner_id=public.current_partner_id()
);

-- CONDITION COMPARISONS
drop policy if exists equipment_condition_comparisons_read on public.equipment_condition_comparisons;

create policy equipment_condition_comparisons_tenant_staff_read on public.equipment_condition_comparisons
for select to authenticated
using (
  (public.has_permission('equipment.view') or public.has_permission('equipment.manage') or public.has_permission('equipment.contracts.manage'))
  and exists (
    select 1 from public.equipment_contracts c
    where c.id=equipment_condition_comparisons.contract_id
      and c.organization_id=public.current_user_organization_id()
  )
);

create policy equipment_condition_comparisons_partner_read on public.equipment_condition_comparisons
for select to authenticated
using (partner_id=public.current_partner_id());

-- CONDITION CLAIMS
drop policy if exists equipment_condition_claims_read on public.equipment_condition_claims;

create policy equipment_condition_claims_tenant_staff_read on public.equipment_condition_claims
for select to authenticated
using (
  (public.has_permission('equipment.view') or public.has_permission('equipment.manage') or public.has_permission('equipment.contracts.manage'))
  and exists (
    select 1 from public.equipment_contracts c
    where c.id=equipment_condition_claims.contract_id
      and c.organization_id=public.current_user_organization_id()
  )
);

create policy equipment_condition_claims_partner_read on public.equipment_condition_claims
for select to authenticated
using (
  status<>'DRAFT'
  and partner_id=public.current_partner_id()
);

-- OWNER SETTLEMENTS
drop policy if exists owner_settlements_read on public.equipment_owner_settlements;

create policy owner_settlements_tenant_staff_read on public.equipment_owner_settlements
for select to authenticated
using (
  (public.has_permission('production.settlements.view') or public.has_permission('production.settlements.manage'))
  and exists (
    select 1 from public.equipment_contracts c
    where c.id=equipment_owner_settlements.contract_id
      and c.organization_id=public.current_user_organization_id()
  )
);

create policy owner_settlements_partner_read on public.equipment_owner_settlements
for select to authenticated
using (partner_id=public.current_partner_id());

-- OWNER SETTLEMENT LINES
drop policy if exists owner_settlement_lines_read on public.equipment_owner_settlement_lines;

create policy owner_settlement_lines_tenant_staff_read on public.equipment_owner_settlement_lines
for select to authenticated
using (
  (public.has_permission('production.settlements.view') or public.has_permission('production.settlements.manage'))
  and exists (
    select 1
    from public.equipment_owner_settlements s
    join public.equipment_contracts c on c.id=s.contract_id
    where s.id=equipment_owner_settlement_lines.settlement_id
      and c.organization_id=public.current_user_organization_id()
  )
);

create policy owner_settlement_lines_partner_read on public.equipment_owner_settlement_lines
for select to authenticated
using (
  exists (
    select 1 from public.equipment_owner_settlements s
    where s.id=equipment_owner_settlement_lines.settlement_id
      and s.partner_id=public.current_partner_id()
  )
);

-- LEASE CHARGES
drop policy if exists equipment_lease_charges_read on public.equipment_lease_charges;

create policy equipment_lease_charges_tenant_staff_read on public.equipment_lease_charges
for select to authenticated
using (
  (public.has_permission('production.settlements.view') or public.has_permission('production.buyout.manage'))
  and exists (
    select 1 from public.equipment_contracts c
    where c.id=equipment_lease_charges.contract_id
      and c.organization_id=public.current_user_organization_id()
  )
);

create policy equipment_lease_charges_partner_read on public.equipment_lease_charges
for select to authenticated
using (partner_id=public.current_partner_id());

-- CONTRACT DEADLINES
drop policy if exists equipment_contract_deadline_events_staff_read on public.equipment_contract_deadline_events;

create policy equipment_contract_deadline_events_tenant_staff_read on public.equipment_contract_deadline_events
for select to authenticated
using (
  (public.has_permission('equipment.view') or public.has_permission('equipment.contracts.manage'))
  and exists (
    select 1 from public.equipment_contracts c
    where c.id=equipment_contract_deadline_events.contract_id
      and c.organization_id=public.current_user_organization_id()
  )
);
