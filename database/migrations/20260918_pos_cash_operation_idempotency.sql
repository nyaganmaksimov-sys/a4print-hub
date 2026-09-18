-- A4PRINT KASSA: server-side idempotency for cash drawer operations.
create table if not exists public.pos_cash_operation_requests (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  client_operation_id text not null,
  operation_type text not null check (operation_type in ('CASH_IN','CASH_OUT')),
  status text not null default 'PROCESSING' check (status in ('PROCESSING','SYNCED','UNKNOWN','FAILED')),
  requested_by_auth_user_id uuid,
  moysklad_operation_id text,
  moysklad_operation_name text,
  response_json jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (organization_id, client_operation_id)
);

create index if not exists idx_pos_cash_operation_requests_status_updated
  on public.pos_cash_operation_requests(status, updated_at desc);

alter table public.pos_cash_operation_requests enable row level security;
revoke all on table public.pos_cash_operation_requests from anon, authenticated;

comment on table public.pos_cash_operation_requests is
  'Server-only idempotency registry for A4PRINT KASSA cash-in and cash-out synchronization.';
