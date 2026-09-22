do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='support_tickets'
  ) then
    execute 'alter publication supabase_realtime add table public.support_tickets';
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname='supabase_realtime'
      and schemaname='public'
      and tablename='support_messages'
  ) then
    execute 'alter publication supabase_realtime add table public.support_messages';
  end if;
end $$;
