-- A4PRINT HUB: equipment inventory, consumables, stock ledger and service history.
create sequence if not exists public.equipment_inventory_number_seq start 1;

create or replace function public.next_equipment_inventory_number()
returns text language sql security definer set search_path=public
as $$ select 'A4-EQ-' || lpad(nextval('public.equipment_inventory_number_seq')::text,5,'0') $$;
revoke all on function public.next_equipment_inventory_number() from public;
grant execute on function public.next_equipment_inventory_number() to authenticated;

create table if not exists public.equipment_assets (
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete set null,
  inventory_number text not null unique default public.next_equipment_inventory_number(), name text not null, category text, brand text, model text,
  serial_number text, location text, responsible_user_id uuid references public.users(id) on delete set null,
  status text not null default 'ACTIVE' check(status in('ACTIVE','REPAIR','RESERVE','STORAGE','WRITTEN_OFF')),
  purchase_date date, purchase_price numeric(14,2) check(purchase_price is null or purchase_price>=0), warranty_until date,
  service_interval_days integer check(service_interval_days is null or service_interval_days>0), last_service_date date, next_service_date date,
  notes text, created_by uuid references public.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists equipment_assets_status_idx on public.equipment_assets(status);
create index if not exists equipment_assets_org_idx on public.equipment_assets(organization_id);
create index if not exists equipment_assets_responsible_idx on public.equipment_assets(responsible_user_id);
create index if not exists equipment_assets_serial_idx on public.equipment_assets(serial_number) where serial_number is not null and btrim(serial_number)<>'';

create table if not exists public.equipment_consumables (
  id uuid primary key default gen_random_uuid(), organization_id uuid references public.organizations(id) on delete set null,
  name text not null, category text, sku text, unit text not null default 'шт', min_stock numeric(14,3) not null default 0 check(min_stock>=0),
  supplier text, storage_location text, notes text, is_active boolean not null default true,
  created_by uuid references public.users(id) on delete set null, created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create index if not exists equipment_consumables_org_idx on public.equipment_consumables(organization_id);
create index if not exists equipment_consumables_active_idx on public.equipment_consumables(is_active);
create unique index if not exists equipment_consumables_sku_unique on public.equipment_consumables(lower(sku)) where sku is not null and btrim(sku)<>'';

create table if not exists public.equipment_consumable_links (
  equipment_id uuid not null references public.equipment_assets(id) on delete cascade,
  consumable_id uuid not null references public.equipment_consumables(id) on delete cascade,
  note text, created_by uuid references public.users(id) on delete set null, created_at timestamptz not null default now(),
  primary key(equipment_id,consumable_id)
);

create table if not exists public.equipment_consumable_movements (
  id uuid primary key default gen_random_uuid(), consumable_id uuid not null references public.equipment_consumables(id) on delete restrict,
  equipment_id uuid references public.equipment_assets(id) on delete set null,
  movement_type text not null check(movement_type in('RECEIPT','ISSUE','RETURN','WRITE_OFF','ADJUSTMENT')),
  quantity_delta numeric(14,3) not null check(quantity_delta<>0), note text, document_ref text,
  created_by uuid references public.users(id) on delete set null, created_at timestamptz not null default now(),
  constraint equipment_consumable_movement_sign_check check(
    (movement_type='RECEIPT' and quantity_delta>0) or (movement_type='RETURN' and quantity_delta>0) or
    (movement_type='ISSUE' and quantity_delta<0) or (movement_type='WRITE_OFF' and quantity_delta<0) or movement_type='ADJUSTMENT')
);
create index if not exists equipment_consumable_movements_consumable_idx on public.equipment_consumable_movements(consumable_id,created_at desc);
create index if not exists equipment_consumable_movements_equipment_idx on public.equipment_consumable_movements(equipment_id,created_at desc) where equipment_id is not null;

create table if not exists public.equipment_service_log (
  id uuid primary key default gen_random_uuid(), equipment_id uuid not null references public.equipment_assets(id) on delete cascade,
  service_type text not null default 'MAINTENANCE' check(service_type in('MAINTENANCE','REPAIR','INSPECTION','CALIBRATION','CLEANING','OTHER')),
  serviced_at date not null default current_date, description text not null, cost numeric(14,2) check(cost is null or cost>=0), next_due_date date,
  provider text, created_by uuid references public.users(id) on delete set null, created_at timestamptz not null default now()
);
create index if not exists equipment_service_log_equipment_idx on public.equipment_service_log(equipment_id,serviced_at desc);

create or replace function public.touch_equipment_updated_at() returns trigger language plpgsql set search_path=public as $$
begin new.updated_at=now(); return new; end $$;
drop trigger if exists trg_equipment_assets_updated_at on public.equipment_assets;
create trigger trg_equipment_assets_updated_at before update on public.equipment_assets for each row execute function public.touch_equipment_updated_at();
drop trigger if exists trg_equipment_consumables_updated_at on public.equipment_consumables;
create trigger trg_equipment_consumables_updated_at before update on public.equipment_consumables for each row execute function public.touch_equipment_updated_at();

create or replace view public.equipment_consumable_balances with(security_invoker=true) as
select c.id consumable_id,c.organization_id,c.name,c.category,c.sku,c.unit,c.min_stock,c.storage_location,c.is_active,
       coalesce(sum(m.quantity_delta),0)::numeric(14,3) current_stock,
       coalesce(sum(m.quantity_delta),0)<=c.min_stock low_stock
from public.equipment_consumables c left join public.equipment_consumable_movements m on m.consumable_id=c.id
group by c.id,c.organization_id,c.name,c.category,c.sku,c.unit,c.min_stock,c.storage_location,c.is_active;

create or replace function public.check_equipment_consumable_stock() returns trigger language plpgsql set search_path=public as $$
declare v_balance numeric;
begin
  perform pg_advisory_xact_lock(hashtext(new.consumable_id::text));
  select coalesce(sum(quantity_delta),0) into v_balance from public.equipment_consumable_movements where consumable_id=new.consumable_id;
  if v_balance+new.quantity_delta<0 then raise exception 'INSUFFICIENT_CONSUMABLE_STOCK: available %, requested delta %',v_balance,new.quantity_delta; end if;
  return new;
end $$;
drop trigger if exists trg_check_equipment_consumable_stock on public.equipment_consumable_movements;
create trigger trg_check_equipment_consumable_stock before insert on public.equipment_consumable_movements for each row execute function public.check_equipment_consumable_stock();

alter table public.equipment_assets enable row level security;
alter table public.equipment_consumables enable row level security;
alter table public.equipment_consumable_links enable row level security;
alter table public.equipment_consumable_movements enable row level security;
alter table public.equipment_service_log enable row level security;

drop policy if exists equipment_assets_staff_read on public.equipment_assets;
create policy equipment_assets_staff_read on public.equipment_assets for select to authenticated using(public.is_hub_staff());
drop policy if exists equipment_assets_manage on public.equipment_assets;
create policy equipment_assets_manage on public.equipment_assets for all to authenticated using(public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE')) with check(public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'));
drop policy if exists equipment_consumables_staff_read on public.equipment_consumables;
create policy equipment_consumables_staff_read on public.equipment_consumables for select to authenticated using(public.is_hub_staff());
drop policy if exists equipment_consumables_manage on public.equipment_consumables;
create policy equipment_consumables_manage on public.equipment_consumables for all to authenticated using(public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE')) with check(public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'));
drop policy if exists equipment_links_staff_read on public.equipment_consumable_links;
create policy equipment_links_staff_read on public.equipment_consumable_links for select to authenticated using(public.is_hub_staff());
drop policy if exists equipment_links_manage on public.equipment_consumable_links;
create policy equipment_links_manage on public.equipment_consumable_links for all to authenticated using(public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE')) with check(public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'));
drop policy if exists equipment_movements_staff_read on public.equipment_consumable_movements;
create policy equipment_movements_staff_read on public.equipment_consumable_movements for select to authenticated using(public.is_hub_staff());
drop policy if exists equipment_movements_insert on public.equipment_consumable_movements;
create policy equipment_movements_insert on public.equipment_consumable_movements for insert to authenticated with check(public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE') or public.has_role('PRODUCTION'));
drop policy if exists equipment_service_staff_read on public.equipment_service_log;
create policy equipment_service_staff_read on public.equipment_service_log for select to authenticated using(public.is_hub_staff());
drop policy if exists equipment_service_manage on public.equipment_service_log;
create policy equipment_service_manage on public.equipment_service_log for all to authenticated using(public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE')) with check(public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'));

grant select,insert,update,delete on public.equipment_assets to authenticated;
grant select,insert,update,delete on public.equipment_consumables to authenticated;
grant select,insert,update,delete on public.equipment_consumable_links to authenticated;
grant select,insert on public.equipment_consumable_movements to authenticated;
grant select,insert,update,delete on public.equipment_service_log to authenticated;
grant select on public.equipment_consumable_balances to authenticated;
grant usage,select on sequence public.equipment_inventory_number_seq to authenticated;
