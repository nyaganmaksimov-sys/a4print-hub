/**
 * A4PRINT CLOUD STAGING API
 * Safe preflight for a future cloud migration. This server deliberately does
 * not implement authentication, order modifications, POS receipts, or writes.
 * Do not route production traffic here.
 */
import { createServer } from 'node:http';
import { Pool } from 'pg';

const PORT = Number(process.env.PORT || 3000);
const DATABASE_URL = String(process.env.DATABASE_URL || '');
const NEON_AUTH_JWKS_URL = String(process.env.NEON_AUTH_JWKS_URL || '');
const pool = DATABASE_URL ? new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: true },
  max: 2,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 6000,
  statement_timeout: 6000
}) : null;

let lastProbe = null;
let lastProbeTime = 0;
let pending = null;

function send(res, code, payload) {
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Robots-Tag': 'noindex, nofollow'
  });
  res.end(JSON.stringify(payload));
}

async function inspectDependencies() {
  let dbReady = false, authReady = false;
  let applicationTables = null;

  if (pool) {
    try {
      const r = await pool.query(
        "SELECT count(*)::integer AS app_tables FROM pg_tables WHERE schemaname='public' AND tablename NOT LIKE 'cloud_staging_%'"
      );
      applicationTables = Number(r.rows?.[0]?.app_tables ?? 0);
      dbReady = true;
    } catch (e) {
      console.warn('[cloud-staging] database probe failed:', String(e?.code || 'connectivity'));
    }
  }

  if (NEON_AUTH_JWKS_URL.startsWith('https://')) {
    try {
      const r = await fetch(NEON_AUTH_JWKS_URL, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(6000),
        cache: 'no-store'
      });
      if (r.ok) {
        const payload = await r.json();
        authReady = Array.isArray(payload?.keys) && payload.keys.length > 0;
      }
    } catch (e) {
      console.warn('[cloud-staging] JWKS probe failed:', String(e?.name || 'network'));
    }
  }

  return {
    service: 'a4print-cloud-staging',
    environment: 'TEST_ONLY',
    status: dbReady && authReady ? 'ready_for_migration_testing' : 'dependencies_unavailable',
    checks: {
      database: dbReady,
      neonAuthJwks: authReady
    },
    applicationTables,
    productionTrafficEnabled: false,
    sourceDataMigrated: false,
    userSessionsMigrated: false,
    posSalesEnabled: false,
    moyskladWritesEnabled: false,
    message: 'Read-only cloud staging health. NOT a production A4PRINT API.'
  };
}

async function getProbe() {
  const now = Date.now();
  if (lastProbe && now - lastProbeTime < 30000) return lastProbe;
  if (!pending) {
    pending = inspectDependencies().then(v => {
      lastProbe = v;
      lastProbeTime = Date.now();
      return v;
    }).finally(() => { pending = null; });
  }
  return pending;
}

const server = createServer(async (req, res) => {
  const path = new URL(req.url || '/', 'http://localhost').pathname;
  if (req.method === 'GET' && (
    path === '/' || path === '/health' ||
    path === '/api/v1/health' || path === '/api/v1/cloud/health'
  )) {
    try {
      const result = await getProbe();
      return send(res, result.checks.database && result.checks.neonAuthJwks ? 200 : 503, result);
    } catch {
      return send(res, 503, {
        service: 'a4print-cloud-staging', status: 'unavailable',
        productionTrafficEnabled: false
      });
    }
  }

  if (/^\/api\/v1\/(mobile\/auth|pos|supabase|system|orders)(\/|$)/.test(path)) {
    return send(res, 503, {
      error: 'STAGING_ENDPOINT_DISABLED',
      message: 'Test cloud API only: no live user authentication, POS sales, or data mutation.'
    });
  }
  return send(res, 404, { error: 'NOT_FOUND', service: 'a4print-cloud-staging' });
});
server.requestTimeout = 10000;
server.headersTimeout = 12000;
server.listen(PORT, '0.0.0.0', () => {
  console.log('[cloud-staging] listening on port ' + PORT);
});
process.on('SIGTERM', async () => {
  server.close();
  if (pool) await pool.end();
});
