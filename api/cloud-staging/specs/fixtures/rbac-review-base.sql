-- Disposable PostgreSQL17 fixture, no actual employee data or secrets.
create role anonymous nologin;
create role authenticated nologin;
create role a4print_cloud_probe nologin;
create schema neon_auth;
create table neon_auth."user" (
  id uuid primary key,
  email text not null unique,
  "emailVerified" boolean not null default false
);
create table public.cloud_staff_migration_inventory (
  legacy_profile_id uuid primary key,
  legacy_auth_user_id uuid,
  neon_auth_user_id uuid,
  auth_email text,
  is_active boolean not null,
  migration_status text not null
);
create table public.cloud_staging_session_grants (
  neon_auth_user_id uuid primary key,
  role text not null default 'STAGING_VIEWER',
  enabled boolean not null default false,
  identity_verified boolean not null default false
);
insert into neon_auth."user"(id,email) values
 ('00000000-0000-4000-8000-000000000001','a4print-staging-synthetic@example.com'),
 ('00000000-0000-4000-8000-000000000002','normal-person@customer.example');
insert into public.cloud_staff_migration_inventory
 (legacy_profile_id,legacy_auth_user_id,neon_auth_user_id,auth_email,is_active,migration_status)
values
 ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000031',null,'real-person@customer.example',true,'AWAITING_PASSWORD_SETUP'),
 ('00000000-0000-4000-8000-000000000012',null,null,null,true,'NEEDS_AUTH_LINK');
