-- A4PRINT HUB branding/logo management.
-- Run once in Supabase SQL editor.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'hub-branding',
  'hub-branding',
  true,
  5242880,
  array['image/png','image/jpeg','image/webp','image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Admins can manage HUB branding files from the browser.
drop policy if exists "hub_branding_admin_insert" on storage.objects;
create policy "hub_branding_admin_insert"
on storage.objects for insert
to authenticated
with check (bucket_id = 'hub-branding' and public.has_role('ADMIN'));

drop policy if exists "hub_branding_admin_update" on storage.objects;
create policy "hub_branding_admin_update"
on storage.objects for update
to authenticated
using (bucket_id = 'hub-branding' and public.has_role('ADMIN'))
with check (bucket_id = 'hub-branding' and public.has_role('ADMIN'));

drop policy if exists "hub_branding_admin_delete" on storage.objects;
create policy "hub_branding_admin_delete"
on storage.objects for delete
to authenticated
using (bucket_id = 'hub-branding' and public.has_role('ADMIN'));

-- Authenticated HUB users may read the active logo setting.
-- settings RLS is intentionally not enabled here to avoid changing existing behavior.
insert into public.settings(key, value)
values ('hub_branding', jsonb_build_object('logo_url', ''))
on conflict (key) do nothing;
