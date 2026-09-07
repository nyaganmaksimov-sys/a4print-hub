-- Make the cash transaction idempotency key usable by PostgREST/Supabase upsert.
-- PostgreSQL UNIQUE constraints allow multiple NULL external_id values by default,
-- so this preserves the previous partial-index behavior for rows without an external id.

drop index if exists public.uq_cash_transactions_external;

alter table public.cash_transactions
  drop constraint if exists uq_cash_transactions_external;

alter table public.cash_transactions
  add constraint uq_cash_transactions_external
  unique (organization_id, external_source, external_id, direction);

notify pgrst, 'reload schema';
