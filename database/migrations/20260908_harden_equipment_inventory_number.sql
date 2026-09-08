create or replace function public.next_equipment_inventory_number()
returns text
language sql
security invoker
set search_path=public
as $$
  select 'A4-EQ-' || lpad(nextval('public.equipment_inventory_number_seq')::text,5,'0')
$$;

revoke all on function public.next_equipment_inventory_number() from public, anon;
grant execute on function public.next_equipment_inventory_number() to authenticated;
