import express from 'express';

const installed = Symbol.for('a4print.jarvis.bridge.installed');
const originalListen = express.application.listen;

function jarvisConfig() {
  const baseUrl = String(process.env.JARVIS_WORKSHOP_URL || '').replace(/\/$/, '');
  const apiKey = String(process.env.JARVIS_API_KEY || '');
  return { baseUrl, apiKey, configured: Boolean(baseUrl && apiKey) };
}

async function requireHubSession(req, res, next) {
  try {
    const supabaseUrl = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
    const publishableKey = String(process.env.SUPABASE_PUBLISHABLE_KEY || '');
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
    if (!supabaseUrl || !publishableKey) return res.status(503).json({ success: false, error: 'AUTH_NOT_CONFIGURED' });
    if (!token) return res.status(401).json({ success: false, error: 'AUTH_REQUIRED' });

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { Authorization: `Bearer ${token}`, apikey: publishableKey },
        signal: controller.signal
      });
      if (!response.ok) return res.status(401).json({ success: false, error: 'INVALID_SESSION' });
      req.jarvisUser = await response.json().catch(() => null);
      return next();
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    return next(error);
  }
}

async function proxy(path, options = {}) {
  const cfg = jarvisConfig();
  if (!cfg.configured) {
    const error = new Error('JARVIS_NOT_CONFIGURED');
    error.status = 503;
    throw error;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(`${cfg.baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(body.detail || body.message || `JARVIS_HTTP_${response.status}`);
      error.status = response.status;
      throw error;
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

express.application.listen = function patchedJarvisBridgeListen(...args) {
  if (!this[installed]) {
    this[installed] = true;

    this.get('/api/v1/jarvis/health', requireHubSession, async (_req, res) => {
      const cfg = jarvisConfig();
      if (!cfg.configured) return res.status(503).json({ success: false, configured: false });
      try {
        const data = await proxy('/health');
        return res.json({ success: true, configured: true, jarvis: data });
      } catch (error) {
        return res.status(error.status || 502).json({ success: false, configured: true, error: String(error.message || error) });
      }
    });

    this.post('/api/v1/jarvis/query', requireHubSession, async (req, res) => {
      const text = String(req.body?.text || '').trim();
      if (!text) return res.status(400).json({ success: false, error: 'TEXT_REQUIRED' });
      try {
        const data = await proxy('/api/v1/assistant/query', {
          method: 'POST',
          body: JSON.stringify({ text: text.slice(0, 4000) })
        });
        return res.json({ success: true, ...data });
      } catch (error) {
        return res.status(error.status || 502).json({ success: false, error: String(error.message || error) });
      }
    });

    this.get('/api/v1/jarvis/announcements', requireHubSession, async (_req, res) => {
      try {
        const data = await proxy('/api/v1/announcements');
        const announcements = Array.isArray(data) ? data : (data.items || data.announcements || []);
        return res.json({ success: true, announcements });
      } catch (error) {
        return res.status(error.status || 502).json({ success: false, error: String(error.message || error), announcements: [] });
      }
    });

    this.post('/api/v1/jarvis/announcements/ack', requireHubSession, async (req, res) => {
      try {
        const data = await proxy('/api/v1/announcements/ack', {
          method: 'POST',
          body: JSON.stringify(req.body || {})
        });
        return res.json({ success: true, ...data });
      } catch (error) {
        return res.status(error.status || 502).json({ success: false, error: String(error.message || error) });
      }
    });
  }
  return originalListen.apply(this, args);
};
