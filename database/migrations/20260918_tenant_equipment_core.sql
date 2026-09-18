-- PHASE 2 CORE MULTI-COMPANY
-- Tenant-aware RLS for internal equipment operations.
-- Partner-facing ownership policy is preserved.

-- ROOT EQUIPMENT ASSETS
drop policy if exists equipment_assets_manage on public.equipment_assets;
drop policy if exists equipment_assets_staff_read on public.equipment_assets;

create policy equipment_assets_tenant_manage on public.equipment_assets
for all to authenticated
using (
  organization_id=public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
)
with check (
  organization_id=public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
);

create policy equipment_assets_tenant_staff_read on public.equipment_assets
for select to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.is_hub_staff()
);

-- CONSUMABLES
drop policy if exists equipment_consumables_manage on public.equipment_consumables;
drop policy if exists equipment_consumables_staff_read on public.equipment_consumables;

create policy equipment_consumables_tenant_manage on public.equipment_consumables
for all to authenticated
using (
  organization_id=public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
)
with check (
  organization_id=public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
);

create policy equipment_consumables_tenant_staff_read on public.equipment_consumables
for select to authenticated
using (
  organization_id=public.current_user_organization_id()
  and public.is_hub_staff()
);

-- CONSUMABLE LINKS: both ends must belong to the current organization.
drop policy if exists equipment_links_manage on public.equipment_consumable_links;
drop policy if exists equipment_links_staff_read on public.equipment_consumable_links;

create policy equipment_links_tenant_manage on public.equipment_consumable_links
for all to authenticated
using (
  (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
  and exists (
    select 1 from public.equipment_assets ea
    where ea.id=equipment_consumable_links.equipment_id
      and ea.organization_id=public.current_user_organization_id()
  )
  and exists (
    select 1 from public.equipment_consumables ec
    where ec.id=equipment_consumable_links.consumable_id
      and ec.organization_id=public.current_user_organization_id()
  )
)
with check (
  (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
  and exists (
    select 1 from public.equipment_assets ea
    where ea.id=equipment_consumable_links.equipment_id
      and ea.organization_id=public.current_user_organization_id()
  )
  and exists (
    select 1 from public.equipment_consumables ec
    where ec.id=equipment_consumable_links.consumable_id
      and ec.organization_id=public.current_user_organization_id()
  )
);

create policy equipment_links_tenant_staff_read on public.equipment_consumable_links
for select to authenticated
using (
  public.is_hub_staff()
  and exists (
    select 1 from public.equipment_assets ea
    where ea.id=equipment_consumable_links.equipment_id
      and ea.organization_id=public.current_user_organization_id()
  )
  and exists (
    select 1 from public.equipment_consumables ec
    where ec.id=equipment_consumable_links.consumable_id
      and ec.organization_id=public.current_user_organization_id()
  )
);

-- CONSUMABLE MOVEMENTS
drop policy if exists equipment_movements_insert on public.equipment_consumable_movements;
drop policy if exists equipment_movements_staff_read on public.equipment_consumable_movements;

create policy equipment_movements_tenant_insert on public.equipment_consumable_movements
for insert to authenticated
with check (
  (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE') or public.has_role('PRODUCTION'))
  and exists (
    select 1 from public.equipment_consumables ec
    where ec.id=equipment_consumable_movements.consumable_id
      and ec.organization_id=public.current_user_organization_id()
  )
  and (
    equipment_id is null
    or exists (
      select 1 from public.equipment_assets ea
      where ea.id=equipment_consumable_movements.equipment_id
        and ea.organization_id=public.current_user_organization_id()
    )
  )
);

create policy equipment_movements_tenant_staff_read on public.equipment_consumable_movements
for select to authenticated
using (
  public.is_hub_staff()
  and exists (
    select 1 from public.equipment_consumables ec
    where ec.id=equipment_consumable_movements.consumable_id
      and ec.organization_id=public.current_user_organization_id()
  )
  and (
    equipment_id is null
    or exists (
      select 1 from public.equipment_assets ea
      where ea.id=equipment_consumable_movements.equipment_id
        and ea.organization_id=public.current_user_organization_id()
    )
  )
);

-- MAINTENANCE PLANS
drop policy if exists equipment_maintenance_plans_manage on public.equipment_maintenance_plans;
drop policy if exists equipment_maintenance_plans_staff_read on public.equipment_maintenance_plans;

create policy equipment_maintenance_plans_tenant_manage on public.equipment_maintenance_plans
for all to authenticated
using (
  (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
  and exists (
    select 1 from public.equipment_assets ea
    where ea.id=equipment_maintenance_plans.equipment_id
      and ea.organization_id=public.current_user_organization_id()
  )
)
with check (
  (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
  and exists (
    select 1 from public.equipment_assets ea
    where ea.id=equipment_maintenance_plans.equipment_id
      and ea.organization_id=public.current_user_organization_id()
  )
);

create policy equipment_maintenance_plans_tenant_staff_read on public.equipment_maintenance_plans
for select to authenticated
using (
  public.is_hub_staff()
  and exists (
    select 1 from public.equipment_assets ea
    where ea.id=equipment_maintenance_plans.equipment_id
      and ea.organization_id=public.current_user_organization_id()
  )
);

-- SERVICE LOG
drop policy if exists equipment_service_manage on public.equipment_service_log;
drop policy if exists equipment_service_staff_read on public.equipment_service_log;

create policy equipment_service_tenant_manage on public.equipment_service_log
for all to authenticated
using (
  (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
  and exists (
    select 1 from public.equipment_assets ea
    where ea.id=equipment_service_log.equipment_id
      and ea.organization_id=public.current_user_organization_id()
  )
)
with check (
  (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
  and exists (
    select 1 from public.equipment_assets ea
    where ea.id=equipment_service_log.equipment_id
      and ea.organization_id=public.current_user_organization_id()
  )
);

create policy equipment_service_tenant_staff_read on public.equipment_service_log
for select to authenticated
using (
  public.is_hub_staff()
  and exists (
    select 1 from public.equipment_assets ea
    where ea.id=equipment_service_log.equipment_id
      and ea.organization_id=public.current_user_organization_id()
  )
);

-- CAPACITY RULES
drop policy if exists equipment_capacity_rules_staff_read on public.equipment_capacity_rules;

create policy equipment_capacity_rules_tenant_staff_read on public.equipment_capacity_rules
for select to authenticated
using (
  (public.has_permission('production.view') or public.has_permission('production.analytics.view'))
  and exists (
    select 1 from public.equipment_assets ea
    where ea.id=equipment_capacity_rules.equipment_id
      and ea.organization_id=public.current_user_organization_id()
  )
);

-- IMPROVEMENTS
drop policy if exists equipment_improvements_manage on public.equipment_improvements;
drop policy if exists equipment_improvements_staff_read on public.equipment_improvements;

create policy equipment_improvements_tenant_manage on public.equipment_improvements
for all to authenticated
using (
  public.has_permission('equipment.manage')
  and exists (
    select 1 from public.equipment_assets ea
    where ea.id=equipment_improvements.equipment_id
      and ea.organization_id=public.current_user_organization_id()
  )
)
with check (
  public.has_permission('equipment.manage')
  and exists (
    select 1 from public.equipment_assets ea
    where ea.id=equipment_improvements.equipment_id
      and ea.organization_id=public.current_user_organization_id()
  )
);

create policy equipment_improvements_tenant_staff_read on public.equipment_improvements
for select to authenticated
using (
  public.has_permission('equipment.view')
  and exists (
    select 1 from public.equipment_assets ea
    where ea.id=equipment_improvements.equipment_id
      and ea.organization_id=public.current_user_organization_id()
  )
);

-- INCIDENTS
drop policy if exists equipment_incidents_staff_read on public.equipment_incidents;

create policy equipment_incidents_tenant_staff_read on public.equipment_incidents
for select to authenticated
using (
  (public.has_permission('equipment.view') or public.has_permission('equipment.repair') or public.has_permission('production.view'))
  and exists (
    select 1 from public.equipment_assets ea
    where ea.id=equipment_incidents.equipment_id
      and ea.organization_id=public.current_user_organization_id()
  )
);

-- INSURANCE
drop policy if exists equipment_insurance_manage on public.equipment_insurance_policies;
drop policy if exists equipment_insurance_staff_read on public.equipment_insurance_policies;

create policy equipment_insurance_tenant_manage on public.equipment_insurance_policies
for all to authenticated
using (
  public.has_permission('equipment.manage')
  and exists (
    select 1 from public.equipment_assets ea
    where ea.id=equipment_insurance_policies.equipment_id
      and ea.organization_id=public.current_user_organization_id()
  )
)
with check (
  public.has_permission('equipment.manage')
  and exists (
    select 1 from public.equipment_assets ea
    where ea.id=equipment_insurance_policies.equipment_id
      and ea.organization_id=public.current_user_organization_id()
  )
);

create policy equipment_insurance_tenant_staff_read on public.equipment_insurance_policies
for select to authenticated
using (
  public.has_permission('equipment.view')
  and exists (
    select 1 from public.equipment_assets ea
    where ea.id=equipment_insurance_policies.equipment_id
      and ea.organization_id=public.current_user_organization_id()
  )
);

-- OWNERSHIP HISTORY: preserve equipment_ownership_partner_read.
drop policy if exists equipment_ownership_staff_read on public.equipment_ownership_history;

create policy equipment_ownership_tenant_staff_read on public.equipment_ownership_history
for select to authenticated
using (
  public.has_permission('equipment.view')
  and exists (
    select 1 from public.equipment_assets ea
    where ea.id=equipment_ownership_history.equipment_id
      and ea.organization_id=public.current_user_organization_id()
  )
);
