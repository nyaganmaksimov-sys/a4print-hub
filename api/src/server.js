import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';

const app = express();
const port = Number(process.env.PORT || 3000);

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',').map((v) => v.trim()).filter(Boolean) || true }));
app.use(express.json({ limit: '1mb' }));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

app.get('/api/v1/health', async (_req, res) => {
  res.json({
    success: true,
    service: 'a4print-hub-api',
    status: 'ok',
    databaseConfigured: Boolean(supabase)
  });
});

function validateOrderPayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') errors.push('JSON body is required');
  if (!['A4_PRINT', '3D_ARTPRINT', 'COMMON'].includes(payload?.business_unit)) {
    errors.push('business_unit must be A4_PRINT, 3D_ARTPRINT or COMMON');
  }
  if (!payload?.customer?.full_name && !payload?.customer?.email && !payload?.customer?.phone) {
    errors.push('customer must contain full_name, email or phone');
  }
  if (payload?.total != null && (Number.isNaN(Number(payload.total)) || Number(payload.total) < 0)) {
    errors.push('total must be a non-negative number');
  }
  if (payload?.items != null && !Array.isArray(payload.items)) errors.push('items must be an array');
  return errors;
}

app.post('/api/v1/orders', async (req, res, next) => {
  try {
    if (!supabase) {
      return res.status(503).json({
        success: false,
        error: 'DATABASE_NOT_CONFIGURED',
        message: 'Supabase environment variables are not configured on the API server.'
      });
    }

    const errors = validateOrderPayload(req.body);
    if (errors.length) {
      return res.status(400).json({ success: false, error: 'VALIDATION_ERROR', details: errors });
    }

    const { data, error } = await supabase.rpc('create_order_from_api', { payload: req.body });

    if (error) {
      console.error('Supabase create order error:', error);
      return res.status(500).json({
        success: false,
        error: 'ORDER_CREATE_FAILED',
        message: error.message
      });
    }

    return res.status(201).json({ success: true, order: data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/orders', async (req, res, next) => {
  try {
    if (!supabase) {
      return res.status(503).json({ success: false, error: 'DATABASE_NOT_CONFIGURED' });
    }

    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = Math.min(Math.max(Number(req.query.limit) || 25, 1), 100);
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = supabase
      .from('orders')
      .select(`id, order_number, business_unit, status, total, model_name, model_url, source, created_at, updated_at, customer:customers(id, full_name, email, phone)`, { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (req.query.business_unit) query = query.eq('business_unit', req.query.business_unit);
    if (req.query.status) query = query.eq('status', req.query.status);
    if (req.query.search) query = query.or(`model_name.ilike.%${req.query.search}%,source.ilike.%${req.query.search}%`);

    const { data, error, count } = await query;
    if (error) return res.status(500).json({ success: false, error: 'ORDERS_LIST_FAILED', message: error.message });

    return res.json({ success: true, page, limit, total: count ?? 0, orders: data });
  } catch (error) {
    next(error);
  }
});

app.get('/api/v1/orders/:id', async (req, res, next) => {
  try {
    if (!supabase) return res.status(503).json({ success: false, error: 'DATABASE_NOT_CONFIGURED' });

    const { data, error } = await supabase
      .from('orders')
      .select(`*, customer:customers(*), items:order_items(*), status_history:order_status_history(*), files:order_files(*), production_jobs(*)`)
      .eq('id', req.params.id)
      .maybeSingle();

    if (error) return res.status(500).json({ success: false, error: 'ORDER_GET_FAILED', message: error.message });
    if (!data) return res.status(404).json({ success: false, error: 'ORDER_NOT_FOUND' });

    return res.json({ success: true, order: data });
  } catch (error) {
    next(error);
  }
});

app.patch('/api/v1/orders/:id', async (req, res, next) => {
  try {
    if (!supabase) return res.status(503).json({ success: false, error: 'DATABASE_NOT_CONFIGURED' });

    const allowed = ['status', 'assigned_to', 'internal_comment'];
    const updates = Object.fromEntries(Object.entries(req.body || {}).filter(([key]) => allowed.includes(key)));
    if (!Object.keys(updates).length) return res.status(400).json({ success: false, error: 'NO_ALLOWED_FIELDS' });

    const { data: current, error: currentError } = await supabase.from('orders').select('status').eq('id', req.params.id).maybeSingle();
    if (currentError) return res.status(500).json({ success: false, error: 'ORDER_GET_FAILED', message: currentError.message });
    if (!current) return res.status(404).json({ success: false, error: 'ORDER_NOT_FOUND' });

    updates.updated_at = new Date().toISOString();
    const { data, error } = await supabase.from('orders').update(updates).eq('id', req.params.id).select().single();
    if (error) return res.status(500).json({ success: false, error: 'ORDER_UPDATE_FAILED', message: error.message });

    if (updates.status && updates.status !== current.status) {
      await supabase.from('order_status_history').insert({ order_id: req.params.id, old_status: current.status, new_status: updates.status, comment: req.body.comment || null });
    }

    return res.json({ success: true, order: data });
  } catch (error) {
    next(error);
  }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR' });
});

app.listen(port, () => console.log(`A4PRINT HUB API listening on port ${port}`));
