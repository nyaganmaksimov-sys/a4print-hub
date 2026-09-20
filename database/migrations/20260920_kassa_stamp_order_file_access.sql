-- Cross-company A4 group staff may attach files to dedicated Kassa stamp orders.
-- Restricted to A4PRINT + source=KASSA_STAMP_ORDER.
drop policy if exists order_files_kassa_stamp_staff_select on public.order_files;
create policy order_files_kassa_stamp_staff_select on public.order_files
for select to authenticated
using (
  (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('POS_OPERATOR'))
  and exists(
    select 1
    from public.orders o
    join public.organizations org on org.id=o.organization_id
    where o.id=order_id
      and org.code='A4PRINT'
      and o.source='KASSA_STAMP_ORDER'
  )
);

drop policy if exists order_files_kassa_stamp_staff_insert on public.order_files;
create policy order_files_kassa_stamp_staff_insert on public.order_files
for insert to authenticated
with check (
  (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('POS_OPERATOR'))
  and exists(
    select 1
    from public.orders o
    join public.organizations org on org.id=o.organization_id
    where o.id=order_id
      and org.code='A4PRINT'
      and o.source='KASSA_STAMP_ORDER'
  )
);

drop policy if exists order_files_kassa_stamp_pos_select on public.order_files;
drop policy if exists order_files_kassa_stamp_pos_insert on public.order_files;
