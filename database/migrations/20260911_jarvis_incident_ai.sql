create table if not exists public.jarvis_incident_ai (
  incident_id uuid primary key references public.jarvis_incidents(id) on delete cascade,
  incident_signature text not null,
  analysis text not null default '',
  sources jsonb not null default '[]'::jsonb,
  provider text,
  model text,
  web_search boolean not null default false,
  generated_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_error text
);

alter table public.jarvis_incident_ai enable row level security;

revoke all on table public.jarvis_incident_ai from anon, authenticated;
grant all on table public.jarvis_incident_ai to service_role;

create index if not exists jarvis_incident_ai_updated_at_idx
  on public.jarvis_incident_ai(updated_at desc);

comment on table public.jarvis_incident_ai is
  'Server-only cache of AI analysis for Jarvis Sentinel incidents. Access is exposed only through authenticated HUB API routes.';
