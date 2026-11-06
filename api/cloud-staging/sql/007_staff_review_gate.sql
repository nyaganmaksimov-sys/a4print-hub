-- A4PRINT Cloud STAGING: explicit privilege review, no automatic role activation.
CREATE TABLE IF NOT EXISTS migration_review.staff_role_reviews (
  legacy_profile_id uuid NOT NULL,
  legacy_role_id uuid NOT NULL,
  reviewer_neon_auth_user_id uuid NOT NULL REFERENCES neon_auth."user"(id) ON DELETE RESTRICT,
  decision text NOT NULL CHECK (decision IN ('APPROVE', 'DENY')),
  reason text NOT NULL CHECK (length(btrim(reason)) >= 10),
  reviewed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(legacy_profile_id, legacy_role_id, reviewer_neon_auth_user_id),
  FOREIGN KEY(legacy_profile_id, legacy_role_id)
    REFERENCES migration_review.staff_role_assignments(legacy_profile_id, legacy_role_id)
    ON DELETE RESTRICT
);
ALTER TABLE migration_review.staff_role_reviews ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON migration_review.staff_role_reviews FROM PUBLIC, anonymous, authenticated, a4print_cloud_probe;

CREATE OR REPLACE VIEW migration_review.staff_identity_review_status AS
SELECT
  m.legacy_profile_id,
  m.is_active,
  m.migration_status,
  m.legacy_auth_user_id IS NOT NULL AS legacy_auth_linked,
  m.neon_auth_user_id IS NOT NULL AS neon_auth_linked,
  au.id IS NOT NULL AS neon_account_exists,
  coalesce(au."emailVerified", false) AS neon_email_verified,
  coalesce(lower(au.email) = lower(m.auth_email), false) AS identity_email_matches,
  (SELECT count(*) FROM migration_review.staff_role_assignments a
    WHERE a.legacy_profile_id = m.legacy_profile_id) AS legacy_roles,
  (SELECT count(*) FROM migration_review.staff_role_assignments a
    JOIN migration_review.roles r ON r.id=a.legacy_role_id
    WHERE a.legacy_profile_id=m.legacy_profile_id
    AND r.name IN ('ADMIN','MANAGER')) AS high_privilege_roles,
  (SELECT count(*) FROM migration_review.staff_role_reviews r
    WHERE r.legacy_profile_id=m.legacy_profile_id
    AND r.decision='APPROVE') AS positive_reviews,
  CASE
    WHEN m.is_active IS NOT TRUE THEN 'BLOCKED_INACTIVE'
    WHEN m.legacy_auth_user_id IS NULL THEN 'NEEDS_IDENTITY_RECONCILIATION'
    WHEN m.neon_auth_user_id IS NULL THEN 'NEEDS_NEON_ACCOUNT'
    WHEN au.id IS NULL THEN 'INVALID_AUTH_LINK'
    WHEN coalesce(au."emailVerified", false) IS NOT TRUE THEN 'NEEDS_EMAIL_VERIFICATION'
    WHEN lower(au.email) IS DISTINCT FROM lower(m.auth_email) THEN 'IDENTITY_MISMATCH'
    ELSE 'NEEDS_EXPLICIT_PERMISSION_APPROVAL'
  END AS blocker
FROM public.cloud_staff_migration_inventory m
LEFT JOIN neon_auth."user" au ON au.id=m.neon_auth_user_id;

REVOKE ALL ON migration_review.staff_identity_review_status FROM PUBLIC, anonymous, authenticated, a4print_cloud_probe;
COMMENT ON VIEW migration_review.staff_identity_review_status IS
  'Readiness diagnostics only. This VIEW never authorizes access or marks any role as enabled.';

-- A hard DB guard prevents accidentally granting synthetic read-only access to real staff.
CREATE OR REPLACE FUNCTION public.cloud_reject_non_synthetic_grant()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path=pg_catalog AS $func$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM neon_auth."user" u
    WHERE u.id=NEW.neon_auth_user_id
      AND lower(u.email) LIKE 'a4print-staging-%@example.com'
  ) THEN
    RAISE EXCEPTION 'non-synthetic identity cannot access cloud_staging_session_grants'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$func$;
DROP TRIGGER IF EXISTS cloud_validate_synthetic_grant ON public.cloud_staging_session_grants;
CREATE TRIGGER cloud_validate_synthetic_grant
  BEFORE INSERT OR UPDATE ON public.cloud_staging_session_grants
  FOR EACH ROW EXECUTE FUNCTION public.cloud_reject_non_synthetic_grant();
REVOKE ALL ON FUNCTION public.cloud_reject_non_synthetic_grant() FROM PUBLIC, anonymous, authenticated, a4print_cloud_probe;
