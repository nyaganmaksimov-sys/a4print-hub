create table if not exists public.manager_calendar_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 300),
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  all_day boolean not null default false,
  order_id uuid references public.orders(id) on delete set null,
  reminder_minutes integer check (reminder_minutes is null or reminder_minutes between 0 and 10080),
  reminded_at timestamptz,
  status text not null default 'SCHEDULED' check (status in ('SCHEDULED','DONE','CANCELLED')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or ends_at >= starts_at)
);

create index if not exists manager_calendar_events_user_start_idx on public.manager_calendar_events(user_id, starts_at);
create index if not exists manager_calendar_events_order_idx on public.manager_calendar_events(order_id) where order_id is not null;
create index if not exists manager_calendar_events_reminder_idx on public.manager_calendar_events(status, reminded_at, starts_at) where reminder_minutes is not null;

alter table public.manager_calendar_events enable row level security;

drop policy if exists manager_calendar_events_select on public.manager_calendar_events;
create policy manager_calendar_events_select on public.manager_calendar_events
for select to authenticated
using (user_id = current_hub_user_id() or has_role('ADMIN'));

drop policy if exists manager_calendar_events_insert on public.manager_calendar_events;
create policy manager_calendar_events_insert on public.manager_calendar_events
for insert to authenticated
with check (user_id = current_hub_user_id() and (has_role('MANAGER') or has_role('ADMIN')));

drop policy if exists manager_calendar_events_update on public.manager_calendar_events;
create policy manager_calendar_events_update on public.manager_calendar_events
for update to authenticated
using (user_id = current_hub_user_id() or has_role('ADMIN'))
with check ((user_id = current_hub_user_id() and (has_role('MANAGER') or has_role('ADMIN'))) or has_role('ADMIN'));

drop policy if exists manager_calendar_events_delete on public.manager_calendar_events;
create policy manager_calendar_events_delete on public.manager_calendar_events
for delete to authenticated
using (user_id = current_hub_user_id() or has_role('ADMIN'));

grant select, insert, update, delete on public.manager_calendar_events to authenticated;
revoke all on public.manager_calendar_events from anon;

create or replace function public.touch_manager_calendar_event_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at := now();
  if new.starts_at is distinct from old.starts_at or new.reminder_minutes is distinct from old.reminder_minutes or new.status is distinct from old.status then
    new.reminded_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.touch_manager_calendar_event_updated_at() from public, anon, authenticated;
grant execute on function public.touch_manager_calendar_event_updated_at() to service_role;

drop trigger if exists trg_manager_calendar_touch on public.manager_calendar_events;
create trigger trg_manager_calendar_touch before update on public.manager_calendar_events
for each row execute function public.touch_manager_calendar_event_updated_at();

create table if not exists public.manager_reminder_log (
  reminder_key text primary key,
  kind text not null,
  entity_id uuid,
  user_id uuid references public.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.manager_reminder_log enable row level security;
revoke all on public.manager_reminder_log from anon, authenticated;
grant all on public.manager_reminder_log to service_role;

create table if not exists public.jarvis_incident_resolutions (
  id uuid primary key default gen_random_uuid(),
  incident_id uuid not null unique references public.jarvis_incidents(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null,
  title text not null,
  problem_signature text not null,
  resolution_text text not null check (char_length(btrim(resolution_text)) between 3 and 6000),
  resolved_by uuid references public.users(id) on delete set null,
  analysis_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists jarvis_incident_resolutions_kind_idx on public.jarvis_incident_resolutions(organization_id, kind, created_at desc);
alter table public.jarvis_incident_resolutions enable row level security;
revoke all on public.jarvis_incident_resolutions from anon, authenticated;
grant all on public.jarvis_incident_resolutions to service_role;
