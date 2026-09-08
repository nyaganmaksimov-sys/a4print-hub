-- production_jobs already uses RLS policies for HUB staff, but the authenticated
-- role also needs table privileges before PostgreSQL can evaluate those policies.

grant select, insert, update, delete on table public.production_jobs to authenticated;
