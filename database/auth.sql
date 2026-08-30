-- Run after schema.sql in Supabase SQL Editor.
-- Auth users are created from Supabase Dashboard > Authentication > Users.

create or replace function public.handle_new_auth_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (auth_user_id, full_name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(coalesce(new.email,''),'@',1)), new.email)
  on conflict (auth_user_id) do update set email=excluded.email;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create or replace function public.has_role(required_role text)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.users u
    join public.user_roles ur on ur.user_id=u.id
    join public.roles r on r.id=ur.role_id
    where u.auth_user_id=auth.uid()
      and u.is_active=true
      and r.name=required_role
  );
$$;

-- Assign ADMIN after creating the first user:
-- insert into public.user_roles(user_id, role_id)
-- select u.id, r.id from public.users u, public.roles r
-- where u.email='YOUR_EMAIL' and r.name='ADMIN'
-- on conflict do nothing;
