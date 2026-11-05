-- Disposable PostgreSQL fixture for CI. No customer data or secrets.
create role anon nologin;
create role authenticated nologin;
create role service_role nologin;
create schema auth;
create table auth.users (id uuid primary key, email text not null);
create table public.users (auth_user_id uuid, is_active boolean not null);

insert into auth.users(id, email) values
 ('10000000-0000-0000-0000-000000000001','operator_1@example.test'),
 ('10000000-0000-0000-0000-000000000002','123operator@example.test'),
 ('10000000-0000-0000-0000-000000000003','duplicate@company.test'),
 ('10000000-0000-0000-0000-000000000004','duplicate@other.test'),
 ('10000000-0000-0000-0000-000000000005','inactive@company.test'),
 ('10000000-0000-0000-0000-000000000006','bad+name@company.test');

insert into public.users(auth_user_id,is_active) values
 ('10000000-0000-0000-0000-000000000001',true),
 ('10000000-0000-0000-0000-000000000002',true),
 ('10000000-0000-0000-0000-000000000003',true),
 ('10000000-0000-0000-0000-000000000004',true),
 ('10000000-0000-0000-0000-000000000005',false),
 ('10000000-0000-0000-0000-000000000006',true);
