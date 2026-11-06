-- Stop the workflow if *any* critical guard fails.
insert into migration_review.roles(id,name,created_at) values
 ('00000000-0000-4000-8000-000000000021','ADMIN',now()),
 ('00000000-0000-4000-8000-000000000022','MANAGER',now());
insert into migration_review.staff_role_assignments(legacy_profile_id,legacy_role_id)
values ('00000000-0000-4000-8000-000000000011','00000000-0000-4000-8000-000000000021');

do $check$
declare
 n integer;
begin
 select count(*) into n from migration_review.staff_identity_review_status;
 if n<>2 then raise exception 'expected two staff profiles, got %',n; end if;
 select count(*) into n from migration_review.staff_identity_review_status
   where blocker='NEEDS_NEON_ACCOUNT';
 if n<>1 then raise exception 'missing account blocker'; end if;
 select count(*) into n from migration_review.staff_identity_review_status
   where blocker='NEEDS_IDENTITY_RECONCILIATION';
 if n<>1 then raise exception 'missing identity reconciliation blocker'; end if;

 if has_schema_privilege('anonymous','migration_review','usage')
    or has_schema_privilege('authenticated','migration_review','usage')
    or has_schema_privilege('a4print_cloud_probe','migration_review','usage')
 then raise exception 'SECURITY FAILURE: review schema exposed'; end if;
 if has_table_privilege('a4print_cloud_probe','public.cloud_staging_session_grants','insert')
 then raise exception 'SECURITY FAILURE: probe can grant access'; end if;

 -- The first attempt must fail by trigger with SQLSTATE 23514.
 begin
   insert into public.cloud_staging_session_grants(neon_auth_user_id)
   values ('00000000-0000-4000-8000-000000000002');
   raise exception 'SECURITY FAILURE: normal user was granted synthetic access';
 exception when check_violation then null;
 end;

 insert into public.cloud_staging_session_grants(neon_auth_user_id)
 values ('00000000-0000-4000-8000-000000000001');
 select count(*) into n from public.cloud_staging_session_grants where enabled;
 if n<>0 then raise exception 'SECURITY FAILURE: test access enabled automatically'; end if;
 select count(*) into n from migration_review.staff_role_reviews;
 if n<>0 then raise exception 'SECURITY FAILURE: role approval auto-created'; end if;
end $check$;
