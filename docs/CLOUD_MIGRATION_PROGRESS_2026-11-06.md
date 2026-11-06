# A4PRINT Cloud: migration checkpoint — 2026-11-06

## Actual cloud environment

**Neon project:** `curly-recipe-68200716` / `A4PRINT-Cloud-STAGING`, database `a4print_cloud`, PostgreSQL 17, Frankfurt.  
**Render service:** `srv-dbm9n0g8v5cc73e0284g`, [cloud staging](https://a4print-neon-cloud-api-staging.onrender.com/api/v1/cloud/health).  
**Source Supabase:** `qgakliolffnwkymoqvzn` (unchanged, remains source of truth).

## Read-only data snapshots already copied from Supabase

| Table | Rows | Matching check |
|---|---:|---|
| `marketplace_city_sections` | 8 | exact MD5 of ordered JSONB rows |
| `marketplace_city_subcategories` | 61 | exact MD5 of ordered JSONB rows |
| `organizations` | 2 | exact MD5 of ordered JSONB rows |
| `catalog_items` | 505 | all columns match after canonicalizing numeric scale (see below) |

**Total: 576 rows in 4 application tables**; source key IDs retained; no broken foreign keys.

### Numeric representation

The JSON export path converts some SQL numbers such as `350.00` to `350`. The arithmetic values are equal. All 3 numeric fields (`sale_price`, `cost_price`, `min_stock`) matched their source using a six-decimal normalized JSONB hash and aggregate totals. Other **18 columns** matched exactly with per-column JSONB checksums. Therefore do **not** claim bit-for-bit identical serialized rows for `catalog_items`; this is a value-equivalent staging copy.

## Access control

- Every new table has RLS enabled.
- Table access revoked from `anonymous`, `authenticated`, and `PUBLIC`.
- Only `a4print_cloud_probe` has SELECT (no INSERT/UPDATE/DELETE); this is a separate DB credential in Render and **must never** reach the browser.
- The Render service exposes only the **active public CUIM taxonomy** via `/api/v1/cloud/cuim/taxonomy`. The endpoint returns titles, keys, slugs, sort orders, icons; it does **not** return users, product prices, inactive rows, account details or checkout data.
- `POST /api/v1/pos/sales` still explicitly responds `503 STAGING_ENDPOINT_DISABLED`.

## Migration source control

- [Taxonomy schema and RLS](https://github.com/nyaganmaksimov-sys/a4print-hub/blob/integration/neon-cloud-staging-20261105/api/cloud-staging/sql/001_cuim_taxonomy.sql)
- [HUB catalog schema and RLS](https://github.com/nyaganmaksimov-sys/a4print-hub/blob/integration/neon-cloud-staging-20261105/api/cloud-staging/sql/002_hub_catalog_snapshot.sql)
- [Read-only cloud API](https://github.com/nyaganmaksimov-sys/a4print-hub/blob/integration/neon-cloud-staging-20261105/api/cloud-staging/server.js)
- [Live smoke tests](https://github.com/nyaganmaksimov-sys/a4print-hub/blob/integration/neon-cloud-staging-20261105/.github/workflows/check-neon-cloud-staging.yml)
- [Draft PR #391](https://github.com/nyaganmaksimov-sys/a4print-hub/pull/391)

This was a one-time, paginated snapshot made with Supabase read-only queries and Neon staging inserts, with separate checksum verification. The data is **not continuously synchronized**; changes in Supabase after this snapshot do not propagate automatically.

## What is **NOT** migrated

The majority of the ~207 Supabase public tables, 567 public functions, auth users/passwords, RLS policies, file bytes from 12 buckets, 14 Edge Functions, production 3D job streams, cash register sales/shift ledgers, and payment webhooks remain to be migrated and tested separately. Neon Auth is provisioned, but existing Supabase Auth identities are not yet re-created or linked. This cloud staging cannot replace production.

## Next implementation gates

1. Establish privileged, verified database/Storage export backups.
2. Read-only migration of one business module at a time with source-target counts and integrity checks.
3. Rebuild staff identity mapping for Neon Auth, verify username/password/refresh-token security and employee roles.
4. Port remaining API and functions, including locked-down customer and staff tenant permissions.
5. Dry-run POS with fake sales and explicit idempotency checks; never use real payments in staging.
6. Check low egress limits, slow queries and synchronization cadence.
7. Switch domains/app updates only after end-to-end user acceptance and rollback tests.

**The original Supabase, main Render API, A4PRINT KASSA, HUB, 3D-ARTPRINT and CUIM production site were not changed.**
