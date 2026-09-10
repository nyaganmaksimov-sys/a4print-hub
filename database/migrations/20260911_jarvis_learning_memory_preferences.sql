create table if not exists public.jarvis_user_preferences (
  user_id uuid primary key references public.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  humor_level smallint not null default 1 check (humor_level between 0 and 3),
  learning_enabled boolean not null default true,
  wake_word_enabled boolean not null default true,
  bot_mode text not null default 'off' check (bot_mode in ('off','draft','auto')),
  bot_cursor_at timestamptz,
  style_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.jarvis_memory_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  kind text not null default 'preference' check (kind in ('preference','correction','fact','workflow')),
  memory_key text not null,
  memory_text text not null check (char_length(btrim(memory_text)) between 1 and 1200),
  confidence numeric(4,3) not null default 0.850 check (confidence between 0 and 1),
  source text not null default 'explicit',
  active boolean not null default true,
  use_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, memory_key)
);

create table if not exists public.jarvis_usage_stats (
  user_id uuid not null references public.users(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  intent_key text not null,
  use_count integer not null default 0,
  success_count integer not null default 0,
  last_used_at timestamptz not null default now(),
  primary key (user_id, intent_key)
);

create index if not exists jarvis_memory_user_active_idx on public.jarvis_memory_items(user_id, active, updated_at desc);
create index if not exists jarvis_memory_org_idx on public.jarvis_memory_items(organization_id, updated_at desc);
create index if not exists jarvis_usage_user_idx on public.jarvis_usage_stats(user_id, use_count desc, last_used_at desc);

alter table public.jarvis_user_preferences enable row level security;
alter table public.jarvis_memory_items enable row level security;
alter table public.jarvis_usage_stats enable row level security;

revoke all on table public.jarvis_user_preferences from anon, authenticated;
revoke all on table public.jarvis_memory_items from anon, authenticated;
revoke all on table public.jarvis_usage_stats from anon, authenticated;
grant all on table public.jarvis_user_preferences to service_role;
grant all on table public.jarvis_memory_items to service_role;
grant all on table public.jarvis_usage_stats to service_role;
