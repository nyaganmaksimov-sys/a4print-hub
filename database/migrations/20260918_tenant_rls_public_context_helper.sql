-- Correct tenant RLS helper exposure without granting authenticated access to the private schema.

create or replace function public.current_user_organization_id()
returns uuid
language sql
stable
security definer
set search_path = pg_catalog, public, auth, private
as $$
  select private.current_user_organization_id()
$$;

revoke all on function public.current_user_organization_id() from public, anon;
grant execute on function public.current_user_organization_id() to authenticated;

drop policy if exists customers_tenant_select on public.customers;
drop policy if exists customers_tenant_insert on public.customers;
drop policy if exists customers_tenant_update on public.customers;
drop policy if exists customers_tenant_delete on public.customers;
drop policy if exists orders_tenant_staff_select on public.orders;
drop policy if exists orders_tenant_staff_insert on public.orders;
drop policy if exists orders_tenant_staff_update on public.orders;
drop policy if exists orders_tenant_staff_delete on public.orders;
drop policy if exists order_items_tenant_staff_select on public.order_items;
drop policy if exists order_items_tenant_staff_insert on public.order_items;
drop policy if exists order_items_tenant_staff_update on public.order_items;
drop policy if exists order_items_tenant_staff_delete on public.order_items;
drop policy if exists order_files_tenant_staff_select on public.order_files;
drop policy if exists order_files_tenant_staff_insert on public.order_files;
drop policy if exists order_files_tenant_staff_update on public.order_files;
drop policy if exists order_files_tenant_staff_delete on public.order_files;
drop policy if exists order_status_history_tenant_select on public.order_status_history;
drop policy if exists order_status_history_tenant_insert on public.order_status_history;
drop policy if exists order_status_history_tenant_update on public.order_status_history;
drop policy if exists order_status_history_tenant_delete on public.order_status_history;
drop policy if exists production_jobs_tenant_select on public.production_jobs;
drop policy if exists production_jobs_tenant_insert on public.production_jobs;
drop policy if exists production_jobs_tenant_update on public.production_jobs;
drop policy if exists production_jobs_tenant_delete on public.production_jobs;
drop policy if exists production_job_materials_tenant_select on public.production_job_materials;
drop policy if exists production_job_materials_tenant_insert on public.production_job_materials;
drop policy if exists production_job_materials_tenant_update on public.production_job_materials;
drop policy if exists production_job_materials_tenant_delete on public.production_job_materials;
drop policy if exists warehouses_tenant_select on public.warehouses;
drop policy if exists warehouses_tenant_insert on public.warehouses;
drop policy if exists warehouses_tenant_update on public.warehouses;
drop policy if exists warehouses_tenant_delete on public.warehouses;
drop policy if exists warehouse_locations_tenant_select on public.warehouse_locations;
drop policy if exists warehouse_locations_tenant_insert on public.warehouse_locations;
drop policy if exists warehouse_locations_tenant_update on public.warehouse_locations;
drop policy if exists warehouse_locations_tenant_delete on public.warehouse_locations;

create policy customers_tenant_select on public.customers
for select to authenticated
using (
  organization_id = public.current_user_organization_id()
  and (
    public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('POS_OPERATOR')
    or public.has_role('WAREHOUSE') or public.has_role('PRODUCTION') or public.has_role('VIEWER')
  )
);

create policy customers_tenant_insert on public.customers
for insert to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('POS_OPERATOR'))
);

create policy customers_tenant_update on public.customers
for update to authenticated
using (
  organization_id = public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('POS_OPERATOR'))
)
with check (
  organization_id = public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('POS_OPERATOR'))
);

create policy customers_tenant_delete on public.customers
for delete to authenticated
using (
  organization_id = public.current_user_organization_id()
  and public.has_role('ADMIN')
);

create policy orders_tenant_staff_select on public.orders
for select to authenticated
using (
  (
    organization_id = public.current_user_organization_id()
    or (organization_id is null and business_unit::text = 'COMMON')
  )
  and (
    public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE')
    or public.has_role('PRODUCTION') or public.has_role('VIEWER')
  )
);

create policy orders_tenant_staff_insert on public.orders
for insert to authenticated
with check (
  (
    organization_id = public.current_user_organization_id()
    or (organization_id is null and business_unit::text = 'COMMON')
  )
  and (public.has_role('ADMIN') or public.has_role('MANAGER'))
);

create policy orders_tenant_staff_update on public.orders
for update to authenticated
using (
  (
    organization_id = public.current_user_organization_id()
    or (organization_id is null and business_unit::text = 'COMMON')
  )
  and (public.has_role('ADMIN') or public.has_role('MANAGER'))
)
with check (
  (
    organization_id = public.current_user_organization_id()
    or (organization_id is null and business_unit::text = 'COMMON')
  )
  and (public.has_role('ADMIN') or public.has_role('MANAGER'))
);

create policy orders_tenant_staff_delete on public.orders
for delete to authenticated
using (
  (
    organization_id = public.current_user_organization_id()
    or (organization_id is null and business_unit::text = 'COMMON')
  )
  and (public.has_role('ADMIN') or public.has_role('MANAGER'))
);

create policy order_items_tenant_staff_select on public.order_items
for select to authenticated
using (
  (
    public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE')
    or public.has_role('PRODUCTION') or public.has_role('VIEWER')
  )
  and exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and (
        o.organization_id = public.current_user_organization_id()
        or (o.organization_id is null and o.business_unit::text='COMMON')
      )
  )
);

create policy order_items_tenant_staff_insert on public.order_items
for insert to authenticated
with check (
  (public.has_role('ADMIN') or public.has_role('MANAGER'))
  and exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and (
        o.organization_id = public.current_user_organization_id()
        or (o.organization_id is null and o.business_unit::text='COMMON')
      )
  )
);

create policy order_items_tenant_staff_update on public.order_items
for update to authenticated
using (
  (public.has_role('ADMIN') or public.has_role('MANAGER'))
  and exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and (
        o.organization_id = public.current_user_organization_id()
        or (o.organization_id is null and o.business_unit::text='COMMON')
      )
  )
)
with check (
  (public.has_role('ADMIN') or public.has_role('MANAGER'))
  and exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and (
        o.organization_id = public.current_user_organization_id()
        or (o.organization_id is null and o.business_unit::text='COMMON')
      )
  )
);

create policy order_items_tenant_staff_delete on public.order_items
for delete to authenticated
using (
  (public.has_role('ADMIN') or public.has_role('MANAGER'))
  and exists (
    select 1 from public.orders o
    where o.id = order_items.order_id
      and (
        o.organization_id = public.current_user_organization_id()
        or (o.organization_id is null and o.business_unit::text='COMMON')
      )
  )
);

create policy order_files_tenant_staff_select on public.order_files
for select to authenticated
using (
  (
    public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE')
    or public.has_role('PRODUCTION') or public.has_role('VIEWER')
  )
  and exists (
    select 1 from public.orders o
    where o.id = order_files.order_id
      and (
        o.organization_id = public.current_user_organization_id()
        or (o.organization_id is null and o.business_unit::text='COMMON')
      )
  )
);

create policy order_files_tenant_staff_insert on public.order_files
for insert to authenticated
with check (
  (public.has_role('ADMIN') or public.has_role('MANAGER'))
  and exists (
    select 1 from public.orders o
    where o.id = order_files.order_id
      and (
        o.organization_id = public.current_user_organization_id()
        or (o.organization_id is null and o.business_unit::text='COMMON')
      )
  )
);

create policy order_files_tenant_staff_update on public.order_files
for update to authenticated
using (
  (public.has_role('ADMIN') or public.has_role('MANAGER'))
  and exists (
    select 1 from public.orders o
    where o.id = order_files.order_id
      and (
        o.organization_id = public.current_user_organization_id()
        or (o.organization_id is null and o.business_unit::text='COMMON')
      )
  )
)
with check (
  (public.has_role('ADMIN') or public.has_role('MANAGER'))
  and exists (
    select 1 from public.orders o
    where o.id = order_files.order_id
      and (
        o.organization_id = public.current_user_organization_id()
        or (o.organization_id is null and o.business_unit::text='COMMON')
      )
  )
);

create policy order_files_tenant_staff_delete on public.order_files
for delete to authenticated
using (
  (public.has_role('ADMIN') or public.has_role('MANAGER'))
  and exists (
    select 1 from public.orders o
    where o.id = order_files.order_id
      and (
        o.organization_id = public.current_user_organization_id()
        or (o.organization_id is null and o.business_unit::text='COMMON')
      )
  )
);

create policy order_status_history_tenant_select on public.order_status_history
for select to authenticated
using (
  (
    public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE')
    or public.has_role('PRODUCTION') or public.has_role('VIEWER')
  )
  and exists (
    select 1 from public.orders o
    where o.id = order_status_history.order_id
      and (
        o.organization_id = public.current_user_organization_id()
        or (o.organization_id is null and o.business_unit::text='COMMON')
      )
  )
);

create policy order_status_history_tenant_insert on public.order_status_history
for insert to authenticated
with check (
  (public.has_role('ADMIN') or public.has_role('MANAGER'))
  and exists (
    select 1 from public.orders o
    where o.id = order_status_history.order_id
      and (
        o.organization_id = public.current_user_organization_id()
        or (o.organization_id is null and o.business_unit::text='COMMON')
      )
  )
);

create policy order_status_history_tenant_update on public.order_status_history
for update to authenticated
using (
  (public.has_role('ADMIN') or public.has_role('MANAGER'))
  and exists (
    select 1 from public.orders o
    where o.id = order_status_history.order_id
      and (
        o.organization_id = public.current_user_organization_id()
        or (o.organization_id is null and o.business_unit::text='COMMON')
      )
  )
)
with check (
  (public.has_role('ADMIN') or public.has_role('MANAGER'))
  and exists (
    select 1 from public.orders o
    where o.id = order_status_history.order_id
      and (
        o.organization_id = public.current_user_organization_id()
        or (o.organization_id is null and o.business_unit::text='COMMON')
      )
  )
);

create policy order_status_history_tenant_delete on public.order_status_history
for delete to authenticated
using (
  (public.has_role('ADMIN') or public.has_role('MANAGER'))
  and exists (
    select 1 from public.orders o
    where o.id = order_status_history.order_id
      and (
        o.organization_id = public.current_user_organization_id()
        or (o.organization_id is null and o.business_unit::text='COMMON')
      )
  )
);

create policy production_jobs_tenant_select on public.production_jobs
for select to authenticated
using (
  organization_id = public.current_user_organization_id()
  and (
    public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE')
    or public.has_role('PRODUCTION') or public.has_role('VIEWER')
  )
);

create policy production_jobs_tenant_insert on public.production_jobs
for insert to authenticated
with check (
  organization_id = public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('PRODUCTION'))
);

create policy production_jobs_tenant_update on public.production_jobs
for update to authenticated
using (
  organization_id = public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('PRODUCTION'))
)
with check (
  organization_id = public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('PRODUCTION'))
);

create policy production_jobs_tenant_delete on public.production_jobs
for delete to authenticated
using (
  organization_id = public.current_user_organization_id()
  and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('PRODUCTION'))
);

create policy production_job_materials_tenant_select on public.production_job_materials
for select to authenticated
using (
  public.has_permission('production.view')
  and exists (
    select 1 from public.production_jobs pj
    where pj.id=production_job_materials.production_job_id
      and pj.organization_id=public.current_user_organization_id()
  )
);

create policy production_job_materials_tenant_insert on public.production_job_materials
for insert to authenticated
with check (
  public.has_permission('production.manage')
  and exists (
    select 1 from public.production_jobs pj
    where pj.id=production_job_materials.production_job_id
      and pj.organization_id=public.current_user_organization_id()
  )
);

create policy production_job_materials_tenant_update on public.production_job_materials
for update to authenticated
using (
  public.has_permission('production.manage')
  and exists (
    select 1 from public.production_jobs pj
    where pj.id=production_job_materials.production_job_id
      and pj.organization_id=public.current_user_organization_id()
  )
)
with check (
  public.has_permission('production.manage')
  and exists (
    select 1 from public.production_jobs pj
    where pj.id=production_job_materials.production_job_id
      and pj.organization_id=public.current_user_organization_id()
  )
);

create policy production_job_materials_tenant_delete on public.production_job_materials
for delete to authenticated
using (
  public.has_permission('production.manage')
  and exists (
    select 1 from public.production_jobs pj
    where pj.id=production_job_materials.production_job_id
      and pj.organization_id=public.current_user_organization_id()
  )
);

create policy warehouses_tenant_select on public.warehouses
for select to authenticated
using (
  (organization_id=public.current_user_organization_id() or is_shared=true)
  and public.is_hub_staff()
);

create policy warehouses_tenant_insert on public.warehouses
for insert to authenticated
with check (
  (organization_id=public.current_user_organization_id() or is_shared=true)
  and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
);

create policy warehouses_tenant_update on public.warehouses
for update to authenticated
using (
  (organization_id=public.current_user_organization_id() or is_shared=true)
  and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
)
with check (
  (organization_id=public.current_user_organization_id() or is_shared=true)
  and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
);

create policy warehouses_tenant_delete on public.warehouses
for delete to authenticated
using (
  (organization_id=public.current_user_organization_id() or is_shared=true)
  and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
);

create policy warehouse_locations_tenant_select on public.warehouse_locations
for select to authenticated
using (
  public.is_hub_staff()
  and exists (
    select 1 from public.warehouses w
    where w.id=warehouse_locations.warehouse_id
      and (w.organization_id=public.current_user_organization_id() or w.is_shared=true)
  )
);

create policy warehouse_locations_tenant_insert on public.warehouse_locations
for insert to authenticated
with check (
  (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
  and exists (
    select 1 from public.warehouses w
    where w.id=warehouse_locations.warehouse_id
      and (w.organization_id=public.current_user_organization_id() or w.is_shared=true)
  )
);

create policy warehouse_locations_tenant_update on public.warehouse_locations
for update to authenticated
using (
  (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
  and exists (
    select 1 from public.warehouses w
    where w.id=warehouse_locations.warehouse_id
      and (w.organization_id=public.current_user_organization_id() or w.is_shared=true)
  )
)
with check (
  (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
  and exists (
    select 1 from public.warehouses w
    where w.id=warehouse_locations.warehouse_id
      and (w.organization_id=public.current_user_organization_id() or w.is_shared=true)
  )
);

create policy warehouse_locations_tenant_delete on public.warehouse_locations
for delete to authenticated
using (
  (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
  and exists (
    select 1 from public.warehouses w
    where w.id=warehouse_locations.warehouse_id
      and (w.organization_id=public.current_user_organization_id() or w.is_shared=true)
  )
);
