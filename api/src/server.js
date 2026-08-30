import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { syncMoySkladCatalog, fetchMoySkladStock, createRetailSale } from './moysklad.js';

const app = express();
const port = Number(process.env.PORT || 3000);
app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',').map(v => v.trim()).filter(Boolean) || true }));
app.use(express.json({ limit: '1mb' }));

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const supabase = supabaseUrl && supabaseKey
  ? createClient(supabaseUrl, supabaseKey, { auth: { autoRefreshToken: false, persistSession: false } })
  : null;

app.get('/api/v1/health', (_q, r) => r.json({
  success: true,
  service: 'a4print-hub-api',
  status: 'ok',
  databaseConfigured: Boolean(supabase),
  moyskladConfigured: Boolean(process.env.MOYSKLAD_TOKEN)
}));

async function authContext(req) {
  if (!supabaseUrl || !publishableKey) throw new Error('AUTH_NOT_CONFIGURED');
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return { error: 'AUTH_REQUIRED' };
  const c = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: { user }, error } = await c.auth.getUser(token);
  if (error || !user) return { error: 'INVALID_SESSION' };
  return { client: c, user };
}

async function requireAdmin(req, res, next) {
  try {
    const ctx = await authContext(req);
    if (ctx.error) return res.status(ctx.error === 'AUTH_REQUIRED' ? 401 : 401).json({ success: false, error: ctx.error });
    const { data: isAdmin, error } = await ctx.client.rpc('has_role', { required_role: 'ADMIN' });
    if (error) throw error;
    if (!isAdmin) return res.status(403).json({ success: false, error: 'ADMIN_REQUIRED' });
    req.authUser = ctx.user;
    next();
  } catch (e) { next(e); }
}

async function requirePosUser(req, res, next) {
  try {
    const ctx = await authContext(req);
    if (ctx.error) return res.status(401).json({ success: false, error: ctx.error });
    const [{ data: isAdmin, error: aErr }, { data: isOperator, error: oErr }] = await Promise.all([
      ctx.client.rpc('has_role', { required_role: 'ADMIN' }),
      ctx.client.rpc('has_role', { required_role: 'POS_OPERATOR' })
    ]);
    if (aErr) throw aErr;
    if (oErr) throw oErr;
    if (!isAdmin && !isOperator) return res.status(403).json({ success: false, error: 'POS_ACCESS_REQUIRED' });
    req.authUser = ctx.user;
    req.isAdmin = Boolean(isAdmin);
    next();
  } catch (e) { next(e); }
}

const msReady = res => {
  if (!supabase) { res.status(503).json({ success: false, error: 'DATABASE_NOT_CONFIGURED' }); return false; }
  if (!process.env.MOYSKLAD_TOKEN) { res.status(503).json({ success: false, error: 'MOYSKLAD_NOT_CONFIGURED' }); return false; }
  return true;
};

app.post('/api/v1/integrations/moysklad/sync', requireAdmin, async (req, res, next) => {
  try {
    if (!msReady(res)) return;
    const { data: org, error } = await supabase.from('organizations').select('id').eq('code', 'A4PRINT').single();
    if (error) throw error;
    const result = await syncMoySkladCatalog({ supabase, token: process.env.MOYSKLAD_TOKEN, organizationId: org.id });
    res.json({ success: true, ...result });
  } catch (e) { next(e); }
});

app.get('/api/v1/integrations/moysklad/stock', requirePosUser, async (req, res, next) => {
  try {
    if (!msReady(res)) return;
    const stock = await fetchMoySkladStock(process.env.MOYSKLAD_TOKEN);
    res.json({ success: true, stock });
  } catch (e) { next(e); }
});

app.post('/api/v1/pos/sale', requirePosUser, async (req, res, next) => {
  try {
    if (!msReady(res)) return;
    const input = req.body || {};
    if (!Array.isArray(input.items) || !input.items.length) return res.status(400).json({ success: false, error: 'EMPTY_CART' });
    const ids = input.items.map(x => x.id);
    const { data: rows, error } = await supabase.from('catalog_items').select('id,name,sale_price,external_id,external_href,item_type').in('id', ids);
    if (error) throw error;
    const byId = new Map((rows || []).map(x => [x.id, x]));
    const items = input.items.map(x => {
      const g = byId.get(x.id);
      if (!g) throw new Error('Товар не найден: ' + x.id);
      return {
        id: g.id,
        name: g.name,
        qty: Math.max(1, Number(x.qty || 1)),
        price: Number(x.price ?? g.sale_price ?? 0),
        external_href: g.external_href,
        external_type: g.external_href?.split('/').slice(-2, -1)[0] || 'product'
      };
    });
    const sale = await createRetailSale({ token: process.env.MOYSKLAD_TOKEN, items, paymentMethod: input.payment_method });
    res.json({ success: true, moysklad: { id: sale.id, name: sale.name, href: sale.meta?.href }, sum: Number(sale.sum || 0) / 100 });
  } catch (e) { next(e); }
});

app.get('/api/v1/operators', requireAdmin, async (_req, res, next) => {
  try {
    const { data: role, error: roleErr } = await supabase.from('roles').select('id').eq('name', 'POS_OPERATOR').single();
    if (roleErr) throw roleErr;
    const { data, error } = await supabase
      .from('user_roles')
      .select('users(id,auth_user_id,full_name,email,phone,is_active,created_at)')
      .eq('role_id', role.id);
    if (error) throw error;
    res.json({ success: true, operators: (data || []).map(x => x.users).filter(Boolean) });
  } catch (e) { next(e); }
});

app.post('/api/v1/operators', requireAdmin, async (req, res, next) => {
  try {
    if (!supabase) return res.status(503).json({ success: false, error: 'DATABASE_NOT_CONFIGURED' });
    const fullName = String(req.body?.full_name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '');
    if (!fullName || !email || password.length < 6) return res.status(400).json({ success: false, error: 'INVALID_OPERATOR_DATA', message: 'Укажите имя, email и пароль не короче 6 символов.' });

    const { data: authData, error: authErr } = await supabase.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { full_name: fullName } });
    if (authErr) throw authErr;
    const authUser = authData.user;
    try {
      const { data: profile, error: pErr } = await supabase.from('users').upsert({ auth_user_id: authUser.id, full_name: fullName, email, is_active: true }, { onConflict: 'auth_user_id' }).select('id').single();
      if (pErr) throw pErr;
      const { data: role, error: rErr } = await supabase.from('roles').select('id').eq('name', 'POS_OPERATOR').single();
      if (rErr) throw rErr;
      const { error: urErr } = await supabase.from('user_roles').upsert({ user_id: profile.id, role_id: role.id });
      if (urErr) throw urErr;
      res.status(201).json({ success: true, operator: { id: profile.id, auth_user_id: authUser.id, full_name: fullName, email, is_active: true } });
    } catch (e) {
      await supabase.auth.admin.deleteUser(authUser.id).catch(() => {});
      throw e;
    }
  } catch (e) { next(e); }
});

app.patch('/api/v1/operators/:id', requireAdmin, async (req, res, next) => {
  try {
    const { data: operator, error: findErr } = await supabase.from('users').select('id,auth_user_id').eq('id', req.params.id).single();
    if (findErr) throw findErr;
    const updates = {};
    if (typeof req.body?.full_name === 'string') updates.full_name = req.body.full_name.trim();
    if (typeof req.body?.is_active === 'boolean') updates.is_active = req.body.is_active;
    if (Object.keys(updates).length) {
      const { error } = await supabase.from('users').update(updates).eq('id', operator.id);
      if (error) throw error;
    }
    const authUpdates = {};
    if (typeof req.body?.password === 'string' && req.body.password) authUpdates.password = req.body.password;
    if (typeof req.body?.is_active === 'boolean') authUpdates.ban_duration = req.body.is_active ? 'none' : '876000h';
    if (Object.keys(authUpdates).length && operator.auth_user_id) {
      const { error } = await supabase.auth.admin.updateUserById(operator.auth_user_id, authUpdates);
      if (error) throw error;
    }
    res.json({ success: true });
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR', message: err.message });
});

app.listen(port, () => console.log(`A4PRINT HUB API listening on port ${port}`));
