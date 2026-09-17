-- A4PRINT KASSA: server-side idempotency for POS return retries.
create table if not exists public.pos_return_operations (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_operation_id text not null,
  status text not null default 'PROCESSING' check (status in ('PROCESSING','SYNCED','UNKNOWN','FAILED')),
  requested_by_auth_user_id uuid,
  moysklad_return_id text,
  moysklad_return_name text,
  moysklad_return_href text,
  response_json jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, client_operation_id)
);

create index if not exists idx_pos_return_operations_status_updated
  on public.pos_return_operations(status, updated_at desc);

alter table public.pos_return_operations enable row level security;
revoke all on table public.pos_return_operations from anon, authenticated;

comment on table public.pos_return_operations is
  'Server-only idempotency registry for A4PRINT KASSA return synchronization.';
