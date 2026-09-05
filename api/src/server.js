import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createClient } from '@supabase/supabase-js';
import { syncMoySkladCatalog, fetchMoySkladStock, createRetailSale, getRetailShiftStatus, openRetailShift, closeRetailShift } from './moysklad.js';

const app = express();
const port = Number(process.env.PORT || 3000);

const configuredOrigins = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean);
const trustedOrigins = new Set([
  ...configuredOrigins,
  'https://a4print-hub.ru',
  'https://www.a4print-hub.ru',
  'http://localhost:3000',
  'http://localhost:5173',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:5173'
]);
const corsOptions = {
  origin(origin, callback) {
    if (!origin || trustedOrigins.has('*') || trustedOrigins.has(origin)) return callback(null, true);
    if (/^https:\/\/[a-z0-9-]+\.a4print-hub\.ru$/i.test(origin)) return callback(null, true);
    return callback(new Error(`CORS_ORIGIN_DENIED: ${origin}`));
  },
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
  maxAge: 86400
};
app.use(cors(corsOptions));
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
    if (ctx.error) return res.status(401).json({ success: false, error: ctx.error });
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

async function operatorProfile(authUserId) {
  if (!supabase || !authUserId) return null;
  const { data, error } = await supabase.from('users').select('id,full_name,email,is_active').eq('auth_user_id', authUserId).maybeSingle();
  if (error) throw error;
  return data;
}

async function resolvePosOperator(req, requestedId) {
  const own = await operatorProfile(req.authUser?.id);
  if (!req.isAdmin || !requestedId || !supabase) return own;
  const { data, error } = await supabase.from('users').select('id,full_name,email,is_active').eq('id', requestedId).maybeSingle();
  if (error) throw error;
  return data?.is_active === false ? own : (data || own);
}

const cleanText = (value, max = 500) => String(value || '').trim().slice(0, max);
const customerFields = 'id,full_name,company_name,email,phone,notes,created_at,updated_at';

function customerView(row) {
  if (!row) return null;
  return {
    id: row.id,
    full_name: row.full_name,
    company_name: row.company_name || '',
    email: row.email || '',
    phone: row.phone || '',
    notes: row.notes || ''
  };
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

app.get('/api/v1/pos/shift', requirePosUser, async (req, res, next) => {
  try {
    if (!msReady(res)) return;
    const status = await getRetailShiftStatus(process.env.MOYSKLAD_TOKEN);
    res.json({ success: true, ...status });
  } catch (e) { next(e); }
});

app.post('/api/v1/pos/shift/open', requirePosUser, async (req, res, next) => {
  try {
    if (!msReady(res)) return;
    const profile = await resolvePosOperator(req, cleanText(req.body?.operator_id, 80));
    const result = await openRetailShift(process.env.MOYSKLAD_TOKEN, { operatorName: profile?.full_name || req.authUser.email });
    res.json({ success: true, alreadyOpen: result.alreadyOpen, shift: { id: result.shift?.id, name: result.shift?.name, openDate: result.shift?.openDate || result.shift?.moment || result.shift?.created }, store: { id: result.store?.id, name: result.store?.name }, operator: { id: profile?.id || null, name: profile?.full_name || req.authUser.email } });
  } catch (e) { next(e); }
});

app.post('/api/v1/pos/shift/close', requirePosUser, async (req, res, next) => {
  try {
    if (!msReady(res)) return;
    const profile = await resolvePosOperator(req, cleanText(req.body?.operator_id, 80));
    const result = await closeRetailShift(process.env.MOYSKLAD_TOKEN, { operatorName: profile?.full_name || req.authUser.email });
    res.json({ success: true, shift: { id: result.shift?.id, name: result.shift?.name, closeDate: result.shift?.closeDate }, store: { id: result.store?.id, name: result.store?.name }, operator: { id: profile?.id || null, name: profile?.full_name || req.authUser.email } });
  } catch (e) { next(e); }
});

app.get('/api/v1/pos/customers', requirePosUser, async (req, res, next) => {
  try {
    if (!supabase) return res.status(503).json({ success: false, error: 'DATABASE_NOT_CONFIGURED' });
    const q = cleanText(req.query.q, 100).replace(/[,%()]/g, ' ');
    if (q.length < 2) return res.json({ success: true, customers: [] });
    const { data, error } = await supabase
      .from('customers')
      .select(customerFields)
      .or(`full_name.ilike.%${q}%,phone.ilike.%${q}%,email.ilike.%${q}%,company_name.ilike.%${q}%`)
      .order('updated_at', { ascending: false })
      .limit(12);
    if (error) throw error;
    res.json({ success: true, customers: (data || []).map(customerView) });
  } catch (e) { next(e); }
});

app.post('/api/v1/pos/customers', requirePosUser, async (req, res, next) => {
  try {
    if (!supabase) return res.status(503).json({ success: false, error: 'DATABASE_NOT_CONFIGURED' });
    const profile = await operatorProfile(req.authUser.id);
    if (profile && profile.is_active === false) return res.status(403).json({ success: false, error: 'OPERATOR_DISABLED' });

    const id = cleanText(req.body?.id, 80) || null;
    const fullName = cleanText(req.body?.full_name, 200);
    const phone = cleanText(req.body?.phone, 80);
    const email = cleanText(req.body?.email, 200).toLowerCase();
    const companyName = cleanText(req.body?.company_name, 200);
    const managerComment = cleanText(req.body?.manager_comment, 1500);
    if (!fullName) return res.status(400).json({ success: false, error: 'CUSTOMER_NAME_REQUIRED', message: 'Укажите имя клиента.' });

    let existing = null;
    if (id) {
      const { data, error } = await supabase.from('customers').select(customerFields).eq('id', id).maybeSingle();
      if (error) throw error;
      existing = data;
    }
    if (!existing && phone) {
      const { data, error } = await supabase.from('customers').select(customerFields).eq('phone', phone).limit(1).maybeSingle();
      if (error) throw error;
      existing = data;
    }
    if (!existing && email) {
      const { data, error } = await supabase.from('customers').select(customerFields).eq('email', email).limit(1).maybeSingle();
      if (error) throw error;
      existing = data;
    }

    const operatorName = profile?.full_name || req.authUser.email || 'Оператор';
    let notes = existing?.notes || '';
    if (managerComment) {
      const stamp = new Date().toLocaleString('ru-RU', { timeZone: 'Europe/Moscow' });
      const line = `[${stamp}] ${operatorName}: ${managerComment}`;
      notes = notes ? `${notes}\n${line}` : line;
    }

    const payload = {
      full_name: fullName,
      company_name: companyName || null,
      email: email || null,
      phone: phone || null,
      notes: notes || null,
      updated_at: new Date().toISOString()
    };

    let saved;
    if (existing?.id) {
      const { data, error } = await supabase.from('customers').update(payload).eq('id', existing.id).select(customerFields).single();
      if (error) throw error;
      saved = data;
    } else {
      const { data, error } = await supabase.from('customers').insert(payload).select(customerFields).single();
      if (error) throw error;
      saved = data;
    }

    res.status(existing ? 200 : 201).json({ success: true, customer: customerView(saved) });
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
    const profile = await resolvePosOperator(req, cleanText(input.operator_id, 80));
    if (profile && profile.is_active === false) return res.status(403).json({ success: false, error: 'OPERATOR_DISABLED' });
    const operatorName = profile?.full_name || req.authUser.email || 'Оператор';

    let customer = null;
    const customerId = cleanText(input.customer_id, 80);
    if (customerId) {
      const { data, error: customerError } = await supabase.from('customers').select(customerFields).eq('id', customerId).maybeSingle();
      if (customerError) throw customerError;
      customer = data;
    }

    const sale = await createRetailSale({
      token: process.env.MOYSKLAD_TOKEN,
      items,
      paymentMethod: input.payment_method,
      operatorName,
      customer: customer ? { name: customer.full_name, phone: customer.phone, company: customer.company_name } : null
    });
    res.json({
      success: true,
      operator: { id: profile?.id || null, name: operatorName },
      customer: customerView(customer),
      moysklad: { id: sale.id, name: sale.name, href: sale.meta?.href },
      sum: Number(sale.sum || 0) / 100
    });
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
