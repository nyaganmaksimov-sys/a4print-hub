create table if not exists public.jarvis_tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 500),
  description text,
  status text not null default 'TODO' check (status in ('TODO','IN_PROGRESS','DONE','CANCELLED')),
  priority text not null default 'NORMAL' check (priority in ('LOW','NORMAL','HIGH','URGENT')),
  due_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  assigned_to uuid references public.users(id) on delete set null,
  source text not null default 'JARVIS',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists jarvis_tasks_org_status_idx
  on public.jarvis_tasks (organization_id, status, created_at desc);
create index if not exists jarvis_tasks_assigned_status_idx
  on public.jarvis_tasks (assigned_to, status, created_at desc);
create index if not exists jarvis_tasks_due_idx
  on public.jarvis_tasks (due_at)
  where due_at is not null and status in ('TODO','IN_PROGRESS');

alter table public.jarvis_tasks enable row level security;
revoke all on table public.jarvis_tasks from anon, authenticated;
grant all on table public.jarvis_tasks to service_role;
