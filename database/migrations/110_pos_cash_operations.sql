create table if not exists public.pos_cash_operations (
  id uuid primary key default gen_random_uuid(),
  operator_id uuid null references public.users(id) on delete set null,
  moysklad_shift_id text not null,
  moysklad_operation_id text not null unique,
  moysklad_operation_name text null,
  operation_type text not null check (operation_type in ('CASH_OUT','CASH_IN')),
  amount numeric(14,2) not null check (amount > 0),
  reason text null,
  created_at timestamptz not null default now()
);
create index if not exists pos_cash_operations_created_at_idx on public.pos_cash_operations(created_at desc);
create index if not exists pos_cash_operations_shift_idx on public.pos_cash_operations(moysklad_shift_id, created_at desc);
alter table public.pos_cash_operations enable row level security;
comment on table public.pos_cash_operations is 'Cash drawer operations created from A4PRINT KASSA and synchronized with MoySklad';
