-- Production Farm Phase 19: insurance, improvements and expiry control.

create table if not exists public.equipment_insurance_policies (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment_assets(id) on delete cascade,
  insurer text not null,
  policy_number text not null,
  coverage_amount numeric(14,2) check(coverage_amount is null or coverage_amount>=0),
  premium_amount numeric(14,2) check(premium_amount is null or premium_amount>=0),
  valid_from date not null,
  valid_until date not null,
  status text not null default 'ACTIVE' check(status in ('DRAFT','ACTIVE','EXPIRED','CANCELLED','CLAIM')),
  document_id uuid references public.documents(id) on delete set null,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique(equipment_id,policy_number),
  check(valid_until>=valid_from)
);

create index if not exists equipment_insurance_equipment_idx
  on public.equipment_insurance_policies(equipment_id,valid_until desc);
create index if not exists equipment_insurance_expiry_idx
  on public.equipment_insurance_policies(valid_until,status)
  where status='ACTIVE';

create table if not exists public.equipment_improvements (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment_assets(id) on delete cascade,
  improvement_type text not null default 'UPGRADE' check(improvement_type in ('UPGRADE','REPAIR_UPGRADE','SAFETY','SOFTWARE','ACCESSORY','OTHER')),
  title text not null,
  description text,
  cost numeric(14,2) not null default 0 check(cost>=0),
  estimated_value_increase numeric(14,2) not null default 0 check(estimated_value_increase>=0),
  life_extension_months integer not null default 0 check(life_extension_months>=0),
  completed_on date not null default current_date,
  responsible_user_id uuid references public.users(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  notes text,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create index if not exists equipment_improvements_equipment_idx
  on public.equipment_improvements(equipment_id,completed_on desc);

create or replace function public.touch_equipment_risk_updated_at()
returns trigger
language plpgsql
set search_path=''
as $$
begin
  new.updated_at=clock_timestamp();
  return new;
end
$$;

drop trigger if exists trg_equipment_insurance_updated_at on public.equipment_insurance_policies;
create trigger trg_equipment_insurance_updated_at
before update on public.equipment_insurance_policies
for each row execute function public.touch_equipment_risk_updated_at();

drop trigger if exists trg_equipment_improvements_updated_at on public.equipment_improvements;
create trigger trg_equipment_improvements_updated_at
before update on public.equipment_improvements
for each row execute function public.touch_equipment_risk_updated_at();

alter table public.equipment_insurance_policies enable row level security;
alter table public.equipment_improvements enable row level security;

drop policy if exists equipment_insurance_staff_read on public.equipment_insurance_policies;
create policy equipment_insurance_staff_read on public.equipment_insurance_policies
for select to authenticated using(public.has_permission('equipment.view'));

drop policy if exists equipment_insurance_manage on public.equipment_insurance_policies;
create policy equipment_insurance_manage on public.equipment_insurance_policies
for all to authenticated
using(public.has_permission('equipment.manage'))
with check(public.has_permission('equipment.manage'));

drop policy if exists equipment_improvements_staff_read on public.equipment_improvements;
create policy equipment_improvements_staff_read on public.equipment_improvements
for select to authenticated using(public.has_permission('equipment.view'));

drop policy if exists equipment_improvements_manage on public.equipment_improvements;
create policy equipment_improvements_manage on public.equipment_improvements
for all to authenticated
using(public.has_permission('equipment.manage'))
with check(public.has_permission('equipment.manage'));

grant select,insert,update,delete on public.equipment_insurance_policies,public.equipment_improvements to authenticated;

create or replace view public.equipment_risk_overview
with (security_invoker=true)
as
with insurance as (
  select
    p.equipment_id,
    count(*) filter (where p.status='ACTIVE')::bigint as active_policy_count,
    max(p.valid_until) filter (where p.status='ACTIVE') as insured_until,
    coalesce(sum(p.coverage_amount) filter (where p.status='ACTIVE'),0)::numeric as active_coverage_amount,
    coalesce(sum(p.premium_amount) filter (where p.status='ACTIVE'),0)::numeric as active_premium_amount,
    count(*) filter (where p.status='ACTIVE' and p.valid_until between current_date and current_date+30)::bigint as policies_expiring_30d,
    count(*) filter (where p.status='ACTIVE' and p.valid_until<current_date)::bigint as overdue_active_policies
  from public.equipment_insurance_policies p
  group by p.equipment_id
), improvements as (
  select
    i.equipment_id,
    count(*)::bigint as improvement_count,
    coalesce(sum(i.cost),0)::numeric as improvement_cost_total,
    coalesce(sum(i.estimated_value_increase),0)::numeric as estimated_value_increase_total,
    coalesce(sum(i.life_extension_months),0)::bigint as life_extension_months_total,
    max(i.completed_on) as last_improvement_on
  from public.equipment_improvements i
  group by i.equipment_id
)
select
  a.id as equipment_id,
  a.inventory_number,
  a.name as equipment_name,
  a.status as equipment_status,
  a.operational_status,
  a.ownership_type,
  a.current_owner_partner_id,
  a.market_value,
  a.analogue_purchase_price,
  coalesce(ins.active_policy_count,0)::bigint as active_policy_count,
  ins.insured_until,
  coalesce(ins.active_coverage_amount,0)::numeric as active_coverage_amount,
  coalesce(ins.active_premium_amount,0)::numeric as active_premium_amount,
  coalesce(ins.policies_expiring_30d,0)::bigint as policies_expiring_30d,
  coalesce(ins.overdue_active_policies,0)::bigint as overdue_active_policies,
  coalesce(imp.improvement_count,0)::bigint as improvement_count,
  coalesce(imp.improvement_cost_total,0)::numeric as improvement_cost_total,
  coalesce(imp.estimated_value_increase_total,0)::numeric as estimated_value_increase_total,
  coalesce(imp.life_extension_months_total,0)::bigint as life_extension_months_total,
  imp.last_improvement_on,
  case
    when coalesce(ins.overdue_active_policies,0)>0 then 'POLICY_EXPIRED'
    when coalesce(ins.policies_expiring_30d,0)>0 then 'POLICY_EXPIRING'
    when coalesce(ins.active_policy_count,0)>0 then 'INSURED'
    else 'NO_ACTIVE_POLICY'
  end as insurance_state
from public.equipment_assets a
left join insurance ins on ins.equipment_id=a.id
left join improvements imp on imp.equipment_id=a.id;

revoke all on public.equipment_risk_overview from public,anon;
grant select on public.equipment_risk_overview to authenticated,service_role;

create table if not exists public.equipment_insurance_notice_events (
  id uuid primary key default gen_random_uuid(),
  policy_id uuid not null references public.equipment_insurance_policies(id) on delete cascade,
  valid_until date not null,
  notice_kind text not null check(notice_kind in ('DUE_30','DUE_7','EXPIRED')),
  created_at timestamptz not null default clock_timestamp(),
  unique(policy_id,valid_until,notice_kind)
);

alter table public.equipment_insurance_notice_events enable row level security;
revoke all on public.equipment_insurance_notice_events from public,anon,authenticated;
grant select on public.equipment_insurance_notice_events to service_role;

create or replace function public.emit_equipment_insurance_notifications()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare
  r record;
  v_kind text;
  v_inserted integer:=0;
  v_event_id uuid;
begin
  for r in
    select p.id,p.equipment_id,p.policy_number,p.insurer,p.valid_until,a.inventory_number,a.name
    from public.equipment_insurance_policies p
    join public.equipment_assets a on a.id=p.equipment_id
    where p.status='ACTIVE'
      and p.valid_until<=current_date+30
  loop
    v_kind:=case
      when r.valid_until<current_date then 'EXPIRED'
      when r.valid_until<=current_date+7 then 'DUE_7'
      else 'DUE_30'
    end;

    insert into public.equipment_insurance_notice_events(policy_id,valid_until,notice_kind)
    values(r.id,r.valid_until,v_kind)
    on conflict do nothing
    returning id into v_event_id;

    if v_event_id is not null then
      insert into public.notifications(user_id,title,body,type,entity_type,entity_id,is_read,created_at)
      select distinct u.id,
        case v_kind when 'EXPIRED' then 'Страховка оборудования истекла' else 'Заканчивается страховка оборудования' end,
        r.inventory_number||' · '||r.name||'. Полис '||r.policy_number||' ('||r.insurer||'), действует до '||to_char(r.valid_until,'DD.MM.YYYY'),
        'EQUIPMENT_INSURANCE',
        'EQUIPMENT_INSURANCE_POLICY',
        r.id,
        false,
        clock_timestamp()
      from public.users u
      join public.user_roles ur on ur.user_id=u.id
      join public.roles ro on ro.id=ur.role_id
      left join public.role_permissions rp on rp.role_id=ro.id
      left join public.permissions pe on pe.id=rp.permission_id
      where u.is_active=true
        and (ro.name='ADMIN' or pe.code='equipment.manage');
      v_inserted:=v_inserted+1;
    end if;
  end loop;
  return v_inserted;
end
$$;

revoke all on function public.emit_equipment_insurance_notifications() from public,anon,authenticated;
grant execute on function public.emit_equipment_insurance_notifications() to service_role;

-- Keep ACTIVE policies honest after their validity date passes.
create or replace function public.expire_equipment_insurance_policies()
returns integer
language plpgsql
security definer
set search_path=''
as $$
declare v_count integer;
begin
  update public.equipment_insurance_policies
     set status='EXPIRED',updated_at=clock_timestamp()
   where status='ACTIVE' and valid_until<current_date;
  get diagnostics v_count=row_count;
  return v_count;
end
$$;
revoke all on function public.expire_equipment_insurance_policies() from public,anon,authenticated;
grant execute on function public.expire_equipment_insurance_policies() to service_role;

-- Daily server-side maintenance if pg_cron is available (it is already used by the production farm).
do $$
declare jid bigint;
begin
  if exists(select 1 from pg_namespace where nspname='cron') then
    for jid in select jobid from cron.job where jobname='equipment-insurance-daily' loop
      perform cron.unschedule(jid);
    end loop;
    perform cron.schedule(
      'equipment-insurance-daily',
      '15 6 * * *',
      'select public.expire_equipment_insurance_policies(); select public.emit_equipment_insurance_notifications();'
    );
  end if;
end
$$;
