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

async function rows(table, select, query = {}) {
  if (!supabase) throw new Error('DATABASE_NOT_CONFIGURED');
  let q = supabase.from(table).select(select);
  for (const [key, value] of Object.entries(query)) {
    if (key === 'order') q = q.order(value.column, { ascending: value.ascending ?? false });
    else if (key === 'limit') q = q.limit(value);
    else if (key === 'eq') for (const [k, v] of Object.entries(value)) q = q.eq(k, v);
    else if (key === 'gte') for (const [k, v] of Object.entries(value)) q = q.gte(k, v);
  }
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function buildSnapshot() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const todayIso = start.toISOString();

  const [orders, jobs, notifications, sales, returns] = await Promise.all([
    rows('orders', 'id,status,total,total_amount,business_unit,created_at', { order: { column: 'created_at' }, limit: 1000 }),
    rows('production_jobs', 'id,status,title,priority,planned_end,updated_at', { order: { column: 'updated_at' }, limit: 1000 }),
    rows('notifications', 'id,type,is_read,title,message,created_at,entity_type,entity_id', { eq: { is_read: false }, order: { column: 'created_at' }, limit: 100 }),
    rows('pos_sales', 'id,total,created_at,status', { gte: { created_at: todayIso }, limit: 2000 }),
    rows('pos_returns', 'id,amount,created_at,status', { gte: { created_at: todayIso }, limit: 2000 })
  ]);

  const gross = sales.reduce((sum, x) => sum + Number(x.total || 0), 0);
  const refunds = returns.reduce((sum, x) => sum + Number(x.amount || 0), 0);
  const chat = notifications.filter(x => x.type === 'CHAT_MESSAGE');

  return {
    configured: true,
    captured_at: new Date().toISOString(),
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
        message: String(x.message || '').slice(0, 240),
        created_at: x.created_at
      }))
    },
    attention: notifications.slice(0, 20).map(x => ({
      type: x.type,
      title: x.title,
      message: String(x.message || '').slice(0, 240),
      created_at: x.created_at
    }))
  };
}

express.application.listen = function patchedJarvisHubStatusListen(...args) {
  if (!this[installed]) {
    this[installed] = true;
    this.get('/api/v1/internal/jarvis/status', requireBridge, async (_req, res, next) => {
      try {
        const payload = await buildSnapshot();
        res.set('Cache-Control', 'no-store');
        return res.json(payload);
      } catch (error) {
        return next(error);
      }
    });
  }
  return originalListen.apply(this, args);
};
