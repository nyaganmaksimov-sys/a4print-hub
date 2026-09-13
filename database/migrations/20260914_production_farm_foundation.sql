-- A4PRINT HUB: production farm foundation.
-- Phase 1: permissions, equipment ownership, owner partners, contracts and audit trail.
-- This migration is additive and keeps the existing equipment/production/partner models intact.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Fine-grained permissions layered on top of the existing roles model.
-- Existing role checks remain valid for backward compatibility.
-- ---------------------------------------------------------------------------
create table if not exists public.permissions (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  description text,
  created_at timestamptz not null default now()
);

create table if not exists public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_id uuid not null references public.permissions(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (role_id, permission_id)
);

insert into public.permissions(code,description) values
  ('production.view','Просмотр производства'),
  ('production.manage','Управление производственными заданиями'),
  ('equipment.view','Просмотр оборудования'),
  ('equipment.manage','Управление оборудованием и сервисом'),
  ('equipment.ownership.manage','Управление собственностью оборудования'),
  ('equipment.contracts.manage','Управление договорами владельцев оборудования'),
  ('production.settlements.view','Просмотр расчётов с владельцами оборудования'),
  ('production.settlements.manage','Закрытие периодов и выплаты владельцам оборудования'),
  ('production.analytics.view','Просмотр производственной аналитики'),
  ('production.buyout.manage','Управление арендой с последующим выкупом'),
  ('audit.view','Просмотр журнала аудита')
on conflict (code) do update set description=excluded.description;

insert into public.role_permissions(role_id,permission_id)
select r.id,p.id
from public.roles r
cross join public.permissions p
where
  r.name='ADMIN'
  or (r.name='MANAGER' and p.code in (
    'production.view','production.manage','equipment.view','equipment.manage',
    'equipment.ownership.manage','equipment.contracts.manage',
    'production.settlements.view','production.settlements.manage',
    'production.analytics.view','production.buyout.manage','audit.view'
  ))
  or (r.name='PRODUCTION' and p.code in ('production.view','production.manage','equipment.view'))
  or (r.name='WAREHOUSE' and p.code in ('equipment.view','equipment.manage'))
  or (r.name='VIEWER' and p.code in ('production.view','equipment.view','production.analytics.view'))
on conflict do nothing;

create or replace function public.current_staff_user_id()
returns uuid
language sql
stable
security definer
set search_path=public
as $$
  select u.id
  from public.users u
  where u.auth_user_id=auth.uid() and u.is_active=true
  limit 1
$$;

create or replace function public.has_permission(required_permission text)
returns boolean
language sql
stable
security definer
set search_path=public
as $$
  select exists (
    select 1
    from public.users u
    join public.user_roles ur on ur.user_id=u.id
    join public.roles r on r.id=ur.role_id
    left join public.role_permissions rp on rp.role_id=r.id
    left join public.permissions p on p.id=rp.permission_id
    where u.auth_user_id=auth.uid()
      and u.is_active=true
      and (r.name='ADMIN' or p.code=required_permission)
  )
$$;

create or replace function public.get_my_permissions()
returns text[]
language sql
stable
security definer
set search_path=public
as $$
  select case
    when public.has_role('ADMIN') then coalesce((select array_agg(p.code order by p.code) from public.permissions p),'{}'::text[])
    else coalesce((
      select array_agg(distinct p.code order by p.code)
      from public.users u
      join public.user_roles ur on ur.user_id=u.id
      join public.role_permissions rp on rp.role_id=ur.role_id
      join public.permissions p on p.id=rp.permission_id
      where u.auth_user_id=auth.uid() and u.is_active=true
    ),'{}'::text[])
  end
$$;

revoke all on function public.current_staff_user_id() from public;
revoke all on function public.has_permission(text) from public;
revoke all on function public.get_my_permissions() from public;
grant execute on function public.current_staff_user_id() to authenticated;
grant execute on function public.has_permission(text) to authenticated;
grant execute on function public.get_my_permissions() to authenticated;

alter table public.permissions enable row level security;
alter table public.role_permissions enable row level security;
drop policy if exists permissions_staff_read on public.permissions;
create policy permissions_staff_read on public.permissions for select to authenticated using(public.is_hub_staff());
drop policy if exists role_permissions_staff_read on public.role_permissions;
create policy role_permissions_staff_read on public.role_permissions for select to authenticated using(public.is_hub_staff());
grant select on public.permissions,public.role_permissions to authenticated;

-- ---------------------------------------------------------------------------
-- Partner capabilities: one counterparty may simultaneously be supplier,
-- production contractor and equipment owner.
-- ---------------------------------------------------------------------------
alter table public.partners add column if not exists legal_form text;
alter table public.partners add column if not exists registration_number text;
alter table public.partners add column if not exists bank_details jsonb not null default '{}'::jsonb;

create table if not exists public.partner_roles (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete cascade,
  role_code text not null,
  created_at timestamptz not null default now(),
  unique(partner_id,role_code)
);
create index if not exists partner_roles_role_idx on public.partner_roles(role_code,partner_id);

alter table public.partner_roles enable row level security;
drop policy if exists partner_roles_staff_read on public.partner_roles;
create policy partner_roles_staff_read on public.partner_roles for select to authenticated using(public.is_hub_staff());
drop policy if exists partner_roles_partner_read on public.partner_roles;
create policy partner_roles_partner_read on public.partner_roles for select to authenticated using(partner_id=public.current_partner_id());
drop policy if exists partner_roles_manage on public.partner_roles;
create policy partner_roles_manage on public.partner_roles for all to authenticated
using(public.has_permission('equipment.ownership.manage'))
with check(public.has_permission('equipment.ownership.manage'));
grant select,insert,update,delete on public.partner_roles to authenticated;

-- ---------------------------------------------------------------------------
-- Equipment ownership and production-economic parameters.
-- Existing status remains the lifecycle/inventory status. operational_status is
-- the live state of the machine used by the production farm.
-- ---------------------------------------------------------------------------
alter table public.equipment_assets
  add column if not exists ownership_type text not null default 'HUB'
    check(ownership_type in ('HUB','PARTNER','LEASE','LEASE_BUYOUT','OTHER')),
  add column if not exists current_owner_partner_id uuid references public.partners(id) on delete set null,
  add column if not exists operational_status text not null default 'FREE'
    check(operational_status in ('FREE','WORKING','QUEUED','MAINTENANCE','REPAIR','FAULT','WAITING_PARTS','OFFLINE','RETIRED')),
  add column if not exists manufacture_year integer check(manufacture_year is null or manufacture_year between 1900 and 2200),
  add column if not exists market_value numeric(14,2) check(market_value is null or market_value>=0),
  add column if not exists received_at date,
  add column if not exists commissioned_at date,
  add column if not exists internal_hour_cost numeric(14,2) check(internal_hour_cost is null or internal_hour_cost>=0),
  add column if not exists production_hour_price numeric(14,2) check(production_hour_price is null or production_hour_price>=0),
  add column if not exists average_power_kw numeric(10,3) check(average_power_kw is null or average_power_kw>=0),
  add column if not exists max_power_kw numeric(10,3) check(max_power_kw is null or max_power_kw>=0),
  add column if not exists electricity_tariff numeric(12,4) check(electricity_tariff is null or electricity_tariff>=0),
  add column if not exists electricity_as_direct_cost boolean not null default true,
  add column if not exists analogue_purchase_price numeric(14,2) check(analogue_purchase_price is null or analogue_purchase_price>=0),
  add column if not exists buy_replacement_warning_percent numeric(6,2) not null default 80
    check(buy_replacement_warning_percent between 0 and 500);

create index if not exists equipment_assets_owner_idx on public.equipment_assets(current_owner_partner_id) where current_owner_partner_id is not null;
create index if not exists equipment_assets_operational_status_idx on public.equipment_assets(operational_status);
create index if not exists equipment_assets_ownership_type_idx on public.equipment_assets(ownership_type);

-- Ensure partner-backed ownership always has an owner and HUB ownership never does.
create or replace function public.validate_equipment_ownership()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  if new.ownership_type='HUB' then
    new.current_owner_partner_id:=null;
  elsif new.ownership_type in ('PARTNER','LEASE','LEASE_BUYOUT') and new.current_owner_partner_id is null then
    raise exception 'EQUIPMENT_OWNER_REQUIRED';
  end if;
  return new;
end
$$;
drop trigger if exists trg_validate_equipment_ownership on public.equipment_assets;
create trigger trg_validate_equipment_ownership
before insert or update of ownership_type,current_owner_partner_id on public.equipment_assets
for each row execute function public.validate_equipment_ownership();

-- ---------------------------------------------------------------------------
-- Owner contracts. Percentages are contract data, never hardcoded in UI/API.
-- ---------------------------------------------------------------------------
create table if not exists public.equipment_contracts (
  id uuid primary key default gen_random_uuid(),
  partner_id uuid not null references public.partners(id) on delete restrict,
  contract_number text not null,
  contract_type text not null default 'REVENUE_SHARE'
    check(contract_type in ('REVENUE_SHARE','LEASE','LEASE_BUYOUT','LOAN_FOR_USE','OTHER')),
  status text not null default 'DRAFT'
    check(status in ('DRAFT','ACTIVE','SUSPENDED','TERMINATED','COMPLETED')),
  starts_on date not null default current_date,
  ends_on date,
  hub_share_percent numeric(5,2) not null default 70 check(hub_share_percent between 0 and 100),
  owner_share_percent numeric(5,2) not null default 30 check(owner_share_percent between 0 and 100),
  calculation_basis text not null default 'RECEIVED_REVENUE'
    check(calculation_basis in ('RECEIVED_REVENUE','OPERATION_REVENUE','NET_AFTER_DIRECT_COSTS')),
  direct_costs_before_split boolean not null default false,
  settlement_frequency text not null default 'MONTHLY'
    check(settlement_frequency in ('MONTHLY','WEEKLY','ON_DEMAND','OTHER')),
  settlement_day integer check(settlement_day is null or settlement_day between 1 and 28),
  repair_responsibility text not null default 'BY_AGREEMENT'
    check(repair_responsibility in ('HUB','OWNER','SHARED','BY_AGREEMENT')),
  early_termination_notice_days integer not null default 30 check(early_termination_notice_days>=0),
  buyout_enabled boolean not null default false,
  buyout_price numeric(14,2) check(buyout_price is null or buyout_price>=0),
  currency text not null default 'RUB',
  terms jsonb not null default '{}'::jsonb,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(partner_id,contract_number),
  check(ends_on is null or ends_on>=starts_on),
  check(contract_type<>'REVENUE_SHARE' or abs((hub_share_percent+owner_share_percent)-100)<0.001),
  check(not buyout_enabled or buyout_price is not null)
);

create table if not exists public.equipment_contract_assets (
  id uuid primary key default gen_random_uuid(),
  contract_id uuid not null references public.equipment_contracts(id) on delete cascade,
  equipment_id uuid not null references public.equipment_assets(id) on delete cascade,
  starts_on date,
  ends_on date,
  allocation_weight numeric(10,4) not null default 1 check(allocation_weight>0),
  created_at timestamptz not null default now(),
  unique(contract_id,equipment_id),
  check(ends_on is null or starts_on is null or ends_on>=starts_on)
);
create index if not exists equipment_contracts_partner_status_idx on public.equipment_contracts(partner_id,status,starts_on desc);
create index if not exists equipment_contract_assets_equipment_idx on public.equipment_contract_assets(equipment_id,contract_id);

create or replace function public.touch_production_farm_updated_at()
returns trigger
language plpgsql
set search_path=public
as $$
begin
  new.updated_at=now();
  return new;
end
$$;
drop trigger if exists trg_equipment_contracts_updated_at on public.equipment_contracts;
create trigger trg_equipment_contracts_updated_at before update on public.equipment_contracts
for each row execute function public.touch_production_farm_updated_at();

alter table public.equipment_contracts enable row level security;
alter table public.equipment_contract_assets enable row level security;
drop policy if exists equipment_contracts_staff_read on public.equipment_contracts;
create policy equipment_contracts_staff_read on public.equipment_contracts for select to authenticated
using(public.has_permission('equipment.view'));
drop policy if exists equipment_contracts_partner_read on public.equipment_contracts;
create policy equipment_contracts_partner_read on public.equipment_contracts for select to authenticated
using(partner_id=public.current_partner_id());
drop policy if exists equipment_contracts_manage on public.equipment_contracts;
create policy equipment_contracts_manage on public.equipment_contracts for all to authenticated
using(public.has_permission('equipment.contracts.manage'))
with check(public.has_permission('equipment.contracts.manage'));

drop policy if exists equipment_contract_assets_staff_read on public.equipment_contract_assets;
create policy equipment_contract_assets_staff_read on public.equipment_contract_assets for select to authenticated
using(public.has_permission('equipment.view'));
drop policy if exists equipment_contract_assets_partner_read on public.equipment_contract_assets;
create policy equipment_contract_assets_partner_read on public.equipment_contract_assets for select to authenticated
using(exists(select 1 from public.equipment_contracts c where c.id=contract_id and c.partner_id=public.current_partner_id()));
drop policy if exists equipment_contract_assets_manage on public.equipment_contract_assets;
create policy equipment_contract_assets_manage on public.equipment_contract_assets for all to authenticated
using(public.has_permission('equipment.contracts.manage'))
with check(public.has_permission('equipment.contracts.manage'));

grant select,insert,update,delete on public.equipment_contracts,public.equipment_contract_assets to authenticated;

-- Automatically mark contract counterparties as equipment owners.
create or replace function public.ensure_equipment_owner_partner_role()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
begin
  insert into public.partner_roles(partner_id,role_code)
  values(new.partner_id,'EQUIPMENT_OWNER')
  on conflict(partner_id,role_code) do nothing;
  return new;
end
$$;
drop trigger if exists trg_equipment_contract_partner_role on public.equipment_contracts;
create trigger trg_equipment_contract_partner_role
after insert or update of partner_id on public.equipment_contracts
for each row execute function public.ensure_equipment_owner_partner_role();

-- ---------------------------------------------------------------------------
-- Ownership history. Changing owner on equipment always closes the previous
-- interval and opens a new one, preserving legal/economic traceability.
-- ---------------------------------------------------------------------------
create table if not exists public.equipment_ownership_history (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment_assets(id) on delete cascade,
  ownership_type text not null check(ownership_type in ('HUB','PARTNER','LEASE','LEASE_BUYOUT','OTHER')),
  partner_id uuid references public.partners(id) on delete set null,
  valid_from timestamptz not null default now(),
  valid_to timestamptz,
  source_contract_id uuid references public.equipment_contracts(id) on delete set null,
  reason text,
  changed_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check(valid_to is null or valid_to>=valid_from)
);
create index if not exists equipment_ownership_history_equipment_idx on public.equipment_ownership_history(equipment_id,valid_from desc);
create index if not exists equipment_ownership_history_partner_idx on public.equipment_ownership_history(partner_id,valid_from desc) where partner_id is not null;
create unique index if not exists equipment_ownership_one_current_idx on public.equipment_ownership_history(equipment_id) where valid_to is null;

alter table public.equipment_ownership_history enable row level security;
drop policy if exists equipment_ownership_staff_read on public.equipment_ownership_history;
create policy equipment_ownership_staff_read on public.equipment_ownership_history for select to authenticated using(public.has_permission('equipment.view'));
drop policy if exists equipment_ownership_partner_read on public.equipment_ownership_history;
create policy equipment_ownership_partner_read on public.equipment_ownership_history for select to authenticated using(partner_id=public.current_partner_id());
grant select on public.equipment_ownership_history to authenticated;

create or replace function public.sync_equipment_ownership_history()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_contract uuid;
  v_changed_by uuid;
begin
  if tg_op='UPDATE'
     and new.ownership_type is not distinct from old.ownership_type
     and new.current_owner_partner_id is not distinct from old.current_owner_partner_id then
    return new;
  end if;

  v_changed_by:=public.current_staff_user_id();

  select ca.contract_id into v_contract
  from public.equipment_contract_assets ca
  join public.equipment_contracts c on c.id=ca.contract_id
  where ca.equipment_id=new.id
    and c.partner_id is not distinct from new.current_owner_partner_id
    and c.status='ACTIVE'
    and c.starts_on<=current_date
    and (c.ends_on is null or c.ends_on>=current_date)
    and (ca.starts_on is null or ca.starts_on<=current_date)
    and (ca.ends_on is null or ca.ends_on>=current_date)
  order by c.starts_on desc,c.created_at desc
  limit 1;

  update public.equipment_ownership_history
     set valid_to=now()
   where equipment_id=new.id and valid_to is null;

  insert into public.equipment_ownership_history(
    equipment_id,ownership_type,partner_id,valid_from,source_contract_id,reason,changed_by
  ) values(
    new.id,new.ownership_type,new.current_owner_partner_id,now(),v_contract,
    case when tg_op='INSERT' then 'Первичная регистрация оборудования' else 'Изменение владельца/формы владения' end,
    v_changed_by
  );

  if new.current_owner_partner_id is not null then
    insert into public.partner_roles(partner_id,role_code)
    values(new.current_owner_partner_id,'EQUIPMENT_OWNER')
    on conflict(partner_id,role_code) do nothing;
  end if;

  return new;
end
$$;
drop trigger if exists trg_sync_equipment_ownership_history on public.equipment_assets;
create trigger trg_sync_equipment_ownership_history
after insert or update of ownership_type,current_owner_partner_id on public.equipment_assets
for each row execute function public.sync_equipment_ownership_history();

-- Existing equipment is HUB-owned until explicitly reclassified.
insert into public.equipment_ownership_history(equipment_id,ownership_type,partner_id,valid_from,reason,changed_by)
select a.id,a.ownership_type,a.current_owner_partner_id,coalesce(a.created_at,now()),'Миграция существующего оборудования',null
from public.equipment_assets a
where not exists(select 1 from public.equipment_ownership_history h where h.equipment_id=a.id and h.valid_to is null)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Immutable audit journal for ownership-critical objects.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id bigint generated always as identity primary key,
  actor_user_id uuid references public.users(id) on delete set null,
  actor_auth_user_id uuid,
  action text not null,
  entity_type text not null,
  entity_id uuid,
  old_data jsonb,
  new_data jsonb,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists audit_log_entity_idx on public.audit_log(entity_type,entity_id,created_at desc);
create index if not exists audit_log_actor_idx on public.audit_log(actor_user_id,created_at desc) where actor_user_id is not null;
create index if not exists audit_log_created_idx on public.audit_log(created_at desc);

alter table public.audit_log enable row level security;
drop policy if exists audit_log_read on public.audit_log;
create policy audit_log_read on public.audit_log for select to authenticated using(public.has_permission('audit.view'));
grant select on public.audit_log to authenticated;

create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path=public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_entity_id uuid;
begin
  if tg_op in ('UPDATE','DELETE') then v_old:=to_jsonb(old); end if;
  if tg_op in ('INSERT','UPDATE') then v_new:=to_jsonb(new); end if;

  begin
    v_entity_id:=coalesce(nullif(v_new->>'id',''),nullif(v_old->>'id',''))::uuid;
  exception when invalid_text_representation then
    v_entity_id:=null;
  end;

  insert into public.audit_log(
    actor_user_id,actor_auth_user_id,action,entity_type,entity_id,old_data,new_data
  ) values(
    public.current_staff_user_id(),auth.uid(),tg_op,tg_table_name,v_entity_id,v_old,v_new
  );

  if tg_op='DELETE' then return old; end if;
  return new;
end
$$;

-- Keep audit triggers after business triggers so the journal sees the final row.
drop trigger if exists trg_audit_equipment_assets on public.equipment_assets;
create trigger trg_audit_equipment_assets after insert or update or delete on public.equipment_assets
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_equipment_contracts on public.equipment_contracts;
create trigger trg_audit_equipment_contracts after insert or update or delete on public.equipment_contracts
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_equipment_contract_assets on public.equipment_contract_assets;
create trigger trg_audit_equipment_contract_assets after insert or update or delete on public.equipment_contract_assets
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_equipment_ownership_history on public.equipment_ownership_history;
create trigger trg_audit_equipment_ownership_history after insert or update or delete on public.equipment_ownership_history
for each row execute function public.audit_row_change();
drop trigger if exists trg_audit_partner_roles on public.partner_roles;
create trigger trg_audit_partner_roles after insert or update or delete on public.partner_roles
for each row execute function public.audit_row_change();

-- Existing universal document system is reused for equipment and contracts.
-- These values are conventions for document_links.entity_type:
--   EQUIPMENT, EQUIPMENT_CONTRACT
create index if not exists document_links_entity_idx on public.document_links(entity_type,entity_id);
