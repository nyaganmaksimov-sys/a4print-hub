-- A4PRINT HUB: Partner Portal / B2B
-- Run in Supabase SQL Editor after the existing migrations.

create extension if not exists pgcrypto;

create table if not exists public.partners (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  legal_name text,
  tax_id text,
  contact_name text,
  email text,
  phone text,
  address text,
  discount_percent numeric(5,2) not null default 0 check (discount_percent between 0 and 100),
  credit_limit numeric(14,2) not null default 0 check (credit_limit >= 0),
  payment_terms_days integer not null default 0 check (payment_terms_days >= 0),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.partner_users (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  auth_user_id uuid not null unique,
  full_name text not null,
  email text,
  phone text,
  is_admin boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists idx_partner_users_partner on public.partner_users(partner_id);

create table if not exists public.partner_services (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  business_unit public.business_unit not null default 'COMMON',
  category text not null,
  name text not null,
  description text,
  unit text not null default 'заказ',
  base_price numeric(14,2) not null default 0 check (base_price >= 0),
  partner_price numeric(14,2) not null default 0 check (partner_price >= 0),
  price_note text,
  is_active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.partner_price_overrides (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  partner_service_id uuid not null references public.partner_services(id) on delete cascade,
  price numeric(14,2) not null check (price >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(partner_id, partner_service_id)
);

alter table public.orders add column if not exists partner_id uuid references public.partners(id) on delete set null;
alter table public.orders add column if not exists partner_user_id uuid references public.partner_users(id) on delete set null;
create index if not exists idx_orders_partner on public.orders(partner_id, created_at desc);

create table if not exists public.partner_order_messages (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  partner_user_id uuid references public.partner_users(id) on delete set null,
  staff_user_id uuid references public.users(id) on delete set null,
  sender_type text not null check (sender_type in ('PARTNER','STAFF')),
  body text not null,
  created_at timestamptz not null default now()
);
create index if not exists idx_partner_order_messages_order on public.partner_order_messages(order_id, created_at);

-- Sellable/pre-order B2B catalog. Prices can be filled later without changing the portal.
insert into public.partner_services(code,business_unit,category,name,description,unit,base_price,partner_price,price_note,sort_order)
values
 ('A4-POLY-BUSINESS','A4_PRINT','Полиграфия','Визитки','Изготовление визиток по макету или с разработкой макета','заказ',0,0,'Цена зависит от тиража, бумаги и отделки',10),
 ('A4-POLY-FLYERS','A4_PRINT','Полиграфия','Листовки и флаеры','Печать рекламных листовок и флаеров','заказ',0,0,'Цена зависит от формата, тиража и бумаги',20),
 ('A4-POLY-CALENDAR','A4_PRINT','Полиграфия','Календари','Календари по индивидуальному дизайну','заказ',0,0,'Расчёт по параметрам заказа',30),
 ('A4-WIDE','A4_PRINT','Широкоформатная печать','Плакаты и широкоформатная печать','Предварительные заказы на широкоформатную продукцию','м²',0,0,'Расчёт по площади и материалу',40),
 ('A4-SOUVENIR-MUG','A4_PRINT','Сувенирная продукция','Кружки с нанесением','Сувенирные кружки с индивидуальным изображением','шт',0,0,'Цена зависит от тиража и типа кружки',50),
 ('A4-SOUVENIR-TEXTILE','A4_PRINT','Сувенирная продукция','Нанесение на текстиль','Футболки и другой текстиль с нанесением','шт',0,0,'Расчёт по изделию и макету',60),
 ('A4-STAMP','A4_PRINT','Печати и штампы','Печати и штампы','Изготовление печатей и штампов по предварительному заказу','шт',0,0,'Итог после проверки макета и оснастки',70),
 ('A4-PHOTOCERAMIC','A4_PRINT','Сувенирная продукция','Фотокерамика','Изготовление фотокерамики по макету','шт',0,0,'Расчёт по размеру и типу изделия',80),
 ('3D-FDM','3D_ARTPRINT','3D-печать','FDM 3D-печать','Печать изделий из пластика по готовой 3D-модели','заказ',0,0,'Расчёт по материалу, массе и времени печати',100),
 ('3D-RESIN','3D_ARTPRINT','3D-печать','Фотополимерная 3D-печать','Высокодетализированная печать фотополимером','заказ',0,0,'Расчёт после анализа модели',110),
 ('3D-MODELING','3D_ARTPRINT','3D-моделирование','Разработка 3D-модели','Моделирование изделия по чертежу, фото или образцу','час',0,0,'Оценка после получения технического задания',120),
 ('3D-SCAN','3D_ARTPRINT','3D-сканирование','3D-сканирование','Оцифровка физического объекта для дальнейшей работы','заказ',0,0,'Расчёт зависит от размеров и сложности',130),
 ('3D-CUSTOM','3D_ARTPRINT','Индивидуальные изделия','Изделие под заказ','Проектирование и изготовление индивидуального изделия','заказ',0,0,'Индивидуальный расчёт',140)
on conflict (code) do update set
  business_unit=excluded.business_unit, category=excluded.category, name=excluded.name,
  description=excluded.description, unit=excluded.unit, price_note=excluded.price_note, sort_order=excluded.sort_order;

-- Helper: partner identity for current auth session.
create or replace function public.current_partner_user_id()
returns uuid language sql stable security definer set search_path=public as $$
  select pu.id from public.partner_users pu
  join public.partners p on p.id=pu.partner_id
  where pu.auth_user_id=auth.uid() and pu.is_active=true and p.is_active=true
  limit 1
$$;

create or replace function public.current_partner_id()
returns uuid language sql stable security definer set search_path=public as $$
  select pu.partner_id from public.partner_users pu
  join public.partners p on p.id=pu.partner_id
  where pu.auth_user_id=auth.uid() and pu.is_active=true and p.is_active=true
  limit 1
$$;

-- Partner creates a real HUB order atomically. The order is immediately visible to managers.
create or replace function public.create_partner_order(
  p_service_id uuid,
  p_quantity numeric,
  p_customer_comment text default null,
  p_parameters jsonb default '{}'::jsonb,
  p_requested_total numeric default 0
) returns uuid
language plpgsql security definer set search_path=public as $$
declare
  v_partner_user public.partner_users%rowtype;
  v_partner public.partners%rowtype;
  v_service public.partner_services%rowtype;
  v_order_id uuid;
  v_price numeric(14,2);
  v_total numeric(14,2);
begin
  select * into v_partner_user from public.partner_users where auth_user_id=auth.uid() and is_active=true;
  if v_partner_user.id is null then raise exception 'PARTNER_ACCESS_REQUIRED'; end if;
  select * into v_partner from public.partners where id=v_partner_user.partner_id and is_active=true;
  if v_partner.id is null then raise exception 'PARTNER_DISABLED'; end if;
  select * into v_service from public.partner_services where id=p_service_id and is_active=true;
  if v_service.id is null then raise exception 'SERVICE_NOT_AVAILABLE'; end if;
  if coalesce(p_quantity,0)<=0 then raise exception 'INVALID_QUANTITY'; end if;

  select ppo.price into v_price from public.partner_price_overrides ppo
  where ppo.partner_id=v_partner.id and ppo.partner_service_id=v_service.id;
  v_price := coalesce(v_price, nullif(v_service.partner_price,0), nullif(v_service.base_price,0), 0);
  v_total := case when coalesce(p_requested_total,0)>0 then p_requested_total else v_price*p_quantity end;

  insert into public.orders(business_unit,status,total,customer_comment,internal_comment,source,model_name,partner_id,partner_user_id)
  values(v_service.business_unit,'NEW',v_total,p_customer_comment,
    'Партнёрский заказ: '||v_partner.name,'PARTNER',v_service.name,v_partner.id,v_partner_user.id)
  returning id into v_order_id;

  insert into public.order_items(order_id,name,quantity,unit_price,total_price,parameters)
  values(v_order_id,v_service.name,p_quantity,v_price,v_total,
    coalesce(p_parameters,'{}'::jsonb)||jsonb_build_object('partner_service_id',v_service.id,'partner_service_code',v_service.code,'category',v_service.category));
  return v_order_id;
end;
$$;
grant execute on function public.create_partner_order(uuid,numeric,text,jsonb,numeric) to authenticated;

-- RLS: external partner sees only its own company/order data; staff keep HUB access.
alter table public.partners enable row level security;
alter table public.partner_users enable row level security;
alter table public.partner_services enable row level security;
alter table public.partner_price_overrides enable row level security;
alter table public.partner_order_messages enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_files enable row level security;

drop policy if exists partners_staff_all on public.partners;
create policy partners_staff_all on public.partners for all to authenticated
using (public.has_role('ADMIN') or public.has_role('MANAGER'))
with check (public.has_role('ADMIN') or public.has_role('MANAGER'));
drop policy if exists partners_self_read on public.partners;
create policy partners_self_read on public.partners for select to authenticated using (id=public.current_partner_id());

drop policy if exists partner_users_staff_all on public.partner_users;
create policy partner_users_staff_all on public.partner_users for all to authenticated
using (public.has_role('ADMIN') or public.has_role('MANAGER'))
with check (public.has_role('ADMIN') or public.has_role('MANAGER'));
drop policy if exists partner_users_self_read on public.partner_users;
create policy partner_users_self_read on public.partner_users for select to authenticated using (auth_user_id=auth.uid());

drop policy if exists partner_services_staff_all on public.partner_services;
create policy partner_services_staff_all on public.partner_services for all to authenticated
using (public.has_role('ADMIN') or public.has_role('MANAGER'))
with check (public.has_role('ADMIN') or public.has_role('MANAGER'));
drop policy if exists partner_services_partner_read on public.partner_services;
create policy partner_services_partner_read on public.partner_services for select to authenticated
using (is_active=true and public.current_partner_id() is not null);

drop policy if exists partner_prices_staff_all on public.partner_price_overrides;
create policy partner_prices_staff_all on public.partner_price_overrides for all to authenticated
using (public.has_role('ADMIN') or public.has_role('MANAGER'))
with check (public.has_role('ADMIN') or public.has_role('MANAGER'));
drop policy if exists partner_prices_self_read on public.partner_price_overrides;
create policy partner_prices_self_read on public.partner_price_overrides for select to authenticated using (partner_id=public.current_partner_id());

-- Employees: all HUB orders. Partners: only their own orders.
drop policy if exists orders_hub_staff_read on public.orders;
create policy orders_hub_staff_read on public.orders for select to authenticated
using (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE') or public.has_role('PRODUCTION') or public.has_role('VIEWER'));
drop policy if exists orders_hub_staff_write on public.orders;
create policy orders_hub_staff_write on public.orders for all to authenticated
using (public.has_role('ADMIN') or public.has_role('MANAGER'))
with check (public.has_role('ADMIN') or public.has_role('MANAGER'));
drop policy if exists orders_partner_read on public.orders;
create policy orders_partner_read on public.orders for select to authenticated using (partner_id=public.current_partner_id());

drop policy if exists order_items_staff_read on public.order_items;
create policy order_items_staff_read on public.order_items for select to authenticated
using (exists(select 1 from public.orders o where o.id=order_id and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE') or public.has_role('PRODUCTION') or public.has_role('VIEWER'))));
drop policy if exists order_items_staff_write on public.order_items;
create policy order_items_staff_write on public.order_items for all to authenticated
using (public.has_role('ADMIN') or public.has_role('MANAGER')) with check (public.has_role('ADMIN') or public.has_role('MANAGER'));
drop policy if exists order_items_partner_read on public.order_items;
create policy order_items_partner_read on public.order_items for select to authenticated
using (exists(select 1 from public.orders o where o.id=order_id and o.partner_id=public.current_partner_id()));

drop policy if exists order_files_staff_read on public.order_files;
create policy order_files_staff_read on public.order_files for select to authenticated
using (exists(select 1 from public.orders o where o.id=order_id and (public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE') or public.has_role('PRODUCTION') or public.has_role('VIEWER'))));
drop policy if exists order_files_staff_write on public.order_files;
create policy order_files_staff_write on public.order_files for all to authenticated
using (public.has_role('ADMIN') or public.has_role('MANAGER')) with check (public.has_role('ADMIN') or public.has_role('MANAGER'));
drop policy if exists order_files_partner_read on public.order_files;
create policy order_files_partner_read on public.order_files for select to authenticated
using (exists(select 1 from public.orders o where o.id=order_id and o.partner_id=public.current_partner_id()));

-- Partner-facing order correspondence, separate from internal staff chat/comments.
drop policy if exists pom_staff_all on public.partner_order_messages;
create policy pom_staff_all on public.partner_order_messages for all to authenticated
using (public.has_role('ADMIN') or public.has_role('MANAGER'))
with check (public.has_role('ADMIN') or public.has_role('MANAGER'));
drop policy if exists pom_partner_read on public.partner_order_messages;
create policy pom_partner_read on public.partner_order_messages for select to authenticated
using (exists(select 1 from public.orders o where o.id=order_id and o.partner_id=public.current_partner_id()));
drop policy if exists pom_partner_insert on public.partner_order_messages;
create policy pom_partner_insert on public.partner_order_messages for insert to authenticated
with check (sender_type='PARTNER' and partner_user_id=public.current_partner_user_id() and exists(select 1 from public.orders o where o.id=order_id and o.partner_id=public.current_partner_id()));

-- Critical separation: partner auth accounts must not gain access to staff directory/internal chat.
drop policy if exists users_read_active_staff on public.users;
create policy users_read_active_staff on public.users for select to authenticated
using (exists(select 1 from public.user_roles ur where ur.user_id in (select u2.id from public.users u2 where u2.auth_user_id=auth.uid())));

drop policy if exists chat_rooms_read_staff on public.chat_rooms;
create policy chat_rooms_read_staff on public.chat_rooms for select to authenticated
using (exists(select 1 from public.users u join public.user_roles ur on ur.user_id=u.id where u.auth_user_id=auth.uid() and u.is_active=true));
drop policy if exists chat_members_read_staff on public.chat_members;
create policy chat_members_read_staff on public.chat_members for select to authenticated
using (exists(select 1 from public.users u join public.user_roles ur on ur.user_id=u.id where u.auth_user_id=auth.uid() and u.is_active=true));
drop policy if exists messages_read_staff on public.messages;
create policy messages_read_staff on public.messages for select to authenticated
using (exists(select 1 from public.users u join public.user_roles ur on ur.user_id=u.id where u.auth_user_id=auth.uid() and u.is_active=true));
drop policy if exists messages_insert_self on public.messages;
create policy messages_insert_self on public.messages for insert to authenticated
with check (sender_id in (select u.id from public.users u join public.user_roles ur on ur.user_id=u.id where u.auth_user_id=auth.uid() and u.is_active=true));
