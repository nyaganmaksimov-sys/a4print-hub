-- A4PRINT HUB: recurring maintenance calendar for printers and other equipment.
create table if not exists public.equipment_maintenance_plans (
  id uuid primary key default gen_random_uuid(),
  equipment_id uuid not null references public.equipment_assets(id) on delete cascade,
  title text not null,
  service_type text not null default 'CLEANING' check(service_type in('MAINTENANCE','REPAIR','INSPECTION','CALIBRATION','CLEANING','OTHER')),
  interval_days integer not null check(interval_days between 1 and 3650),
  next_due_date date not null,
  remind_before_days integer not null default 2 check(remind_before_days between 0 and 365),
  instructions text,
  is_active boolean not null default true,
  last_completed_at date,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists equipment_maintenance_plans_equipment_idx on public.equipment_maintenance_plans(equipment_id,next_due_date);
create index if not exists equipment_maintenance_plans_due_idx on public.equipment_maintenance_plans(next_due_date) where is_active;

alter table public.equipment_service_log add column if not exists maintenance_plan_id uuid references public.equipment_maintenance_plans(id) on delete set null;
create index if not exists equipment_service_log_plan_idx on public.equipment_service_log(maintenance_plan_id,serviced_at desc) where maintenance_plan_id is not null;

alter table public.equipment_maintenance_plans enable row level security;
drop policy if exists equipment_maintenance_plans_staff_read on public.equipment_maintenance_plans;
create policy equipment_maintenance_plans_staff_read on public.equipment_maintenance_plans for select to authenticated using(public.is_hub_staff());
drop policy if exists equipment_maintenance_plans_manage on public.equipment_maintenance_plans;
create policy equipment_maintenance_plans_manage on public.equipment_maintenance_plans for all to authenticated
using(public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'))
with check(public.has_role('ADMIN') or public.has_role('MANAGER') or public.has_role('WAREHOUSE'));
grant select,insert,update,delete on public.equipment_maintenance_plans to authenticated;

drop trigger if exists trg_equipment_maintenance_plans_updated_at on public.equipment_maintenance_plans;
create trigger trg_equipment_maintenance_plans_updated_at before update on public.equipment_maintenance_plans
for each row execute function public.touch_equipment_updated_at();

create or replace function public.complete_equipment_maintenance_plan(
  p_plan_id uuid,
  p_completed_at date default current_date,
  p_cost numeric default 0,
  p_note text default null,
  p_provider text default null
) returns jsonb
language plpgsql
security invoker
set search_path=public
as $$
declare
  v_plan public.equipment_maintenance_plans%rowtype;
  v_user uuid;
  v_log uuid;
  v_next date;
begin
  select * into v_plan from public.equipment_maintenance_plans where id=p_plan_id and is_active for update;
  if not found then raise exception 'MAINTENANCE_PLAN_NOT_FOUND'; end if;
  if p_completed_at is null then p_completed_at:=current_date; end if;
  if coalesce(p_cost,0)<0 then raise exception 'INVALID_SERVICE_COST'; end if;
  select id into v_user from public.users where auth_user_id=auth.uid() limit 1;
  v_next:=p_completed_at+v_plan.interval_days;
  insert into public.equipment_service_log(equipment_id,maintenance_plan_id,service_type,serviced_at,description,cost,provider,created_by)
  values(v_plan.equipment_id,v_plan.id,v_plan.service_type,p_completed_at,coalesce(nullif(btrim(p_note),''),v_plan.title),coalesce(p_cost,0),nullif(btrim(p_provider),''),v_user)
  returning id into v_log;
  update public.equipment_maintenance_plans set last_completed_at=p_completed_at,next_due_date=v_next,updated_at=now() where id=v_plan.id;
  return jsonb_build_object('success',true,'log_id',v_log,'next_due_date',v_next);
end $$;
revoke all on function public.complete_equipment_maintenance_plan(uuid,date,numeric,text,text) from public;
grant execute on function public.complete_equipment_maintenance_plan(uuid,date,numeric,text,text) to authenticated;

-- Routine cleaning has its own calendar and must not replace the main ТО dates on the equipment card.
create or replace function public.sync_equipment_service_dates()
returns trigger language plpgsql set search_path=public as $$
declare v_interval integer; v_next date;
begin
  if new.service_type in ('CLEANING','OTHER') then return new; end if;
  select service_interval_days into v_interval from public.equipment_assets where id=new.equipment_id;
  v_next:=new.next_due_date;
  if v_next is null and new.service_type='MAINTENANCE' and coalesce(v_interval,0)>0 then v_next:=new.serviced_at+v_interval; end if;
  update public.equipment_assets
  set last_service_date=case when last_service_date is null or new.serviced_at>=last_service_date then new.serviced_at else last_service_date end,
      next_service_date=case when v_next is not null then v_next else next_service_date end,
      updated_at=now()
  where id=new.equipment_id;
  if v_next is not null and new.next_due_date is distinct from v_next then update public.equipment_service_log set next_due_date=v_next where id=new.id; end if;
  return new;
end $$;
