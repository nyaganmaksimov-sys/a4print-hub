-- Verify migration is idempotent and resolves only unique valid active users.
do $$
declare n integer;
begin
 select count(*) into n from public.staff_login_aliases;
 if n <> 2 then raise exception 'expected 2 aliases, got %', n; end if;
 if not exists (select 1 from public.staff_login_aliases where username='operator_1') then
   raise exception 'operator_1 missing';
 end if;
 if not exists (select 1 from public.staff_login_aliases where username='123operator') then
   raise exception 'numeric login missing';
 end if;
 if exists (select 1 from public.staff_login_aliases where username='duplicate' or username='inactive') then
   raise exception 'ambiguous/inactive alias was created';
 end if;
 if exists (select 1 from public.staff_login_aliases where username = 'bad+name') then
   raise exception 'invalid alias was created';
 end if;
end $$;

-- A client cannot read aliases, even with a valid non-privileged role.
-- A test failure must propagate instead of being swallowed.
set role anon;
do $$
begin
  begin
    perform username from public.staff_login_aliases limit 1;
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'SECURITY FAILURE: anon can read aliases';
end $$;
reset role;

set role authenticated;
do $$
begin
  begin
    perform username from public.staff_login_aliases limit 1;
  exception when insufficient_privilege then
    return;
  end;
  raise exception 'SECURITY FAILURE: authenticated can read aliases';
end $$;
reset role;

-- The server role can resolve usernames.
set role service_role;
select username from public.staff_login_aliases order by username;
reset role;
