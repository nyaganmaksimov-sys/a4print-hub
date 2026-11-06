/**
 * A4PRINT CLOUD STAGING API
 * Safe preflight for a future cloud migration. This server deliberately does
 * not implement authentication, order modifications, POS receipts, or writes.
 * Do not route production traffic here.
 */
import { createServer } from 'node:http';
import { Pool } from 'pg';
import { createNeonVerifier, authorizeSession } from './auth-session.js';

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

let taxonomyCache = null;
let taxonomyCachedAt = 0;
let taxonomyPending = null;

const NEON_AUTH_BASE_URL = String(process.env.NEON_AUTH_BASE_URL || '').replace(/\/$/, '');
const AUTH_PROBE_ENABLED = process.env.STAGING_AUTH_PROBE_ENABLED === 'true';
let verifiedToken = null;
try {
  verifiedToken = createNeonVerifier({
    baseUrl: NEON_AUTH_BASE_URL,
    jwksUrl: NEON_AUTH_JWKS_URL
  });
} catch {
  // Inconsistent JWKS URL or issuer must disable the route, not crash production.
  console.error('[cloud-staging] Neon JWT verifier disabled: unsafe config');
}
const SELF_ORIGIN = 'https://a4print-neon-cloud-api-staging.onrender.com';
const attemptLedger = new Map();

function underLimit(login) {
  const now = Date.now();
  for (const [key, data] of attemptLedger) if (now - data.start >= 15 * 60000) attemptLedger.delete(key);
  const entry = attemptLedger.get(login);
  if (entry && entry.count >= 6) return false;
  attemptLedger.set(login, entry ? { start: entry.start, count: entry.count + 1 } : { start: now, count: 1 });
  return true;
}

async function parseSmallJson(req) {
  let bytes = 0;
  const chunks = [];
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 1600) throw new Error('REQUEST_TOO_LARGE');
    chunks.push(chunk);
  }
  if (!bytes) throw new Error('EMPTY_REQUEST');
  const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('INVALID_JSON');
  return data;
}

async function probePassword(req, res) {
  // This intentionally DOES NOT create an application session or grant a role.
  // It only proves that a synthetic username can be checked by Managed Better Auth.
  if (!AUTH_PROBE_ENABLED || !NEON_AUTH_BASE_URL.startsWith('https://') || !pool) {
    return send(res, 503, { error: 'STAGING_AUTH_DISABLED', environment: 'TEST_ONLY' });
  }
  const origin = String(req.headers.origin || '');
  if (origin && origin !== SELF_ORIGIN) {
    return send(res, 403, { error: 'ORIGIN_DENIED' });
  }
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
    return send(res, 415, { error: 'JSON_REQUIRED' });
  }

  let payload;
  try { payload = await parseSmallJson(req); }
  catch { return send(res, 400, { error: 'INVALID_REQUEST' }); }

  const login = String(payload.login || '').trim().toLowerCase();
  const password = payload.password;
  if (!/^staging_[a-z0-9_-]{3,32}$/.test(login) || typeof password !== 'string'
    || password.length < 12 || password.length > 256) {
    return send(res, 401, { error: 'INVALID_LOGIN_OR_PASSWORD' });
  }
  if (!underLimit(login)) {
    return send(res, 429, { error: 'TRY_LATER', environment: 'TEST_ONLY' });
  }

  let email = null;
  try {
    const found = await pool.query(
      'SELECT auth_email FROM public.cloud_staging_login_aliases WHERE username=$1 AND is_active=true LIMIT 1',
      [login]
    );
    email = found.rows?.[0]?.auth_email || null;
  } catch {
    return send(res, 503, { error: 'STAGING_AUTH_UNAVAILABLE', environment: 'TEST_ONLY' });
  }
  if (!email || !email.endsWith('@example.com')) {
    return send(res, 401, { error: 'INVALID_LOGIN_OR_PASSWORD' });
  }
  try {
    const upstream = await fetch(NEON_AUTH_BASE_URL + '/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', Origin: SELF_ORIGIN },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(10000),
      redirect: 'manual'
    });
    if (upstream.status === 429) return send(res, 429, { error: 'TRY_LATER' });
    if (upstream.status === 400 || upstream.status === 401 || upstream.status === 403
      || upstream.status === 404 || upstream.status === 422) {
      return send(res, 401, { error: 'INVALID_LOGIN_OR_PASSWORD' });
    }
    if (!upstream.ok) return send(res, 503, { error: 'STAGING_AUTH_UNAVAILABLE' });

    const result = await upstream.json();
    if (String(result?.user?.email || '').toLowerCase() !== email.toLowerCase()
      || !result.user?.id) {
      return send(res, 503, { error: 'STAGING_AUTH_USER_MISMATCH' });
    }
    // Important: don't forward Neon session cookie/token or JWT to untrusted callers.
    return send(res, 200, {
      success: true,
      login,
      provider: 'Neon Auth',
      environment: 'TEST_ONLY',
      passwordVerified: true,
      sessionIssued: false,
      permissions: [],
      message: 'Пароль проверен Neon Auth. Рабочая сессия и доступ к кассе не выдаются.'
    });
  } catch {
    return send(res, 503, { error: 'STAGING_AUTH_UNAVAILABLE' });
  }
}

async function publicTaxonomy() {
  if (!pool) throw new Error('DATABASE_NOT_CONFIGURED');
  if (taxonomyCache && Date.now() - taxonomyCachedAt < 300000) return taxonomyCache;
  if (taxonomyPending) return taxonomyPending;
  taxonomyPending = (async () => {
    const [sections, subcategories] = await Promise.all([
      pool.query(`SELECT section_key, title, slug, icon_fallback, sort_order
        FROM public.marketplace_city_sections WHERE active IS TRUE
        ORDER BY sort_order, section_key LIMIT 30`),
      pool.query(`SELECT subcategory_key, section_key, title, slug, icon_fallback, sort_order
        FROM public.marketplace_city_subcategories WHERE active IS TRUE
        ORDER BY sort_order, subcategory_key LIMIT 150`)
    ]);
    const result = {
      service: 'a4print-cloud-staging',
      environment: 'TEST_ONLY',
      source: 'CUIM taxonomy read-only snapshot',
      readOnly: true,
      customerDataIncluded: false,
      catalog: {
        sections: sections.rows,
        subcategories: subcategories.rows
      },
      counts: { sections: sections.rows.length, subcategories: subcategories.rows.length }
    };
    taxonomyCache = result;
    taxonomyCachedAt = Date.now();
    return result;
  })().finally(() => { taxonomyPending = null; });
  return taxonomyPending;
}

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



  if (path === '/api/v1/cloud/auth/session') {
    if (req.method !== 'GET') return send(res, 405, {error:'METHOD_NOT_ALLOWED'});
    const decision = await authorizeSession({
      authorization:req.headers.authorization, verify:verifiedToken, pool
    });
    return send(res, decision.status, decision.result);
  }

  if (path === '/api/v1/cloud/auth/password') {
    if (req.method !== 'POST') return send(res, 405, { error: 'METHOD_NOT_ALLOWED' });
    return probePassword(req, res);
  }

  if (path === '/api/v1/cloud/cuim/taxonomy') {
    if (req.method !== 'GET' && req.method !== 'HEAD')
      return send(res, 405, {error: 'METHOD_NOT_ALLOWED'});
    try {
      const taxonomy = await publicTaxonomy();
      // The source Supabase policies already allowed public reading of active taxonomy.
      // Return only public columns. Never return user, price, payment or inactive records.
      const origin = String(req.headers.origin || '');
      if (origin === 'https://tcuim.online' || origin === 'https://www.tcuim.online') {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Vary', 'Origin');
      }
      return send(res, 200, taxonomy);
    } catch {
      return send(res, 503, {
        error: 'CATALOG_SNAPSHOT_UNAVAILABLE',
        message: 'Cloud staging taxonomy is not ready.',
        environment: 'TEST_ONLY'
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
