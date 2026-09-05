-- A4PRINT HUB POS v2: локальные смены, продажи и возвраты для аналитики.
create table if not exists public.pos_shift_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  moysklad_shift_id text not null,
  moysklad_shift_name text,
  store_id text,
  store_name text,
  opened_by uuid references public.users(id) on delete set null,
  closed_by uuid references public.users(id) on delete set null,
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  status text not null default 'OPEN' check (status in ('OPEN','CLOSED')),
  opening_note text,
  closing_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, moysklad_shift_id)
);

create table if not exists public.pos_sales (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shift_session_id uuid references public.pos_shift_sessions(id) on delete set null,
  moysklad_shift_id text,
  moysklad_sale_id text not null,
  moysklad_sale_name text,
  operator_id uuid references public.users(id) on delete set null,
  customer_id uuid references public.customers(id) on delete set null,
  cash_account_id uuid references public.cash_accounts(id) on delete set null,
  payment_method text,
  total numeric(14,2) not null check (total >= 0),
  item_count numeric(14,3) not null default 0,
  items jsonb not null default '[]'::jsonb,
  sold_at timestamptz not null default now(),
  sync_status text not null default 'SYNCED' check (sync_status in ('SYNCED','WARNING','FAILED')),
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, moysklad_sale_id)
);

create table if not exists public.pos_returns (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  shift_session_id uuid references public.pos_shift_sessions(id) on delete set null,
  pos_sale_id uuid references public.pos_sales(id) on delete set null,
  moysklad_return_id text not null,
  moysklad_return_name text,
  operator_id uuid references public.users(id) on delete set null,
  cash_account_id uuid references public.cash_accounts(id) on delete set null,
  payment_method text,
  amount numeric(14,2) not null check (amount >= 0),
  items jsonb not null default '[]'::jsonb,
  reason text,
  returned_at timestamptz not null default now(),
  sync_status text not null default 'SYNCED' check (sync_status in ('SYNCED','WARNING','FAILED')),
  sync_error text,
  created_at timestamptz not null default now(),
  unique (organization_id, moysklad_return_id)
);

create index if not exists idx_pos_shift_sessions_org_opened on public.pos_shift_sessions(organization_id, opened_at desc);
create index if not exists idx_pos_sales_org_sold on public.pos_sales(organization_id, sold_at desc);
create index if not exists idx_pos_sales_shift on public.pos_sales(shift_session_id, sold_at desc);
create index if not exists idx_pos_sales_operator on public.pos_sales(operator_id, sold_at desc);
create index if not exists idx_pos_returns_org_returned on public.pos_returns(organization_id, returned_at desc);
create index if not exists idx_pos_returns_shift on public.pos_returns(shift_session_id, returned_at desc);

alter table public.pos_shift_sessions enable row level security;
alter table public.pos_sales enable row level security;
alter table public.pos_returns enable row level security;

drop policy if exists pos_shift_sessions_admin_all on public.pos_shift_sessions;
create policy pos_shift_sessions_admin_all on public.pos_shift_sessions for all to authenticated
using (public.has_role('ADMIN')) with check (public.has_role('ADMIN'));
drop policy if exists pos_sales_admin_all on public.pos_sales;
create policy pos_sales_admin_all on public.pos_sales for all to authenticated
using (public.has_role('ADMIN')) with check (public.has_role('ADMIN'));
drop policy if exists pos_returns_admin_all on public.pos_returns;
create policy pos_returns_admin_all on public.pos_returns for all to authenticated
using (public.has_role('ADMIN')) with check (public.has_role('ADMIN'));
