-- Enable live updates for the unified A4PRINT HUB control center.
-- Idempotent so this migration is safe even when a table is already published.

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'orders',
    'pos_sales',
    'pos_returns',
    'pos_shift_sessions',
    'pos_cash_balance_state',
    'production_jobs',
    'inventory_transactions',
    'catalog_items'
  ]
  loop
    if not exists (
      select 1
      from pg_publication_tables
      where pubname = 'supabase_realtime'
        and schemaname = 'public'
        and tablename = table_name
    ) then
      execute format('alter publication supabase_realtime add table public.%I', table_name);
    end if;
  end loop;
end
$$;
