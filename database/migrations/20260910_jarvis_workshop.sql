create extension if not exists pgcrypto;

create table if not exists public.workshop_devices (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text unique,
  device_type text not null default 'OTHER',
  business_unit text,
  location text,
  manufacturer text,
  model text,
  control_mode text not null default 'MONITOR_ONLY',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workshop_cameras (
  id uuid primary key default gen_random_uuid(),
  device_id uuid references public.workshop_devices(id) on delete set null,
  name text not null,
  camera_key text unique not null,
  stream_type text not null default 'RTSP',
  snapshot_path text,
  is_active boolean not null default true,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workshop_device_status (
  device_id uuid primary key references public.workshop_devices(id) on delete cascade,
  camera_id uuid references public.workshop_cameras(id) on delete set null,
  production_job_id uuid references public.production_jobs(id) on delete set null,
  state text not null default 'OFFLINE' check (state in ('OFFLINE','IDLE','RUNNING','PAUSED','DONE','WARNING','ERROR')),
  confidence numeric(5,4),
  progress_percent numeric(5,2),
  status_text text,
  source text not null default 'EDGE',
  last_frame_at timestamptz,
  last_heartbeat_at timestamptz,
  updated_at timestamptz not null default now()
);

create table if not exists public.workshop_events (
  id uuid primary key default gen_random_uuid(),
  device_id uuid references public.workshop_devices(id) on delete cascade,
  camera_id uuid references public.workshop_cameras(id) on delete set null,
  production_job_id uuid references public.production_jobs(id) on delete set null,
  event_type text not null,
  severity text not null default 'INFO' check (severity in ('INFO','WARNING','ERROR','CRITICAL')),
  title text not null,
  description text,
  confidence numeric(5,4),
  snapshot_path text,
  metadata jsonb not null default '{}'::jsonb,
  acknowledged_at timestamptz,
  acknowledged_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists workshop_events_created_at_idx on public.workshop_events(created_at desc);
create index if not exists workshop_events_device_idx on public.workshop_events(device_id, created_at desc);
create index if not exists workshop_status_state_idx on public.workshop_device_status(state);

alter table public.workshop_devices enable row level security;
alter table public.workshop_cameras enable row level security;
alter table public.workshop_device_status enable row level security;
alter table public.workshop_events enable row level security;

-- Read access follows authenticated HUB access. Edge writes should use a dedicated server-side key/service role,
-- never an anonymous browser key.
do $$ begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='workshop_devices' and policyname='workshop_devices_read') then
    create policy workshop_devices_read on public.workshop_devices for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='workshop_cameras' and policyname='workshop_cameras_read') then
    create policy workshop_cameras_read on public.workshop_cameras for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='workshop_device_status' and policyname='workshop_status_read') then
    create policy workshop_status_read on public.workshop_device_status for select to authenticated using (true);
  end if;
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='workshop_events' and policyname='workshop_events_read') then
    create policy workshop_events_read on public.workshop_events for select to authenticated using (true);
  end if;
end $$;
