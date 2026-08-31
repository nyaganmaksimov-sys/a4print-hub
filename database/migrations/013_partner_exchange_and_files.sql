-- A4PRINT HUB: bidirectional partner exchange + private order files
-- Run after 012_partner_order_auth_fix.sql.

create table if not exists public.partner_supplier_services (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  category text not null default 'Услуги',
  name text not null,
  description text,
  unit text not null default 'заказ',
  price numeric(14,2) not null default 0 check (price >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(partner_id,name)
);
create index if not exists idx_partner_supplier_services_partner on public.partner_supplier_services(partner_id,is_active);

alter table public.orders add column if not exists fulfillment_partner_id uuid references public.partners(id) on delete set null;
alter table public.orders add column if not exists partner_direction text not null default 'INBOUND'
  check (partner_direction in ('INBOUND','OUTBOUND','NONE'));
create index if not exists idx_orders_fulfillment_partner on public.orders(fulfillment_partner_id,created_at desc);

-- Backfill existing partner-created orders.
update public.orders set partner_direction='INBOUND'
where source='PARTNER' and partner_id is not null and partner_direction='INBOUND';

-- Private storage bucket for customer/partner layouts and production files.
insert into storage.buckets(id,name,public,file_size_limit)
values('order-files','order-files',false,52428800)
on conflict(id) do update set public=false,file_size_limit=52428800;

alter table public.partner_supplier_services enable row level security;

drop policy if exists pss_staff_all on public.partner_supplier_services;
create policy pss_staff_all on public.partner_supplier_services for all to authenticated
using (public.has_role('ADMIN') or public.has_role('MANAGER'))
with check (public.has_role('ADMIN') or public.has_role('MANAGER'));

drop policy if exists pss_partner_read on public.partner_supplier_services;
create policy pss_partner_read on public.partner_supplier_services for select to authenticated
using (partner_id=public.current_partner_id());

drop policy if exists pss_partner_write on public.partner_supplier_services;
create policy pss_partner_write on public.partner_supplier_services for all to authenticated
using (partner_id=public.current_partner_id())
with check (partner_id=public.current_partner_id());

-- Partners may also see orders where they are the executor.
drop policy if exists orders_partner_read on public.orders;
create policy orders_partner_read on public.orders for select to authenticated
using (partner_id=public.current_partner_id() or fulfillment_partner_id=public.current_partner_id());

drop policy if exists order_items_partner_read on public.order_items;
create policy order_items_partner_read on public.order_items for select to authenticated
using (exists(select 1 from public.orders o where o.id=order_id and (o.partner_id=public.current_partner_id() or o.fulfillment_partner_id=public.current_partner_id())));

drop policy if exists order_files_partner_read on public.order_files;
create policy order_files_partner_read on public.order_files for select to authenticated
using (exists(select 1 from public.orders o where o.id=order_id and (o.partner_id=public.current_partner_id() or o.fulfillment_partner_id=public.current_partner_id())));

drop policy if exists order_files_partner_insert on public.order_files;
create policy order_files_partner_insert on public.order_files for insert to authenticated
with check (exists(select 1 from public.orders o where o.id=order_id and (o.partner_id=public.current_partner_id() or o.fulfillment_partner_id=public.current_partner_id())));

-- Storage access: first folder in object name must be order UUID text.
drop policy if exists order_files_storage_staff_select on storage.objects;
create policy order_files_storage_staff_select on storage.objects for select to authenticated
using (bucket_id='order-files' and public.is_hub_staff());
drop policy if exists order_files_storage_staff_insert on storage.objects;
create policy order_files_storage_staff_insert on storage.objects for insert to authenticated
with check (bucket_id='order-files' and public.is_hub_staff());
drop policy if exists order_files_storage_staff_update on storage.objects;
create policy order_files_storage_staff_update on storage.objects for update to authenticated
using (bucket_id='order-files' and public.is_hub_staff())
with check (bucket_id='order-files' and public.is_hub_staff());
drop policy if exists order_files_storage_staff_delete on storage.objects;
create policy order_files_storage_staff_delete on storage.objects for delete to authenticated
using (bucket_id='order-files' and public.is_hub_staff());

drop policy if exists order_files_storage_partner_select on storage.objects;
create policy order_files_storage_partner_select on storage.objects for select to authenticated
using (
  bucket_id='order-files' and exists(
    select 1 from public.orders o
    where o.id::text=split_part(name,'/',1)
      and (o.partner_id=public.current_partner_id() or o.fulfillment_partner_id=public.current_partner_id())
  )
);
drop policy if exists order_files_storage_partner_insert on storage.objects;
create policy order_files_storage_partner_insert on storage.objects for insert to authenticated
with check (
  bucket_id='order-files' and exists(
    select 1 from public.orders o
    where o.id::text=split_part(name,'/',1)
      and (o.partner_id=public.current_partner_id() or o.fulfillment_partner_id=public.current_partner_id())
  )
);

-- HUB creates an order to a partner using that partner's own price list.
create or replace function public.create_hub_partner_order(
  p_partner_id uuid,
  p_supplier_service_id uuid,
  p_quantity numeric,
  p_comment text default null,
  p_parameters jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_service public.partner_supplier_services%rowtype;
  v_partner public.partners%rowtype;
  v_order_id uuid;
  v_total numeric(14,2);
begin
  if not (public.has_role('ADMIN') or public.has_role('MANAGER')) then
    raise exception 'MANAGER_REQUIRED';
  end if;
  if coalesce(p_quantity,0)<=0 then raise exception 'INVALID_QUANTITY'; end if;
  select * into v_partner from public.partners where id=p_partner_id and is_active=true;
  if v_partner.id is null then raise exception 'PARTNER_DISABLED'; end if;
  select * into v_service from public.partner_supplier_services
    where id=p_supplier_service_id and partner_id=p_partner_id and is_active=true;
  if v_service.id is null then raise exception 'SERVICE_NOT_AVAILABLE'; end if;
  v_total:=v_service.price*p_quantity;
  insert into public.orders(
    business_unit,status,total,customer_comment,internal_comment,source,model_name,
    fulfillment_partner_id,partner_direction
  ) values(
    'COMMON','NEW',v_total,p_comment,'Заказ поставщику-партнёру: '||v_partner.name,
    'PARTNER_OUTBOUND',v_service.name,v_partner.id,'OUTBOUND'
  ) returning id into v_order_id;
  insert into public.order_items(order_id,name,quantity,unit_price,total_price,parameters)
  values(v_order_id,v_service.name,p_quantity,v_service.price,v_total,
    coalesce(p_parameters,'{}'::jsonb)||jsonb_build_object('partner_supplier_service_id',v_service.id,'partner_supplier_partner_id',v_partner.id,'category',v_service.category));
  return v_order_id;
end;$$;
grant execute on function public.create_hub_partner_order(uuid,uuid,numeric,text,jsonb) to authenticated;

-- Executor partner may move only its incoming HUB order through production statuses.
create or replace function public.partner_update_fulfillment_status(p_order_id uuid,p_status public.order_status)
returns void language plpgsql security definer set search_path=public as $$
declare v_old public.order_status; v_partner uuid;
begin
  v_partner:=public.current_partner_id();
  if v_partner is null then raise exception 'PARTNER_ACCESS_REQUIRED'; end if;
  if p_status not in ('CONFIRMED','IN_PROGRESS','READY','COMPLETED','ON_HOLD') then raise exception 'STATUS_NOT_ALLOWED'; end if;
  select status into v_old from public.orders where id=p_order_id and fulfillment_partner_id=v_partner;
  if v_old is null then raise exception 'ORDER_NOT_FOUND'; end if;
  update public.orders set status=p_status,updated_at=now() where id=p_order_id and fulfillment_partner_id=v_partner;
  insert into public.order_status_history(order_id,old_status,new_status,comment)
  values(p_order_id,v_old,p_status,'Статус изменён партнёром-исполнителем');
end;$$;
grant execute on function public.partner_update_fulfillment_status(uuid,public.order_status) to authenticated;
