create index if not exists users_organization_unit_id_idx on public.users(organization_unit_id);
create index if not exists users_position_id_idx on public.users(position_id);
create index if not exists staff_positions_organization_unit_id_idx on public.staff_positions(organization_unit_id);

drop policy if exists staff_positions_admin_write on public.staff_positions;
drop policy if exists staff_positions_admin_insert on public.staff_positions;
drop policy if exists staff_positions_admin_update on public.staff_positions;
drop policy if exists staff_positions_admin_delete on public.staff_positions;
create policy staff_positions_admin_insert on public.staff_positions for insert to authenticated with check (public.has_role('ADMIN'));
create policy staff_positions_admin_update on public.staff_positions for update to authenticated using (public.has_role('ADMIN')) with check (public.has_role('ADMIN'));
create policy staff_positions_admin_delete on public.staff_positions for delete to authenticated using (public.has_role('ADMIN'));
