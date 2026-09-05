drop policy if exists order_status_history_staff_read on public.order_status_history;
create policy order_status_history_staff_read
on public.order_status_history
for select
to authenticated
using (
  has_role('ADMIN'::text)
  or has_role('MANAGER'::text)
  or has_role('WAREHOUSE'::text)
  or has_role('PRODUCTION'::text)
  or has_role('VIEWER'::text)
);

drop policy if exists order_status_history_staff_write on public.order_status_history;
create policy order_status_history_staff_write
on public.order_status_history
for all
to authenticated
using (has_role('ADMIN'::text) or has_role('MANAGER'::text))
with check (has_role('ADMIN'::text) or has_role('MANAGER'::text));

drop policy if exists production_jobs_staff_read on public.production_jobs;
create policy production_jobs_staff_read
on public.production_jobs
for select
to authenticated
using (
  has_role('ADMIN'::text)
  or has_role('MANAGER'::text)
  or has_role('WAREHOUSE'::text)
  or has_role('PRODUCTION'::text)
  or has_role('VIEWER'::text)
);

drop policy if exists production_jobs_staff_manage on public.production_jobs;
create policy production_jobs_staff_manage
on public.production_jobs
for all
to authenticated
using (
  has_role('ADMIN'::text)
  or has_role('MANAGER'::text)
  or has_role('PRODUCTION'::text)
)
with check (
  has_role('ADMIN'::text)
  or has_role('MANAGER'::text)
  or has_role('PRODUCTION'::text)
);
