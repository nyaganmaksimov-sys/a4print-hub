import express from 'express';

const installed = Symbol.for('a4print.jarvis.runtime.health.installed');
const originalListen = express.application.listen;

express.application.listen = function patchedJarvisRuntimeHealthListen(...args) {
  if (!this[installed]) {
    this[installed] = true;
    this.get('/api/v1/internal/jarvis/runtime-health', (req, res, next) => {
      const key = String(process.env.JARVIS_BRIDGE_KEY || '');
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
      if (!key || token !== key) return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
      const stats = globalThis.__A4_JARVIS_NETWORK_STATS__ || {};
      return res.json({
        success: true,
        configured: Boolean(process.env.JARVIS_WORKSHOP_URL && process.env.JARVIS_API_KEY),
        stats,
        checked_at: new Date().toISOString()
      });
    });
  }
  return originalListen.apply(this, args);
};
