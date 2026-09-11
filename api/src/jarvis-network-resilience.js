import { createHash } from 'node:crypto';

const installed = Symbol.for('a4print.jarvis.network.resilience.installed');

if (!globalThis[installed]) {
  globalThis[installed] = true;

  const originalFetch = globalThis.fetch.bind(globalThis);
  const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
  const jarvisUrl = String(process.env.JARVIS_WORKSHOP_URL || '').replace(/\/$/, '');
  const jarvisKey = String(process.env.JARVIS_API_KEY || '');
  const authEndpoint = supabaseUrl ? `${supabaseUrl}/auth/v1/user` : '';
  const jarvisOrigin = (() => {
    try { return jarvisUrl ? new URL(jarvisUrl).origin : ''; } catch { return ''; }
  })();

  const authCache = new Map();
  const authInflight = new Map();
  const stats = {
    auth_cache_hits: 0,
    auth_stale_hits: 0,
    auth_network_calls: 0,
    auth_failures: 0,
    jarvis_calls: 0,
    jarvis_retries: 0,
    jarvis_failures: 0,
    last_jarvis_ok_at: null,
    last_jarvis_error_at: null,
    last_jarvis_error: null
  };

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const tokenKey = token => createHash('sha256').update(token).digest('hex').slice(0, 24);

  function requestUrl(input) {
    try {
      if (typeof input === 'string' || input instanceof URL) return new URL(input).href;
      if (input && typeof input.url === 'string') return new URL(input.url).href;
    } catch {}
    return '';
  }

  function requestMethod(input, init = {}) {
    return String(init.method || input?.method || 'GET').toUpperCase();
  }

  function headerValue(input, init, name) {
    const merged = new Headers(input?.headers || undefined);
    const extra = new Headers(init?.headers || undefined);
    extra.forEach((value, key) => merged.set(key, value));
    return merged.get(name) || '';
  }

  function bearerToken(input, init) {
    return headerValue(input, init, 'authorization').replace(/^Bearer\s+/i, '').trim();
  }

  function responseFrom(record) {
    return new Response(record.body, {
      status: record.status,
      statusText: record.statusText || '',
      headers: record.headers || { 'content-type': 'application/json' }
    });
  }

  function responseRecord(response, body) {
    const headers = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    return { status: response.status, statusText: response.statusText, headers, body };
  }

  function purgeAuthCache() {
    const now = Date.now();
    for (const [key, value] of authCache) {
      if (value.staleUntil <= now) authCache.delete(key);
    }
    while (authCache.size > 250) authCache.delete(authCache.keys().next().value);
  }

  async function verifiedAuthFetch(input, init = {}) {
    const token = bearerToken(input, init);
    if (!token) return originalFetch(input, init);
    const key = tokenKey(token);
    const now = Date.now();
    const cached = authCache.get(key);
    if (cached && cached.freshUntil > now) {
      stats.auth_cache_hits += 1;
      return responseFrom(cached.record);
    }

    if (authInflight.has(key)) {
      const record = await authInflight.get(key);
      return responseFrom(record);
    }

    const work = (async () => {
      let lastError;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 12000);
        try {
          stats.auth_network_calls += 1;
          const response = await originalFetch(input, { ...init, signal: controller.signal });
          const body = await response.text();
          const record = responseRecord(response, body);
          if (response.ok) {
            authCache.set(key, {
              record,
              freshUntil: Date.now() + 5 * 60 * 1000,
              staleUntil: Date.now() + 15 * 60 * 1000
            });
            purgeAuthCache();
          }
          return record;
        } catch (error) {
          lastError = error;
          if (attempt < 2) await sleep(350 * attempt);
        } finally {
          clearTimeout(timer);
        }
      }

      if (cached && cached.staleUntil > Date.now()) {
        stats.auth_stale_hits += 1;
        console.warn('[Jarvis auth] Supabase auth temporarily unavailable; using recently verified session cache');
        return cached.record;
      }
      stats.auth_failures += 1;
      throw lastError || new Error('AUTH_UPSTREAM_UNAVAILABLE');
    })();

    authInflight.set(key, work);
    try {
      const record = await work;
      return responseFrom(record);
    } finally {
      authInflight.delete(key);
    }
  }

  function isJarvisRequest(url) {
    if (!jarvisOrigin || !url) return false;
    try { return new URL(url).origin === jarvisOrigin; } catch { return false; }
  }

  async function resilientJarvisFetch(input, init = {}) {
    const method = requestMethod(input, init);
    const attempts = method === 'GET' ? 2 : 1;
    let lastError;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 65000);
      const started = Date.now();
      try {
        stats.jarvis_calls += 1;
        const response = await originalFetch(input, { ...init, signal: controller.signal });
        const elapsed = Date.now() - started;
        if (response.ok) {
          stats.last_jarvis_ok_at = new Date().toISOString();
          stats.last_jarvis_error = null;
          if (elapsed > 5000) console.info(`[Jarvis bridge] request recovered after ${elapsed} ms`);
          return response;
        }
        if (attempt < attempts && [502, 503, 504].includes(response.status)) {
          stats.jarvis_retries += 1;
          await response.arrayBuffer().catch(() => {});
          await sleep(900);
          continue;
        }
        return response;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          stats.jarvis_retries += 1;
          await sleep(900);
          continue;
        }
      } finally {
        clearTimeout(timer);
      }
    }

    stats.jarvis_failures += 1;
    stats.last_jarvis_error_at = new Date().toISOString();
    stats.last_jarvis_error = String(lastError?.message || lastError || 'JARVIS_NETWORK_ERROR');
    throw lastError || new Error('JARVIS_NETWORK_ERROR');
  }

  globalThis.fetch = async function a4JarvisResilientFetch(input, init = {}) {
    const url = requestUrl(input);
    if (authEndpoint && url === authEndpoint) return verifiedAuthFetch(input, init);
    if (isJarvisRequest(url)) return resilientJarvisFetch(input, init);
    return originalFetch(input, init);
  };

  globalThis.__A4_JARVIS_NETWORK_STATS__ = stats;

  async function heartbeat() {
    if (!jarvisUrl || !jarvisKey) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 70000);
    try {
      const response = await originalFetch(`${jarvisUrl}/health`, {
        headers: { Authorization: `Bearer ${jarvisKey}`, Accept: 'application/json' },
        signal: controller.signal,
        cache: 'no-store'
      });
      if (!response.ok) throw new Error(`HTTP_${response.status}`);
      stats.last_jarvis_ok_at = new Date().toISOString();
      stats.last_jarvis_error = null;
    } catch (error) {
      stats.last_jarvis_error_at = new Date().toISOString();
      stats.last_jarvis_error = String(error?.message || error);
      console.warn('[Jarvis watchdog]', stats.last_jarvis_error);
    } finally {
      clearTimeout(timer);
    }
  }

  const internalPort = String(process.env.INTERNAL_API_PORT || '3001');
  if (jarvisUrl && jarvisKey && String(process.env.PORT || '') === internalPort) {
    const first = setTimeout(heartbeat, 5000);
    first.unref?.();
    const interval = setInterval(heartbeat, 8 * 60 * 1000);
    interval.unref?.();
  }
}
