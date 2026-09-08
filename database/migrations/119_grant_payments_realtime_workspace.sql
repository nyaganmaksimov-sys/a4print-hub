-- Allow authenticated HUB staff to reach payments RLS policies and publish
-- payment changes to the realtime orders workspace.

grant select, insert, update, delete on table public.payments to authenticated;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'payments'
  ) then
    alter publication supabase_realtime add table public.payments;
  end if;
end
$$;
