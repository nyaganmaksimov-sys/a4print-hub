import 'dotenv/config';
import express from 'express';
import { createClient } from '@supabase/supabase-js';

const installed = Symbol.for('a4print.jarvis.hub.status.installed');
const originalListen = express.application.listen;

const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bridgeKey = String(process.env.JARVIS_BRIDGE_KEY || '');
const supabase = supabaseUrl && serviceKey
  ? createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

function requireBridge(req, res, next) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!bridgeKey) return res.status(503).json({ success: false, error: 'JARVIS_BRIDGE_NOT_CONFIGURED' });
  if (!token || token !== bridgeKey) return res.status(401).json({ success: false, error: 'UNAUTHORIZED' });
  next();
}

async function safeRows(name, table, query = {}) {
  if (!supabase) return { name, rows: [], error: 'DATABASE_NOT_CONFIGURED' };
  try {
    let q = supabase.from(table).select('*');
    if (query.eq) for (const [k, v] of Object.entries(query.eq)) q = q.eq(k, v);
    if (query.gte) for (const [k, v] of Object.entries(query.gte)) q = q.gte(k, v);
    if (query.order) q = q.order(query.order.column, { ascending: query.order.ascending ?? false });
    if (query.limit) q = q.limit(query.limit);
    const { data, error } = await q;
    if (error) throw error;
    return { name, rows: data || [], error: null };
  } catch (error) {
    console.warn(`[Jarvis HUB snapshot:${name}]`, error?.message || error);
    return { name, rows: [], error: String(error?.message || error) };
  }
}

function moscowDayStartIso() {
  const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;
  const now = new Date();
  const moscow = new Date(now.getTime() + MOSCOW_OFFSET_MS);
  moscow.setUTCHours(0, 0, 0, 0);
  return new Date(moscow.getTime() - MOSCOW_OFFSET_MS).toISOString();
}

function amount(row, keys) {
  for (const key of keys) {
    const value = Number(row?.[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

async function buildSnapshot() {
  const todayIso = moscowDayStartIso();
  const results = await Promise.all([
    safeRows('orders', 'orders', { order: { column: 'created_at' }, limit: 1000 }),
    safeRows('production', 'production_jobs', { order: { column: 'updated_at' }, limit: 1000 }),
    safeRows('notifications', 'notifications', { eq: { is_read: false }, order: { column: 'created_at' }, limit: 100 }),
    safeRows('sales', 'pos_sales', { gte: { created_at: todayIso }, limit: 2000 }),
    safeRows('returns', 'pos_returns', { gte: { created_at: todayIso }, limit: 2000 })
  ]);

  const byName = Object.fromEntries(results.map(x => [x.name, x]));
  const orders = byName.orders.rows;
  const jobs = byName.production.rows;
  const notifications = byName.notifications.rows;
  const sales = byName.sales.rows;
  const returns = byName.returns.rows;

  const gross = sales.reduce((sum, x) => sum + amount(x, ['total','total_amount','amount','sum']), 0);
  const refunds = returns.reduce((sum, x) => sum + amount(x, ['amount','total','total_amount','sum']), 0);
  const chat = notifications.filter(x => String(x.type || '').toUpperCase() === 'CHAT_MESSAGE');
  const warnings = results.filter(x => x.error).map(x => ({ source: x.name, error: x.error }));

  return {
    configured: Boolean(supabase),
    captured_at: new Date().toISOString(),
    business_timezone: 'Europe/Moscow',
    partial: warnings.length > 0,
    warnings,
    revenue: {
      gross,
      refunds,
      net: gross - refunds,
      sales_count: sales.length,
      returns_count: returns.length
    },
    orders: {
      total: orders.length,
      new: orders.filter(x => x.status === 'NEW').length,
      in_progress: orders.filter(x => ['CONFIRMED', 'IN_PROGRESS'].includes(x.status)).length,
      ready: orders.filter(x => x.status === 'READY').length
    },
    production: {
      total: jobs.length,
      queue: jobs.filter(x => ['NEW', 'QUEUED'].includes(x.status)).length,
      in_progress: jobs.filter(x => ['IN_PROGRESS', 'PAUSED'].includes(x.status)).length,
      done: jobs.filter(x => x.status === 'DONE').length,
      high_priority: jobs.filter(x => Number(x.priority || 0) >= 70 && !['DONE', 'CANCELLED'].includes(x.status)).length
    },
    messages: {
      unread: chat.length,
      latest: chat.slice(0, 10).map(x => ({
        title: x.title || 'Новое сообщение',
        message: String(x.message || x.body || '').slice(0, 240),
        created_at: x.created_at
      }))
    },
    attention: notifications.slice(0, 20).map(x => ({
      type: x.type,
      title: x.title,
      message: String(x.message || x.body || '').slice(0, 240),
      created_at: x.created_at
    }))
  };
}

express.application.listen = function patchedJarvisHubStatusListen(...args) {
  if (!this[installed]) {
    this[installed] = true;
    this.get('/api/v1/internal/jarvis/status', requireBridge, async (_req, res) => {
      const payload = await buildSnapshot();
      res.set('Cache-Control', 'no-store');
      return res.json(payload);
    });
  }
  return originalListen.apply(this, args);
};
