create table if not exists public.telegram_integrations (
  code text primary key default 'main',
  enabled boolean not null default false,
  bot_id bigint,
  bot_username text,
  bot_token_encrypted text not null,
  webhook_secret text not null,
  accept_orders boolean not null default true,
  auto_reply boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create table if not exists public.telegram_messages (
  id uuid primary key default gen_random_uuid(),
  update_id bigint not null unique,
  chat_id bigint not null,
  telegram_message_id bigint,
  telegram_user_id bigint,
  username text,
  first_name text,
  last_name text,
  message_type text not null default 'text',
  message_text text,
  raw jsonb not null default '{}'::jsonb,
  status text not null default 'NEW' check (status in ('NEW','READ','IN_WORK','ORDER_CREATED','CLOSED')),
  linked_order_id uuid references public.orders(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists telegram_messages_status_created_idx on public.telegram_messages(status, created_at desc);
create index if not exists telegram_messages_chat_created_idx on public.telegram_messages(chat_id, created_at desc);

alter table public.telegram_integrations enable row level security;
alter table public.telegram_messages enable row level security;

revoke all on table public.telegram_integrations from anon, authenticated;
revoke all on table public.telegram_messages from anon, authenticated;

grant all on table public.telegram_integrations to service_role;
grant all on table public.telegram_messages to service_role;
