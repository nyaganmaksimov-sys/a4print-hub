create schema if not exists private;

create or replace function private.kassa_special_order_file_access(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public, auth
as $function$
  select
    (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('POS_OPERATOR'))
    and exists (
      select 1
      from public.orders o
      join public.organizations org on org.id=o.organization_id
      where o.id=p_order_id
        and org.code='A4PRINT'
        and o.source in ('KASSA_STAMP_ORDER','KASSA_PARTNER_ORDER')
    );
$function$;

revoke all on function private.kassa_special_order_file_access(uuid) from public;
revoke all on function private.kassa_special_order_file_access(uuid) from anon;
grant execute on function private.kassa_special_order_file_access(uuid) to authenticated;

drop policy if exists order_files_kassa_stamp_staff_insert on public.order_files;
drop policy if exists order_files_kassa_stamp_staff_select on public.order_files;
drop policy if exists order_files_kassa_partner_staff_insert on public.order_files;
drop policy if exists order_files_kassa_partner_staff_select on public.order_files;
drop policy if exists order_files_kassa_special_staff_insert on public.order_files;
drop policy if exists order_files_kassa_special_staff_select on public.order_files;

create policy order_files_kassa_special_staff_insert
on public.order_files for insert to authenticated
with check ((select private.kassa_special_order_file_access(order_files.order_id)));

create policy order_files_kassa_special_staff_select
on public.order_files for select to authenticated
using ((select private.kassa_special_order_file_access(order_files.order_id)));
