-- Least-privilege follow-up for the tenant RLS context helper.
-- Authenticated clients call only the public wrapper used by policies.
revoke execute on function private.current_user_organization_id() from authenticated;
