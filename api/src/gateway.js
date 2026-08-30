import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';

const app = express();
const port = Number(process.env.PORT || 3000);
const internalPort = Number(process.env.INTERNAL_API_PORT || 3001);
const supabaseUrl = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY;
const moyskladToken = process.env.MOYSKLAD_TOKEN;
const supabase = supabaseUrl && serviceKey ? createClient(supabaseUrl, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } }) : null;

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',').map(v => v.trim()).filter(Boolean) || true }));
app.use(express.json({ limit: '2mb' }));

const child = spawn(process.execPath, ['src/server.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(internalPort) },
  stdio: 'inherit'
});
child.on('exit', code => {
  console.error('Internal API exited with code', code);
  process.exit(code || 1);
});
process.on('SIGTERM', () => child.kill('SIGTERM'));
process.on('SIGINT', () => child.kill('SIGINT'));

const BASE = 'https://api.moysklad.ru/api/remap/1.2';
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ms(path, options = {}) {
  if (!moyskladToken) throw new Error('MOYSKLAD_NOT_CONFIGURED');
  const url = path.startsWith('http') ? path : BASE + path;
  const method = String(options.method || 'GET').toUpperCase();
  const attempts = method === 'GET' ? 3 : 1;
  let last;
  for (let i = 1; i <= attempts; i++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const r = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${moyskladToken}`,
          Accept: 'application/json;charset=utf-8',
          'Content-Type': 'application/json',
          ...(options.headers || {})
        }
      });
      clearTimeout(timer);
      const text = await r.text();
      if (!r.ok) {
        const e = new Error(`MoySklad HTTP ${r.status}: ${text}`);
        e.status = r.status;
        throw e;
      }
      return text ? JSON.parse(text) : null;
    } catch (e) {
      clearTimeout(timer);
      last = e;
      if (e.status || i === attempts) throw e;
      await sleep(400 * i);
    }
  }
  throw last;
}

async function authContext(req) {
  if (!supabaseUrl || !publishableKey || !supabase) throw new Error('AUTH_NOT_CONFIGURED');
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return { error: 'AUTH_REQUIRED' };
  const client = createClient(supabaseUrl, publishableKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { autoRefreshToken: false, persistSession: false }
  });
  const { data: { user }, error } = await client.auth.getUser(token);
  if (error || !user) return { error: 'INVALID_SESSION' };
  const { data: profile, error: pErr } = await supabase.from('users').select('id,auth_user_id,full_name,email,is_active').eq('auth_user_id', user.id).maybeSingle();
  if (pErr) throw pErr;
  if (!profile || profile.is_active === false) return { error: 'OPERATOR_DISABLED' };
  const { data: roleRows, error: rErr } = await supabase.from('user_roles').select('roles(name)').eq('user_id', profile.id);
  if (rErr) throw rErr;
  const roles = new Set((roleRows || []).map(x => x.roles?.name).filter(Boolean));
  if (!roles.has('ADMIN') && !roles.has('POS_OPERATOR')) return { error: 'POS_ACCESS_REQUIRED' };
  return { user, profile, roles };
}

async function requirePos(req, res, next) {
  try {
    const ctx = await authContext(req);
    if (ctx.error) return res.status(ctx.error === 'POS_ACCESS_REQUIRED' ? 403 : 401).json({ success: false, error: ctx.error });
    req.pos = ctx;
    next();
  } catch (e) { next(e); }
}

function metaId(entity) { return entity?.id || entity?.meta?.href?.split('/').pop() || null; }
function sameEntity(a, b) { const ai = metaId(a), bi = metaId(b); return Boolean(ai && bi && ai === bi); }

async function retailContext() {
  const [stores, orgs, shifts] = await Promise.all([
    ms('/entity/retailstore?limit=100'),
    ms('/entity/organization?limit=100'),
    ms('/entity/retailshift?limit=100&order=created,desc')
  ]);
  const store = stores.rows?.find(x => !x.archived) || stores.rows?.[0];
  const organization = orgs.rows?.find(x => !x.archived) || orgs.rows?.[0];
  if (!store) throw new Error('В МойСклад не найдена активная точка продаж');
  if (!organization) throw new Error('В МойСклад не найдено юрлицо');
  const rows = shifts.rows || [];
  const shift = rows.find(x => !x.closeDate && sameEntity(x.retailStore, store)) || rows.find(x => !x.closeDate) || null;
  return { store, organization, shift };
}

function saleSummary(x) {
  return {
    id: x.id,
    name: x.name,
    moment: x.moment || x.created,
    sum: Number(x.sum || 0) / 100,
    payedSum: Number(x.payedSum || 0) / 100,
    description: x.description || '',
    store: x.retailStore?.name || '',
    metaHref: x.meta?.href || ''
  };
}

function positionRows(sale) {
  const rows = sale?.positions?.rows || (Array.isArray(sale?.positions) ? sale.positions : []);
  return rows.map(p => ({
    id: p.id,
    name: p.assortment?.name || p.name || 'Позиция',
    quantity: Number(p.quantity || 0),
    price: Number(p.price || 0) / 100,
    discount: Number(p.discount || 0),
    vat: p.vat ?? null,
    vatEnabled: p.vatEnabled ?? null,
    assortmentMeta: p.assortment?.meta || null
  }));
}

app.get('/api/v1/pos/returns/sales', requirePos, async (_req, res, next) => {
  try {
    const data = await ms('/entity/retaildemand?limit=60&order=moment,desc');
    res.json({ success: true, sales: (data.rows || []).map(saleSummary) });
  } catch (e) { next(e); }
});

app.get('/api/v1/pos/returns/sales/:id', requirePos, async (req, res, next) => {
  try {
    const sale = await ms(`/entity/retaildemand/${encodeURIComponent(req.params.id)}?expand=positions.assortment`);
    res.json({ success: true, sale: { ...saleSummary(sale), positions: positionRows(sale) } });
  } catch (e) { next(e); }
});

app.post('/api/v1/pos/returns', requirePos, async (req, res, next) => {
  try {
    if (!supabase) return res.status(503).json({ success: false, error: 'DATABASE_NOT_CONFIGURED' });
    const saleId = String(req.body?.sale_id || '').trim();
    const accountId = String(req.body?.account_id || '').trim();
    const method = String(req.body?.payment_method || 'Наличные').trim().slice(0, 50);
    const reason = String(req.body?.reason || '').trim().slice(0, 700);
    const requested = Array.isArray(req.body?.positions) ? req.body.positions : [];
    if (!saleId || !accountId || !requested.length) return res.status(400).json({ success: false, error: 'INVALID_RETURN', message: 'Выберите продажу, позиции и счёт возврата.' });
    if (!reason) return res.status(400).json({ success: false, error: 'RETURN_REASON_REQUIRED', message: 'Укажите причину возврата.' });

    const { store, organization, shift } = await retailContext();
    if (!shift) return res.status(409).json({ success: false, error: 'SHIFT_CLOSED', message: 'Для возврата сначала откройте смену.' });

    const sale = await ms(`/entity/retaildemand/${encodeURIComponent(saleId)}?expand=positions.assortment`);
    const original = new Map(positionRows(sale).map(p => [p.id, p]));
    const positions = [];
    let total = 0;
    for (const r of requested) {
      const p = original.get(String(r.id || ''));
      if (!p) continue;
      const qty = Math.max(0, Math.min(Number(r.quantity || 0), p.quantity));
      if (!qty) continue;
      total += qty * p.price * (1 - (p.discount || 0) / 100);
      const row = {
        quantity: qty,
        price: Math.round(p.price * 100),
        discount: p.discount || 0,
        assortment: { meta: p.assortmentMeta }
      };
      if (p.vat != null) row.vat = p.vat;
      if (p.vatEnabled != null) row.vatEnabled = p.vatEnabled;
      positions.push(row);
    }
    if (!positions.length || total <= 0) return res.status(400).json({ success: false, error: 'EMPTY_RETURN', message: 'Укажите количество возвращаемых позиций.' });

    const operatorName = req.pos.profile.full_name || req.pos.profile.email || 'Оператор';
    const warehouseMeta = sale.store?.meta || store.store?.meta;
    if (!warehouseMeta) {
      return res.status(409).json({
        success: false,
        error: 'MOYSKLAD_STORE_NOT_CONFIGURED',
        message: 'Для точки продаж МойСклад не найден склад. Укажите склад в настройках точки продаж и повторите возврат.'
      });
    }
    const payload = {
      organization: { meta: sale.organization?.meta || organization.meta },
      store: { meta: warehouseMeta },
      retailStore: { meta: sale.retailStore?.meta || store.meta },
      retailShift: { meta: shift.meta },
      demand: { meta: sale.meta },
      positions,
      payedSum: Math.round(total * 100),
      description: `A4PRINT HUB · Возврат продажи ${sale.name || sale.id} · Оператор: ${operatorName} · Причина: ${reason}`
    };
    if (sale.agent?.meta) payload.agent = { meta: sale.agent.meta };

    let returned;
    try {
      returned = await ms('/entity/retailsalesreturn', { method: 'POST', body: JSON.stringify(payload) });
    } catch (e) {
      if (e.status === 400 || e.status === 412) {
        const { payedSum, ...fallback } = payload;
        returned = await ms('/entity/retailsalesreturn', { method: 'POST', body: JSON.stringify(fallback) });
      } else throw e;
    }

    const { data: org, error: orgErr } = await supabase.from('organizations').select('id').eq('code', 'A4PRINT').single();
    if (orgErr) throw orgErr;
    const { data: account, error: accountErr } = await supabase.from('cash_accounts').select('id').eq('id', accountId).eq('organization_id', org.id).eq('is_active', true).single();
    if (accountErr || !account) return res.status(400).json({ success: false, error: 'INVALID_CASH_ACCOUNT', message: 'Счёт возврата не найден.' });
    const { data: category } = await supabase.from('cash_categories').select('id').eq('organization_id', org.id).eq('direction', 'EXPENSE').eq('name', 'Прочий расход').maybeSingle();
    const { error: txErr } = await supabase.from('cash_transactions').insert({
      organization_id: org.id,
      cash_account_id: accountId,
      category_id: category?.id || null,
      direction: 'EXPENSE',
      amount: Number(total.toFixed(2)),
      payment_method: method,
      description: `Возврат МойСклад ${returned?.name || returned?.id || ''} по продаже ${sale.name || sale.id} · Оператор: ${operatorName} · ${reason}`,
      transaction_date: new Date().toISOString().slice(0, 10),
      created_by: req.pos.profile.id
    });
    if (txErr) throw txErr;

    res.status(201).json({
      success: true,
      return: { id: returned?.id, name: returned?.name, href: returned?.meta?.href },
      sale: { id: sale.id, name: sale.name },
      amount: Number(total.toFixed(2)),
      operator: operatorName
    });
  } catch (e) { next(e); }
});

app.use(async (req, res, next) => {
  try {
    const url = `http://127.0.0.1:${internalPort}${req.originalUrl}`;
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];
    const method = req.method.toUpperCase();
    const hasBody = !['GET', 'HEAD'].includes(method);
    const response = await fetch(url, {
      method,
      headers,
      body: hasBody && req.body != null ? JSON.stringify(req.body) : undefined
    });
    res.status(response.status);
    response.headers.forEach((value, key) => {
      if (!['content-encoding', 'transfer-encoding', 'content-length', 'connection'].includes(key.toLowerCase())) res.setHeader(key, value);
    });
    const body = Buffer.from(await response.arrayBuffer());
    res.send(body);
  } catch (e) { next(e); }
});

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ success: false, error: 'INTERNAL_SERVER_ERROR', message: err.message });
});

app.listen(port, () => console.log(`A4PRINT HUB gateway listening on port ${port}; internal API ${internalPort}`));
