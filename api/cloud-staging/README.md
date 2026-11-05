# A4PRINT CLOUD — Render + Neon (read-only staging)

This is a **separate** test API, not the production A4PRINT HUB API.

- GitHub branch: `integration/neon-cloud-staging-20261105`
- Neon project: `A4PRINT-Cloud-STAGING` (`curly-recipe-68200716`)
- Neon database: `a4print_cloud`, PostgreSQL 17, Frankfurt
- Render deployment: independent **free** Node.js web service, Frankfurt.
- Build command (repo root): `npm install --prefix api/cloud-staging --omit=dev --no-audit --no-fund`
- Start command (repo root): `node api/cloud-staging/server.js`
- `DATABASE_URL`: ***read-only*** connection URL to Neon, set as secret in Render.
- `NEON_AUTH_JWKS_URL`: public JWKS endpoint of the new Neon Auth installation.

## Endpoints

- `GET /api/v1/cloud/health`: checks database and public Neon Auth JWKS. Caches result for 30 seconds.
- `GET /api/v1/health`: same health check (this service is clearly labeled as staging).
- All routes for sales, shifts, order writes, username/password auth, and Supabase proxy are explicitly disabled.

`productionTrafficEnabled=false` and `sourceDataMigrated=false` are deliberately hardcoded.

## Do NOT

- Point `api.a4print-hub.ru`, HUB, KASSA, 3D-ARTPRINT, or CUIM at this service.
- Assume Neon Auth users/password hashes are interchangeable with Supabase Auth.
- Call it a completed migration while database tables, users, RLS policies, functions, and object files are missing.
- Put `DATABASE_URL` or admin keys in GitHub files or client-side JavaScript.

## Launch gates (must all pass before a separate production migration)

1. Verified Supabase backups, including Auth identities and Storage objects.
2. Full schema/data migration and equivalent RLS policies, plus PostGIS/functions assessment.
3. Authentication account linking with old IDs and staff roles tested.
4. Real login, session refresh, PIN, sale, return, shift, idempotency and MoySklad integration on test data.
5. Browser, desktop, mobile and 3D-ARTPRINT end-to-end checks without VPN.
6. Rollback plan, production monitoring and incident response.

Current staging is useful for connection testing only.
